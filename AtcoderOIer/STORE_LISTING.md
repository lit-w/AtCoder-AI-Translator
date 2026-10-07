# Edge 商店上架材料清单

## 商店信息（Partner Center 填写）

**名称（Name）**
AtCoder AI Translator

**简短描述（Short description，≤ 256 字符）**
使用 AI 一键翻译 AtCoder 全站内容：题目、公告、题解、评论、排行榜。支持 OpenAI 兼容与 Anthropic 接口，自定义 API Key、模型、翻译缓存与额度控制。

**详细描述（Detailed description）**
AtCoder AI Translator 是面向競技プログラミング选手的浏览器扩展，把 AtCoder 网站的日语/英语内容实时翻译成你的母语。

主要功能：
• 全站翻译：题目描述、比赛公告、题解、评论、提问、排行榜、提交列表，点击左下角浮动按钮即可整页翻译，译文直接替换原文显示，可随时切回。
• 逐条翻译：公告、题解帖、评论等内容块自动附带"翻译本条"按钮，只翻译当前这一条。
• 双协议支持：兼容 OpenAI（/chat/completions）与 Anthropic（/v1/messages）两种 API 协议，OpenAI 兼容接口的服务商（DeepSeek、Kimi、通义千问、Azure、各类中转站等）均可使用。
• 完整 Markdown 渲染：标题、表格、代码块、列表、超链接全部保留排版；LaTeX 公式（KaTeX）渲染为数学符号。
• 翻译缓存：以原文哈希为键缓存译文，重复访问零消耗；可设置页一键清空。
• 月度字符额度：按实际字符数记账，超限自动拦截，防止意外欠费。
• 隐私安全：API Key 只保存在本机浏览器，翻译请求由扩展后台直连 AI 服务商，不经过任何第三方服务器。

使用方式：
1. 安装后点击工具栏上的扩展图标；
2. 填入你的 API Key、接口地址与模型（支持 OpenAI 兼容或 Anthropic 协议）；
3. 打开任意 AtCoder 页面，点击"🌐 AI 翻译"按钮即可。

**类别（Category）**
开发者工具 / Developer tools（备选：辅助功能 Accessibility）

**语言**
中文（简体）、英文、日文（商店支持多语言列表）

## 所需素材

| 素材 | 规格 | 状态 |
| --- | --- | --- |
| 商店图标 | 300x300 PNG（可用 icons/icon128.png 放大重制） | 待制作高清版 |
| 截图 | 1280x800 或 640x400 PNG，至少 1 张、最多 10 张 | 待截取（翻译前后的 AtCoder 题目页对比图效果最佳） |
| 隐私政策 URL | 需公网可访问（可把 PRIVACY.md 托管到 GitHub Pages） | 待部署 |

## 提交流程

1. 注册 [Partner Center](https://partner.microsoft.com/dashboard) 开发者账号（免费）
2. 创建加载项 → 上传商店 zip 包
3. 填写以上商店信息、上传截图与图标
4. 在"可用性"选择免费 + 全部市场
5. 在"属性"中声明：不收集个人数据；API Key 仅本机存储
6. 在"证书/隐私"页粘贴隐私政策 URL
7. 提交审核（通常 3～7 个工作日）
