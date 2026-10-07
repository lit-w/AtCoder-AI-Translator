# AtCoder AI Translator

一个 Edge 浏览器扩展（Manifest V3），在 AtCoder 全站通过 AI（OpenAI 兼容接口）一键翻译页面内容。

## 功能

- 在任意 AtCoder 页面（题目、比赛主页、题目列表、提交列表、排行榜、公告等）右下角注入常驻「🌐 AI 翻译」浮动按钮
- 智能选择主要内容区域：题目页只翻译题面，其余页面翻译主内容列
- **结构化提取**：翻译前把网页 DOM 转成带格式的 Markdown 文本（标题、表格转 GFM 表格、列表、代码块、链接内联），排行榜/提交列表等表格页面不再格式错乱；链接清单覆盖全页面，译文链接可点击
- **讨论 / 帖子逐条翻译**：公告、提问（clarification）、评论、题解帖等内容块自动附带「🌐 翻译本条」按钮，译文**替换原帖显示**（Markdown + KaTeX 完整渲染），可一键切回原帖
- 调用 OpenAI 兼容的 `/chat/completions` 接口，翻译结果**直接替换原文显示**（标题、表格、代码块、列表等 Markdown 完整渲染），可随时一键切回原文
- 内置 marked + DOMPurify：完整 Markdown 渲染并消毒，防止注入
- 内置 KaTeX：题面 LaTeX 公式（`$...$`、`$$...$$`、`\(...\)`、`\[...\]`）完整渲染为数学排版，代码块内的公式不渲染
- **弹窗内直接配置**：API Key、接口协议（OpenAI 兼容 / Anthropic 双协议）、接口地址、模型、目标语言、自动翻译开关，附「测试连接」
- 高级设置页支持自定义提示词模板（占位符：`{{lang}}`、`{{label}}`、`{{text}}`）
- **翻译缓存**：以原文 SHA-256 哈希为键（含目标语言与模型），同一内容再次访问直接命中缓存、零 token 消耗；设置页可开关、可一键清空并查看占用空间
- **分段翻译防欠费**：长页面按章节切成 ≤3500 字符的小段逐段翻译（不切断表格），每段独立缓存、逐段追加显示；单页最多翻 12 段，超过 4 万字符先弹确认，防止 token 失控
- **月度字符额度**：按「发送 + 返回」实际字符数记账，达到每月额度自动拦截翻译；额度、当前用量、手动重置都在设置页，每月自动清零
- API Key 只保存在本机浏览器（chrome.storage.sync）

## 安装（Edge）

1. 打开 `edge://extensions`
2. 左下角开启「开发人员模式」
3. 点击「加载解压缩的扩展」，选择本目录（`AtcoderOIer`）
4. 点击工具栏上的扩展图标，在弹窗中填入 API Key → 保存（可先「测试连接」）

## 配置示例

| 服务商 | Base URL |
| --- | --- |
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| Moonshot (Kimi) | `https://api.moonshot.cn/v1` |
| 阿里云百炼 (Qwen) | `https://dashscope.aliyuncs.com/compatible-mode/v1` |

## 文件结构

```
manifest.json          清单文件（名称/版本/描述/权限/默认语言）
background.js          Service Worker（初始化默认配置）
content/               内容脚本（浮动按钮 + 页面识别 + 调用 AI + 渲染翻译）
popup/                 扩展弹窗（API 配置表单 + 测试连接）
options/               高级设置页（自定义提示词模板）
icons/                 扩展图标（16/48/128）
_locales/zh_CN/        默认语言（中文）消息文件
```
