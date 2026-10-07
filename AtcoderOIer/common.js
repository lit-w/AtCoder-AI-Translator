// 公共工具：API 域名权限检查
// 优先使用 chrome.permissions（可选权限模式）；浏览器不支持时自动降级为直接放行，
// 因为 manifest 已静态声明全部会用到的 API 域名，功能不受影响。
// 在 popup.html / options.html 中于各页面脚本之前引入

function baseUrlToOriginPattern(baseUrl) {
  try {
    const u = new URL((baseUrl || "").trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin + "/*";
  } catch (e) {
    return null;
  }
}

function permissionsApiAvailable() {
  return typeof chrome !== "undefined" && chrome.permissions &&
    typeof chrome.permissions.contains === "function" &&
    typeof chrome.permissions.request === "function";
}

// 检查是否已持有某 API 域名的访问权限；API 不可用时视为已授权（依赖静态声明）
function hasApiPermission(baseUrl) {
  if (!permissionsApiAvailable()) return Promise.resolve(true);
  const pattern = baseUrlToOriginPattern(baseUrl);
  if (!pattern) return Promise.resolve(true);
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: [pattern] }, (ok) => {
      resolve(chrome.runtime.lastError ? true : !!ok);
    });
  });
}

// 申请 API 域名权限（可选权限模式下使用）。必须在用户手势中调用。
// 返回 { ok, denied, pattern }；API 不可用时返回 { ok: true, skipped: true }
function ensureApiPermission(baseUrl) {
  const pattern = baseUrlToOriginPattern(baseUrl);
  if (!permissionsApiAvailable()) return Promise.resolve({ ok: true, skipped: true, pattern });
  if (!pattern) return Promise.resolve({ ok: false, denied: false, pattern: null });
  return new Promise((resolve) => {
    chrome.permissions.request({ origins: [pattern] }, (granted) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, denied: false, pattern, error: chrome.runtime.lastError.message });
        return;
      }
      resolve({ ok: !!granted, denied: !granted, pattern });
    });
  });
}
