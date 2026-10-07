const FIELDS = ["apiKey", "baseUrl", "apiFormat", "model", "targetLang", "autoTranslate"];
const els = {};
for (const f of FIELDS) els[f] = document.getElementById(f);
const statusEl = document.getElementById("status");

function setStatus(msg, ok) {
  statusEl.textContent = msg;
  statusEl.className = ok === true ? "ok" : ok === false ? "err" : "";
}

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.sync.get(FIELDS, (cfg) => {
    for (const f of FIELDS) {
      if (cfg[f] !== undefined) {
        if (f === "autoTranslate") els[f].checked = !!cfg[f];
        else els[f].value = cfg[f];
      }
    }
    if (cfg.apiKey) setStatus("✅ API Key 已配置");
  });

  document.getElementById("openOptions").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById("saveBtn").addEventListener("click", () => {
    const cfg = {};
    for (const f of FIELDS) {
      cfg[f] = f === "autoTranslate" ? els[f].checked : els[f].value.trim();
    }
    chrome.storage.sync.set(cfg, async () => {
      setStatus("✅ 已保存", true);
      // 检查 API 域名权限；缺失时提示去高级设置授权（权限请求弹窗场景下更稳定）
      if (cfg.baseUrl) {
        const had = await hasApiPermission(cfg.baseUrl);
        if (!had) {
          setStatus("⚠️ 已保存。首次使用此接口请到「⚙️ 高级设置」点一次保存，授权 API 域名访问", false);
          return;
        }
      }
      setTimeout(() => setStatus(cfg.apiKey ? "✅ API Key 已配置" : ""), 2500);
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
      // 走扩展后台发请求：不受页面/弹窗 CORS 限制
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: "at-ai-test", baseUrl: base, apiKey, model, apiFormat: els.apiFormat.value },
          (r) => resolve(chrome.runtime.lastError ? { ok: false, error: "后台通信失败，请重新加载扩展" } : r)
        );
      });
      if (resp.ok) {
        setStatus("✅ 连接成功，配置可用", true);
      } else {
        setStatus("❌ " + (resp.error || "连接失败").slice(0, 150), false);
      }
    } catch (err) {
      setStatus("❌ 请求失败：" + (err.message || err), false);
    }
  });
});
