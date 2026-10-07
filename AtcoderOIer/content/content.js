(function () {
  "use strict";

  const FLOAT_BTN_ID = "at-ai-float-btn";
  const TRANS_CONTAINER_ID = "at-ai-translation";

  function getConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        ["apiKey", "baseUrl", "model", "targetLang", "promptTemplate", "autoTranslate", "useCache", "apiFormat"],
        resolve
      );
    });
  }

  function isProblemPage() {
    return /^\/(contests\/[^/]+\/)?tasks\//.test(location.pathname);
  }

  // 根据页面类型选取主要内容区域
  function getMainContentEl() {
    // 题目页：只翻译题面，不翻译导航/提交框
    const stmt = document.querySelector("#task-statement");
    if (stmt) return stmt;

    // 比赛主页 / 提交 / 排行榜 / 公告等：取主内容列
    const candidates = [
      "#main-container .row > div:last-child",
      "#main-container",
      "main",
      "article",
      ".container .row div[class*='col-']:last-child"
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 50) return el;
    }
    return document.body;
  }

  function pageLabel() {
    if (isProblemPage()) return "题目描述";
    const nav = document.querySelector(".nav-tabs .active, .nav-tabs li.active a");
    if (nav && nav.textContent.trim()) return nav.textContent.trim();
    if (/^\/contests\/[^/]+\/submissions/.test(location.pathname)) return "提交列表";
    if (/^\/contests\/[^/]+\/standings/.test(location.pathname)) return "排行榜";
    if (/^\/contests\/[^/]+\/clarifications/.test(location.pathname)) return "提问列表";
    if (/^\/contests\/[^/]+\/tasks/.test(location.pathname)) return "题目列表";
    if (/^\/contests\/[^/]+/.test(location.pathname)) return "比赛信息";
    return "本页内容";
  }

  function buildPrompt(template, lang, label, text) {
    return (template || "")
      .replaceAll("{{lang}}", lang || "简体中文")
      .replaceAll("{{label}}", label || "本页内容")
      .replaceAll("{{text}}", text);
  }

  // 提取原文中的超链接（文字 + 绝对地址），供 AI 在译文中保留
  function extractLinks(el) {
    const seen = new Set();
    const links = [];
    for (const a of el.querySelectorAll("a[href]")) {
      const text = (a.innerText || "").trim();
      const url = a.href; // 属性已自动解析为绝对地址
      if (!text || !url) continue;
      const id = url + "|" + text;
      if (seen.has(id)) continue;
      seen.add(id);
      links.push({ text: text.slice(0, 80), url });
      if (links.length >= 80) break;
    }
    return links;
  }

  function buildLinksSection(links) {
    if (!links || !links.length) return "";
    const list = links
      .map((l, i) => `${i + 1}. 文字「${l.text}」 → ${l.url}`)
      .join("\n");
    return (
      "\n\n以下是原文中出现的超链接清单。翻译时请保留这些链接：在提到对应内容时，" +
      "用 Markdown 链接格式 [文字](URL) 标注，URL 必须原样保留、不得修改或省略；" +
      "清单中没有的内容不要编造链接。\n" + list
    );
  }

  // 查询本月字符额度（额度功能关闭时 enabled=false）
  function getBudget() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "at-ai-budget" }, (r) => {
        resolve(chrome.runtime.lastError ? { enabled: false } : r);
      });
    });
  }

  async function callAI(cfg, label, text, links, force) {
    if (!cfg.apiKey) {
      throw new Error("尚未配置 API Key，请点击浏览器工具栏上的扩展图标，在弹窗中填写配置。");
    }

    // 缓存命中（原文 + 目标语言一致）直接返回；force=true 时跳过缓存（重新翻译）
    let key = null;
    if (cfg.useCache) {
      key = await cacheKeyOf(text, links, cfg);
      if (!force) {
        const cached = await chrome.storage.local.get(key);
        if (cached[key] && cached[key].translation) {
          return cached[key].translation;
        }
      }
    }

    const EXTRA_RULES =
      "\n\n补充要求：5. 若内容包含 Markdown 表格，请保留表格结构逐行翻译，不得把表格转成纯文本列表；" +
      "6. 请保留文中的 Markdown 链接与图片语法。";

    const prompt =
      buildPrompt(cfg.promptTemplate, cfg.targetLang, label, text) +
      buildLinksSection(links) +
      EXTRA_RULES;
    // 通过扩展后台发请求，绕开页面的 CORS 限制
    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "at-ai-translate",
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          model: cfg.model,
          apiFormat: cfg.apiFormat,
          prompt
        },
        (r) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: "与扩展后台通信失败，请到 edge://extensions 重新加载扩展。" });
          } else {
            resolve(r);
          }
        }
      );
    });
    if (!resp || !resp.ok) {
      throw new Error((resp && resp.error) || "未知错误");
    }

    // 写入缓存（存不下就静默失败，不影响使用）
    if (key) {
      try {
        await chrome.storage.local.set({
          [key]: { translation: resp.content, ts: Date.now() }
        });
      } catch (e) { /* 存储超限等情况忽略 */ }
    }
    return resp.content;
  }

  // 缓存键：原文 + 链接清单 + 目标语言 + 模型的 SHA-256，任何一项变化都视为不同缓存
  async function cacheKeyOf(text, links, cfg) {
    try {
      const linksPart = (links || []).map((l) => l.url).join("|");
      const material = [text.length, text, linksPart, cfg.targetLang || "", cfg.model || ""].join("||");
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
      return "cache_" + Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch (e) {
      return null;
    }
  }

  // 真正的 Markdown 渲染（marked + DOMPurify 消毒）
  function renderMarkdown(md) {
    try {
      const html = marked.parse(md, { breaks: true, gfm: true });
      return DOMPurify.sanitize(html);
    } catch (e) {
      const div = document.createElement("div");
      div.textContent = md;
      return div.innerHTML;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // KaTeX 渲染公式（$...$、$$...$$、\(...\)、\[...\]，跳过 pre/code）
  function renderMath(el) {
    if (typeof renderMathInElement !== "function") return;
    try {
      renderMathInElement(el, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false },
          { left: "$", right: "$", display: false }
        ],
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
        throwOnError: false
      });
    } catch (e) {
      /* 公式渲染失败时保留原文 */
    }
  }

  // ============ 结构化提取：把 DOM 转成带格式的 Markdown 文本再发给 AI ============

  // HTML 表格 → GFM Markdown 表格
  function tableToMd(table) {
    const rows = [];
    for (const tr of table.querySelectorAll("tr")) {
      const cells = Array.from(tr.children).filter((c) => /^(TD|TH)$/.test(c.tagName));
      if (!cells.length) continue;
      rows.push(
        cells.map((c) =>
          c.innerText.trim().replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").replace(/[[\]]/g, "")
        )
      );
    }
    if (!rows.length) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const norm = rows.map((r) => {
      while (r.length < width) r.push("");
      return r;
    });
    const line = (r) => "| " + r.join(" | ") + " |";
    const sep = line(Array(width).fill("---"));
    return [line(norm[0]), sep, ...norm.slice(1).map(line)].join("\n");
  }

  function domToText(root) {
    const BLOCK = new Set([
      "DIV", "SECTION", "ARTICLE", "ASIDE", "UL", "OL", "P", "BLOCKQUOTE",
      "FORM", "FIELDSET", "HR", "MAIN", "FIGURE"
    ]);
    const SKIP_TAGS = new Set([
      "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS", "BUTTON", "SELECT",
      "INPUT", "TEXTAREA", "NAV", "HEADER", "FOOTER"
    ]);
    const SKIP_CLASS = /at-ai-mini-btn|at-ai-translation|at-ai-inline-trans|at-ai-panel/;

    function inlineText(el) {
      let out = "";
      for (const child of el.childNodes) out += walk(child);
      return out;
    }

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const tag = node.tagName;
      if (SKIP_TAGS.has(tag)) return "";
      if (typeof node.className === "string" && SKIP_CLASS.test(node.className)) return "";
      if (tag === "TABLE") return tableToMd(node) + "\n\n";
      if (tag === "PRE") return "\n```\n" + node.innerText.trim() + "\n```\n\n";
      if (/^H[1-6]$/.test(tag)) {
        return "\n" + "#".repeat(Number(tag[1])) + " " + inlineText(node).trim() + "\n\n";
      }
      if (tag === "LI") return "- " + inlineText(node).trim() + "\n";
      if (tag === "P") return inlineText(node).trim() + "\n\n";
      if (tag === "BR") return "\n";
      if (tag === "HR") return "\n---\n\n";
      if (tag === "IMG") return node.alt ? `![${node.alt}](${node.src}) ` : "";
      if (tag === "A") {
        const t = inlineText(node).trim();
        return t ? `[${t}](${node.href})` : "";
      }
      // 跳过不可见元素（折叠面板等）
      const cs = getComputedStyle(node);
      if (cs.display === "none" || cs.visibility === "hidden") return "";
      let out = "";
      for (const child of node.childNodes) out += walk(child);
      if (BLOCK.has(tag)) out += "\n";
      return out;
    }

    let out = "";
    for (const child of root.childNodes) out += walk(child);
    return out.replace(/\n{3,}/g, "\n\n").trim();
  }

  function makeStatusBar(target, msg, isError) {
    let bar = document.getElementById("at-ai-status-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "at-ai-status-bar";
      bar.className = "at-ai-panel";
      target.parentNode.insertBefore(bar, target);
    }
    bar.style.display = "block";
    bar.innerHTML = "";
    const div = document.createElement("div");
    div.className = "at-ai-status" + (isError ? " at-ai-error" : "");
    div.textContent = msg;
    bar.appendChild(div);
    return bar;
  }

  function hideStatusBar() {
    const bar = document.getElementById("at-ai-status-bar");
    if (bar) bar.remove();
  }

  // ============ 分段翻译：长内容切成小块，逐段翻译、逐段缓存，防止 token 失控 ============

  const CHUNK_SIZE = 3500;      // 每段目标大小（字符）
  const MAX_CHUNKS = 12;        // 单次最多翻译的段数（防爆token/欠费）
  const PAGE_CHAR_BUDGET = 40000; // 超过此长度先弹确认

  // 按 Markdown 标题切分，段内再按空行切，保证不把表格从中间切断
  function splitText(text) {
    const sections = text.split(/(?=^#{1,6}\s)/m).filter((s) => s.trim());
    const parts = [];
    for (const sec of sections) {
      if (sec.length <= CHUNK_SIZE) {
        parts.push(sec);
        continue;
      }
      const paras = sec.split(/\n\n+/);
      let buf = "";
      for (const p of paras) {
        if (buf && buf.length + p.length + 2 > CHUNK_SIZE) {
          parts.push(buf);
          buf = p;
        } else {
          buf = buf ? buf + "\n\n" + p : p;
        }
      }
      if (buf) parts.push(buf);
    }
    return parts.length ? parts : [text];
  }

  // ============ 题目页专用提取 ============
  // innerText 会在每个 MathJax 公式容器前后强制换行，把题面切成碎片。
  // 这里按行内/块级语义拼接：文字与公式同行，只在段落/标题/公式块之间换行。
  function statementText(root) {
    const BLOCK = new Set([
      "P", "DIV", "SECTION", "ARTICLE", "H1", "H2", "H3", "H4", "H5", "H6",
      "UL", "OL", "LI", "TABLE", "PRE", "BLOCKQUOTE", "HR"
    ]);
    const SKIP_TAGS = new Set([
      "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS", "BUTTON", "SELECT",
      "INPUT", "TEXTAREA", "NAV", "HEADER", "FOOTER"
    ]);
    // MathJax 隐藏定义 / 无障碍 MathML（内容与可见渲染重复）
    const SKIP_CLASS = /MathJax_(Hidden|MSIE)|mjx-assistive-mml|at-ai-/;

    // MathJax 独立成行的公式（v3: mjx-container[display=true]；v2: .mjx-display）
    function isDisplayMath(el) {
      const cls = typeof el.className === "string" ? el.className : "";
      if (el.tagName === "MJX-CONTAINER" && el.getAttribute("display") === "true") return true;
      if (/mjx-(math-)?display/.test(cls)) return true;
      return false;
    }

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const tag = node.tagName;
      if (SKIP_TAGS.has(tag)) return "";
      if (typeof node.className === "string" && SKIP_CLASS.test(node.className)) return "";
      if (tag === "BR") return "\n";
      if (tag === "TABLE") return tableToMd(node) + "\n\n";
      if (tag === "PRE") return "\n```\n" + node.textContent.trim() + "\n```\n\n";
      if (isDisplayMath(node)) {
        let t = "";
        for (const c of node.childNodes) t += walk(c);
        return "\n$$\n" + t.trim() + "\n$$\n";
      }
      let out = "";
      for (const child of node.childNodes) out += walk(child);
      if (BLOCK.has(tag)) out = "\n" + out.trim() + "\n";
      return out;
    }

    let out = "";
    for (const child of root.childNodes) out += walk(child);
    // 行内碎片之间的换行合并为单行；块间多个空行压成一个
    return out
      .split("\n")
      .map((l) => l.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // ============ 整页翻译：直接替换原文 ============

  async function doTranslate(btn) {
    const target = getMainContentEl();
    if (!target) return;

    // 已有译文时，再次点击 = 切换回原文
    const existing = document.getElementById(TRANS_CONTAINER_ID);
    if (existing) {
      toggleOriginal(target, existing);
      return;
    }

    const cfg = await getConfig();
    const label = pageLabel();
    // 题目页用专用提取器（公式与文字同行，避免被 MathJax 容器切碎），其余页面用结构化提取
    const text = target.id === "task-statement" ? statementText(target) : domToText(target);
    if (!text) {
      makeStatusBar(target, "未找到可翻译的内容。", true);
      return;
    }

    // 内容过长先确认，防止 token 失控
    if (text.length > PAGE_CHAR_BUDGET) {
      const ok = window.confirm(
        `本页内容很长（约 ${text.length} 字符），分段翻译会消耗较多 token，且最多只翻译前 ${MAX_CHUNKS} 段。\n` +
        `建议改用「翻译本条」逐条翻译。确定要继续整页翻译吗？`
      );
      if (!ok) return;
    }

    // 分段：小内容 1 段，长内容按章节切
    let parts = splitText(text);
    let truncated = false;
    if (parts.length > MAX_CHUNKS) {
      parts = parts.slice(0, MAX_CHUNKS);
      truncated = true;
    }

    // 额度预估：内容字符 + 每段提示词开销约 800 字符
    const budget = await getBudget();
    if (budget.enabled) {
      const estChars = parts.reduce((s, p) => s + p.length, 0) + parts.length * 800;
      if (estChars > budget.remaining) {
        makeStatusBar(
          target,
          `本月字符额度不足：本次预计需要约 ${estChars} 字符，本月剩余 ${budget.remaining} 字符。` +
          "请到设置页调高额度或关闭额度限制。",
          true
        );
        return;
      }
    }

    const links = extractLinks(document);

    // 先建好容器并隐藏原文，逐段追加译文
    const container = document.createElement("div");
    container.id = TRANS_CONTAINER_ID;
    container.className = "at-ai-translation";

    const header = document.createElement("div");
    header.className = "at-ai-trans-header";
    const title = document.createElement("span");
    title.className = "at-ai-trans-title";
    title.textContent = `🌐 AI 翻译 · ${label} → ${cfg.targetLang || "中文"}`;
    const btnGroup = document.createElement("span");
    btnGroup.className = "at-ai-header-btns";
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "at-ai-mini-btn";
    toggleBtn.textContent = "↩ 显示原文";
    toggleBtn.addEventListener("click", () => toggleOriginal(target, container));
    const retransBtn = document.createElement("button");
    retransBtn.className = "at-ai-mini-btn";
    retransBtn.textContent = "🔁 重新翻译";
    retransBtn.title = "跳过缓存，重新调用 AI 翻译本页";
    btnGroup.appendChild(toggleBtn);
    btnGroup.appendChild(retransBtn);
    header.appendChild(title);
    header.appendChild(btnGroup);
    container.appendChild(header);

    const progress = document.createElement("div");
    progress.className = "at-ai-progress";
    progress.textContent = parts.length > 1 ? `共 ${parts.length} 段，正在翻译第 1/${parts.length} 段…` : "正在翻译…";
    container.appendChild(progress);

    const body = document.createElement("div");
    body.className = "at-ai-trans-body";
    container.appendChild(body);

    target.style.display = "none";
    target.parentNode.insertBefore(container, target.nextSibling);
    container.scrollIntoView({ behavior: "smooth", block: "start" });

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "翻译中…";

    async function run(force) {
      retransBtn.disabled = true;
      body.innerHTML = "";
      // 清除旧的错误/截断提示
      container.querySelectorAll(".at-ai-error, .at-ai-truncated-note").forEach((n) => n.remove());
      progress.style.display = "";
      progress.textContent = parts.length > 1
        ? `共 ${parts.length} 段，正在翻译第 1/${parts.length} 段…`
        : (force ? "正在重新翻译…" : "正在翻译…");
      try {
        for (let i = 0; i < parts.length; i++) {
          const translated = await callAI(cfg, label, parts[i], i === 0 ? links : null, force);
          const chunkDiv = document.createElement("div");
          chunkDiv.className = "at-ai-chunk";
          chunkDiv.innerHTML = renderMarkdown(translated);
          renderMath(chunkDiv);
          body.appendChild(chunkDiv);
          if (parts.length > 1) {
            progress.textContent = `已翻译 ${i + 1}/${parts.length} 段` +
              (i + 1 < parts.length ? "，继续翻译中…" : "");
          }
        }
        if (truncated) {
          const note = document.createElement("div");
          note.className = "at-ai-progress at-ai-truncated-note";
          note.textContent = `内容过长，仅翻译了前 ${MAX_CHUNKS} 段。可点击「↩ 显示原文」查看剩余部分。`;
          container.appendChild(note);
        }
        if (parts.length === 1) progress.remove();
      } catch (err) {
        const errDiv = document.createElement("div");
        errDiv.className = "at-ai-progress at-ai-error";
        errDiv.textContent = "翻译中断：" + (err.message || String(err)) + "（已翻译的部分保留在上方）";
        container.appendChild(errDiv);
      } finally {
        retransBtn.disabled = false;
      }
    }

    retransBtn.addEventListener("click", async () => {
      // 强制重翻：确保当前显示的是译文面板
      target.style.display = "none";
      container.style.display = "";
      await run(true);
    });

    try {
      await run(false);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  function toggleOriginal(target, container) {
    const showingTrans = container.style.display !== "none";
    if (showingTrans) {
      container.style.display = "none";
      target.style.display = "";
    } else {
      target.style.display = "none";
      container.style.display = "";
    }
  }

  // ============ 讨论 / 帖子逐条翻译 ============

  // AtCoder 中帖子/讨论类内容常见的容器（刻意收窄，避免命中整页级容器）
  const POST_SELECTORS = [
    "#main-container .panel",        // 公告、提问（clarification）面板
    "#main-container .comment",      // 评论
    "#main-container article",       // 题解等文章块
    "#main-container [id^='comment-']"
  ];

  // 超过此字符数的块视为「整个页面」，不提供逐条翻译（请用左下角整页翻译按钮）
  const BLOCK_MAX_CHARS = 6000;

  // 取块内文本：结构化提取（自动排除本扩展注入的按钮和译文）
  function blockText(block) {
    return domToText(block);
  }

  // 表格为主的块（如首页赛程表）：实际翻译对象收窄为表格本身，
  // 避免把同面板里的侧栏等栏目一起翻译
  function pickTranslateTarget(block) {
    const tables = block.querySelectorAll("table");
    if (tables.length === 1) {
      const total = blockText(block).length;
      const tbl = (tables[0].innerText || "").trim().length;
      if (total > 0 && tbl / total >= 0.4) return tables[0];
    }
    return block;
  }

  async function translateBlock(btn, block) {
    // 已有译文时，再次点击 = 切换回原文
    const existing = block.__atAiTrans;
    if (existing && existing.isConnected) {
      toggleOriginal(existing.target, existing.container);
      return;
    }

    const target = pickTranslateTarget(block);

    const cfg = await getConfig();
    const text = blockText(target);
    if (!text) return;
    const MAX = 8000;
    const clipped = text.length > MAX ? text.slice(0, MAX) + "\n\n……（内容过长已截断）" : text;

    // 额度轻量预检
    const budget = await getBudget();
    if (budget.enabled && clipped.length + 1000 > budget.remaining) {
      btn.textContent = "额度不足";
      setTimeout(() => { btn.textContent = "🌐 翻译本条"; }, 2000);
      return;
    }

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "翻译中…";

    const container = document.createElement("div");
    container.className = "at-ai-translation at-ai-inline-trans";
    container.textContent = "正在翻译本条内容…";
    target.parentNode.insertBefore(container, target.nextSibling);
    target.style.display = "none";

    async function run(force) {
      container.classList.remove("at-ai-error");
      if (force) container.textContent = "正在重新翻译本条内容…";
      const translated = await callAI(cfg, "讨论/帖子", clipped, extractLinks(document), force);

      const header = document.createElement("div");
      header.className = "at-ai-trans-header";
      const title = document.createElement("span");
      title.className = "at-ai-trans-title";
      title.textContent = `🌐 AI 翻译 → ${cfg.targetLang || "中文"}`;
      const btnGroup = document.createElement("span");
      btnGroup.className = "at-ai-header-btns";
      const toggleBtn = document.createElement("button");
      toggleBtn.className = "at-ai-mini-btn";
      toggleBtn.textContent = "↩ 显示原文";
      toggleBtn.addEventListener("click", () => toggleOriginal(target, container));
      const retransBtn = document.createElement("button");
      retransBtn.className = "at-ai-mini-btn";
      retransBtn.textContent = "🔁 重新翻译";
      retransBtn.title = "跳过缓存，重新调用 AI 翻译本条";
      retransBtn.addEventListener("click", async () => {
        target.style.display = "none";
        container.style.display = "";
        retransBtn.disabled = true;
        try {
          await run(true);
        } finally {
          retransBtn.disabled = false;
        }
      });
      btnGroup.appendChild(toggleBtn);
      btnGroup.appendChild(retransBtn);
      header.appendChild(title);
      header.appendChild(btnGroup);

      const body = document.createElement("div");
      body.className = "at-ai-trans-body";
      body.innerHTML = renderMarkdown(translated);
      renderMath(body);

      container.innerHTML = "";
      container.appendChild(header);
      container.appendChild(body);
      block.__atAiTrans = { target, container };
    }

    try {
      await run(false);
    } catch (err) {
      container.textContent = err.message || String(err);
      container.classList.add("at-ai-error");
      target.style.display = "";
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  function injectPostButtons() {
    const root = document.querySelector("#main-container") || document.body;
    let blocks;
    try {
      blocks = root.querySelectorAll(POST_SELECTORS.join(","));
    } catch (e) {
      return;
    }
    for (const block of blocks) {
      if (block.closest(".at-ai-translation, .at-ai-inline-translation")) continue;
      // 跳过嵌套块（只给最外层加按钮）
      if (block.parentElement && block.parentElement.closest(POST_SELECTORS.join(","))) continue;
      const text = blockText(block);
      if (text.length < 20) continue; // 太短的（如导航碎片）不处理
      if (text.length > BLOCK_MAX_CHARS) continue; // 太大的块 = 整页，交给左下角按钮
      if (block.querySelector(":scope > .at-ai-mini-btn, :scope > div > .at-ai-mini-btn")) continue;

      const btn = document.createElement("button");
      btn.className = "at-ai-mini-btn";
      btn.textContent = "🌐 翻译本条";
      btn.title = "只翻译这条帖子/讨论";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        translateBlock(btn, block);
      });
      block.style.position = "relative";
      block.appendChild(btn);
    }
  }

  function injectFloatBtn(cfg) {
    if (document.getElementById(FLOAT_BTN_ID)) return;
    const btn = document.createElement("button");
    btn.id = FLOAT_BTN_ID;
    btn.textContent = "🌐 AI 翻译";
    btn.title = "翻译本页（" + pageLabel() + "）";
    btn.addEventListener("click", () => doTranslate(btn));
    document.body.appendChild(btn);
  }

  function init() {
    getConfig().then((cfg) => {
      injectFloatBtn(cfg);
      injectPostButtons();
      // 题目页且有自动翻译时直接翻译
      if (cfg.autoTranslate && cfg.apiKey && isProblemPage()) {
        doTranslate(document.getElementById(FLOAT_BTN_ID));
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
