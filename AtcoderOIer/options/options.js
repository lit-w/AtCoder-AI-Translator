const FIELDS = ["apiKey", "baseUrl", "apiFormat", "model", "targetLang", "promptTemplate", "autoTranslate", "useCache", "budgetEnabled", "budgetChars"];
const CHECK_FIELDS = ["autoTranslate", "useCache", "budgetEnabled"];
const els = {};
for (const f of FIELDS) els[f] = document.getElementById(f);
els.budgetWan = document.getElementById("budgetWan"); // 存储键 budgetChars，输入框 id 为 budgetWan
const statusEl = document.getElementById("status");

function setStatus(msg, ok) {
  statusEl.textContent = msg;
  statusEl.className = ok === true ? "ok" : ok === false ? "err" : "";
}

// 显示当前缓存条数与占用空间
function refreshCacheInfo() {
  chrome.storage.local.get(null, (items) => {
    const keys = Object.keys(items).filter((k) => k.startsWith("cache_"));
    let bytes = 0;
    for (const k of keys) bytes += (items[k].translation || "").length * 2;
    const kb = (bytes / 1024).toFixed(0);
    document.getElementById("cacheInfo").textContent =
      `（当前 ${keys.length} 条，约 ${kb} KB）`;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.sync.get(FIELDS, (cfg) => {
    for (const f of FIELDS) {
      if (cfg[f] === undefined) continue;
      if (CHECK_FIELDS.includes(f)) els[f].checked = !!cfg[f];
      else if (f === "budgetChars") els.budgetWan.value = Math.round((cfg[f] || 0) / 10000);
      else els[f].value = cfg[f];
    }
  });

  refreshCacheInfo();
  refreshBudgetInfo();

  document.getElementById("resetBudgetBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "at-ai-budget-reset" }, () => {
      refreshBudgetInfo();
      setStatus("本月用量已重置", true);
      setTimeout(() => setStatus(""), 2500);
    });
  });

  document.getElementById("clearCacheBtn").addEventListener("click", () => {
    chrome.storage.local.get(null, (items) => {
      const keys = Object.keys(items).filter((k) => k.startsWith("cache_"));
      chrome.storage.local.remove(keys, () => {
        refreshCacheInfo();
        setStatus(`已删除 ${keys.length} 条缓存`, true);
        setTimeout(() => setStatus(""), 3000);
      });
    });
  });
});

// 显示本月字符用量
function refreshBudgetInfo() {
  chrome.runtime.sendMessage({ type: "at-ai-budget" }, (r) => {
    const el = document.getElementById("budgetUsed");
    if (!el) return;
    if (!r || !r.enabled) {
      el.textContent = "额度功能未启用";
    } else {
      el.textContent = `${r.month} 月已用 ${r.used.toLocaleString()} / ${r.limit.toLocaleString()} 字符（剩余 ${r.remaining.toLocaleString()}）`;
    }
  });
}

document.getElementById("saveBtn").addEventListener("click", () => {
  const cfg = {};
  for (const f of FIELDS) {
    if (f === "budgetChars") {
      const wan = parseFloat(els.budgetWan.value) || 100;
      cfg[f] = Math.round(wan * 10000);
    } else if (CHECK_FIELDS.includes(f)) {
      cfg[f] = els[f].checked;
    } else {
      cfg[f] = els[f].value.trim();
    }
  }
  chrome.storage.sync.set(cfg, async () => {
    setStatus("✅ 已保存", true);

    // 保存后按需申请 API 域名权限（可选权限模式；此处处于用户点击手势中）
    if (cfg.baseUrl) {
      const had = await hasApiPermission(cfg.baseUrl);
      if (!had) {
        const r = await ensureApiPermission(cfg.baseUrl);
        if (r.denied) {
          setStatus("⚠️ 已保存，但你拒绝了 API 域名访问权限，翻译请求可能被浏览器拦截", false);
        } else if (r.ok) {
          setStatus("✅ 已保存，API 域名访问权限已授权", true);
        }
      }
    }
    setTimeout(() => setStatus(""), 4000);
  });
});

document.getElementById("testBtn").addEventListener("click", async () => {
  const apiKey = els.apiKey.value.trim();
  const base = els.baseUrl.value.trim().replace(/\/+$/, "") || "https://api.openai.com/v1";
  const model = els.model.value.trim() || "gpt-4o-mini";
  if (!apiKey) {
    setStatus("请先填写 API Key", false);
    return;
  }
  setStatus("正在测试连接…");
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with the single word: OK" }],
        max_tokens: 5
      })
    });
    if (res.ok) {
      setStatus("✅ 连接成功，配置可用", true);
    } else {
      const body = await res.text().catch(() => "");
      setStatus(`❌ HTTP ${res.status}：${body.slice(0, 120)}`, false);
    }
  } catch (err) {
    setStatus("❌ 请求失败：" + (err.message || err), false);
  }
});
