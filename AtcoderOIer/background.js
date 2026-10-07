// Service worker：初始化默认配置 + 代理 AI 请求（绕开页面 CORS）+ 月度字符额度记账
const DEFAULTS = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  targetLang: "简体中文",
  promptTemplate:
    "请将下面的 AtCoder 网站页面内容（{{label}}）翻译成{{lang}}。要求：\n" +
    "1. 保留所有数学公式（LaTeX）原样；代码、变量名、输入输出格式保持原样；\n" +
    "2. 输出为 Markdown 格式，结构与原文一致（小节标题也要翻译）；\n" +
    "3. 若内容包含 Markdown 表格，请保留表格结构逐行翻译；\n" +
    "4. 只输出翻译结果，不要添加任何解释。\n\n页面内容：\n{{text}}",
  autoTranslate: false,
  useCache: true,
  apiFormat: "openai", // openai | anthropic
  budgetEnabled: false,
  budgetChars: 1000000 // 默认每月 100 万字符
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(Object.keys(DEFAULTS), (stored) => {
    const patch = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (stored[k] === undefined) patch[k] = v;
    }
    if (Object.keys(patch).length) chrome.storage.sync.set(patch);
  });
});

// ============ 月度字符额度 ============

function currentMonth() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

// 读取本月用量（跨月自动清零）
async function getBudgetState() {
  const s = await chrome.storage.local.get("budgetState");
  let st = s.budgetState;
  if (!st || st.month !== currentMonth()) {
    st = { month: currentMonth(), used: 0 };
  }
  return st;
}

// 检查额度是否够 needChars；返回 {ok, used, limit, remaining}
async function budgetCheck(needChars) {
  const cfg = await chrome.storage.sync.get(["budgetEnabled", "budgetChars"]);
  if (!cfg.budgetEnabled) return { ok: true, enabled: false };
  const st = await getBudgetState();
  const limit = cfg.budgetChars || DEFAULTS.budgetChars;
  const remaining = limit - st.used;
  return { ok: needChars <= remaining, enabled: true, used: st.used, limit, remaining };
}

// 成功请求后记账（输入 prompt 字符 + 输出译文字符）
async function budgetConsume(promptChars, outputChars) {
  const cfg = await chrome.storage.sync.get(["budgetEnabled"]);
  if (!cfg.budgetEnabled) return;
  const st = await getBudgetState();
  st.used += promptChars + (outputChars || 0);
  await chrome.storage.local.set({ budgetState: st });
}

function budgetError(info) {
  return (
    `本月字符额度不足（已用 ${info.used} / 上限 ${info.limit} 字符，剩余 ${Math.max(0, info.remaining)}）。` +
    "可在设置页调高额度或关闭额度限制。"
  );
}

// ============ 双协议聊天请求 ============

const SYSTEM_PROMPT = "You are a professional translator for competitive programming websites.";

// 统一聊天请求：OpenAI 兼容 或 Anthropic 协议
// opts: {format, baseUrl, apiKey, model, user, maxTokens}
async function chatRequest(opts) {
  const base = (opts.baseUrl || "").replace(/\/+$/, "");

  // 自动纠正协议错配：Base URL 明显是 Anthropic 端点时强制按 Anthropic 处理
  let format = opts.format || "openai";
  if (/apps\/anthropic|api\.anthropic\.com/i.test(base)) format = "anthropic";

  if (format === "anthropic") {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens || 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: opts.user }]
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let detail = body.slice(0, 300);
      if (res.status === 404) {
        detail += "（提示：Anthropic 协议端点应为 .../v1/messages，请检查 Base URL，如 https://api.anthropic.com 或业务空间的 .../apps/anthropic）";
      } else if (res.status === 401) {
        detail += "（提示：API Key 无效或未授权）";
      }
      return { ok: false, error: `API 请求失败（HTTP ${res.status}）：${detail}` };
    }
    const data = await res.json();
    const content =
      data.content && data.content[0] && data.content[0].type === "text" ? data.content[0].text : "";
    if (!content) return { ok: false, error: "API 返回结果为空，请检查模型名称是否正确。" };
    return { ok: true, content };
  }

  // OpenAI 兼容（默认）
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`
    },
    body: JSON.stringify({
      model: opts.model || "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: opts.user }
      ],
      temperature: 0.2,
      max_tokens: opts.maxTokens || undefined
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail = body.slice(0, 300);
    if (res.status === 404 && body.includes("Model")) {
      detail += "（提示：模型名不存在，请把模型改为该服务商支持的名称，如 deepseek-chat、moonshot-v1-8k、qwen-plus 等）";
    } else if (res.status === 401) {
      detail += "（提示：API Key 无效或未授权）";
    }
    return { ok: false, error: `API 请求失败（HTTP ${res.status}）：${detail}` };
  }
  const data = await res.json();
  const content =
    data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) return { ok: false, error: "API 返回结果为空，请检查模型名称是否正确。" };
  return { ok: true, content };
}

// ============ 消息处理 ============

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;

  // 查询额度状态（设置页显示用量 / 内容脚本翻译前预估）
  if (msg.type === "at-ai-budget") {
    (async () => {
      const chk = await budgetCheck(0);
      if (!chk.enabled) {
        sendResponse({ enabled: false });
        return;
      }
      const st = await getBudgetState();
      sendResponse({
        enabled: true,
        month: st.month,
        used: st.used,
        limit: chk.limit,
        remaining: Math.max(0, chk.remaining)
      });
    })();
    return true;
  }

  // 重置本月用量（设置页按钮）
  if (msg.type === "at-ai-budget-reset") {
    (async () => {
      await chrome.storage.local.set({ budgetState: { month: currentMonth(), used: 0 } });
      sendResponse({ ok: true });
    })();
    return true;
  }

  // 测试连接（弹窗按钮用，与正式翻译同一通道，后台发请求不受 CORS 限制）
  if (msg.type === "at-ai-test") {
    (async () => {
      const result = await chatRequest({
        format: msg.apiFormat,
        baseUrl: msg.baseUrl,
        apiKey: msg.apiKey,
        model: msg.model,
        user: "Reply with the single word: OK",
        maxTokens: 5
      });
      sendResponse(result);
    })();
    return true;
  }

  if (msg.type !== "at-ai-translate") return false;

  (async () => {
    // 额度检查（prompt 字符 + 预留输出空间）
    const chk = await budgetCheck(msg.prompt.length + 2000);
    if (!chk.ok) {
      sendResponse({ ok: false, error: budgetError(chk) });
      return;
    }

    const result = await chatRequest({
      format: msg.apiFormat,
      baseUrl: msg.baseUrl,
      apiKey: msg.apiKey,
      model: msg.model,
      user: msg.prompt
    });
    if (!result.ok) {
      sendResponse(result);
      return;
    }

    // 成功后记账
    await budgetConsume(msg.prompt.length, result.content.length);
    sendResponse({ ok: true, content: result.content });
  })().catch((err) => {
    sendResponse({ ok: false, error: "网络请求失败：" + (err.message || String(err)) });
  });

  return true; // 异步响应
});
