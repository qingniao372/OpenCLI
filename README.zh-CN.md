# OpenCLI

> **把任何网站变成你的命令行工具。**  
> 零风控 · 复用 Chrome 登录 · AI 自动发现接口

[English](./README.md)

[![npm](https://img.shields.io/npm/v/@jackwener/opencli)](https://www.npmjs.com/package/@jackwener/opencli)

OpenCLI 通过 Chrome 浏览器 + [Playwright MCP Bridge](https://github.com/nichochar/playwright-mcp) 扩展，将任何网站变成命令行工具。不存密码、不泄 token，直接复用浏览器已登录状态。

## 亮点

- **47 个命令，17 个站点** — B站、知乎、小红书、Twitter、Reddit、雪球(xueqiu)、GitHub、V2EX、Hacker News、BBC、微博、BOSS直聘、Yahoo Finance、路透社、什么值得买、携程、YouTube
- **零风控** — 复用 Chrome 登录态，无需存储任何凭证
- **AI 原生** — `explore` 自动发现 API，`synthesize` 生成适配器，`cascade` 探测认证策略
- **动态加载引擎** — 只需将 `.ts` 或 `.yaml` 适配器放入 `clis/` 文件夹即可自动注册生效
- **双引擎架构设计**:
  - **YAML 声明式引擎**：大部分适配器只需极简的 ~30 行 YAML 声明
  - **原生浏览器注入引擎**：提供高级 TS API（`installInterceptor`、`autoScroll`）轻松实现 XHR 劫持、GraphQL 解包及状态库注入

## 快速开始

### npm 全局安装（推荐）

```bash
npm install -g @jackwener/opencli
```

直接使用：

```bash
opencli list                              # 查看所有命令
opencli hackernews top --limit 5          # 公共 API，无需浏览器
opencli bilibili hot --limit 5            # 浏览器命令
opencli zhihu hot -f json                 # JSON 输出
```

### 从源码安装

```bash
git clone git@github.com:jackwener/opencli.git
cd opencli && npm install
npx tsx src/main.ts list
```

### 更新

```bash
# npm 全局更新
npm update -g @jackwener/opencli

# 或直接安装最新版
npm install -g @jackwener/opencli@latest
```

## 前置要求

浏览器命令需要：
1. **Chrome** 浏览器正在运行，且**已登录目标网站**（如 bilibili.com、zhihu.com、xiaohongshu.com）
2. 安装 **[Playwright MCP Bridge](https://chromewebstore.google.com/detail/playwright-mcp-bridge/mmlmfjhmonkocbjadbfplnigmagldckm)** 扩展

这是默认连接方式——安装扩展后无需额外配置。

#### 可选：Chrome 144+ CDP 自动发现

如果使用 Chrome 144+，可以跳过扩展，改用内置远程调试：

1. 在 Chrome 中打开 `chrome://inspect#remote-debugging`
2. 勾选 **"允许对此浏览器实例进行远程调试"**
3. 运行时设置 `OPENCLI_USE_CDP=1`

也可通过 `OPENCLI_CDP_ENDPOINT` 环境变量手动指定 CDP endpoint。

公共 API 命令（`hackernews`、`github search`、`v2ex`）无需浏览器。

> **⚠️ 重要**：浏览器命令复用你的 Chrome 登录状态。运行命令前，你必须已在 Chrome 中登录目标网站。如果获取到空数据或报错，请先检查登录状态。

## 内置命令

| 站点 | 命令 | 模式 |
|------|------|------|
| **bilibili** | `hot` `search` `me` `favorite` `history` `feed` `user-videos` `subtitle` `dynamic` `ranking` `following` | 🔐 浏览器 |
| **zhihu** | `hot` `search` `question` | 🔐 浏览器 |
| **xiaohongshu** | `search` `notifications` `feed` `me` `user` | 🔐 浏览器 |
| **xueqiu** | `feed` `hot-stock` `hot` `search` `stock` `watchlist` | 🔐 浏览器 |
| **twitter** | `trending` `bookmarks` `profile` `search` `timeline` | 🔐 浏览器 |
| **reddit** | `hot` `frontpage` `search` `subreddit` | 🔐 浏览器 |
| **weibo** | `hot` | 🔐 浏览器 |
| **boss** | `search` | 🔐 浏览器 |
| **youtube** | `search` | 🔐 浏览器 |
| **yahoo-finance** | `quote` | 🔐 浏览器 |
| **reuters** | `search` | 🔐 浏览器 |
| **smzdm** | `search` | 🔐 浏览器 |
| **ctrip** | `search` | 🔐 浏览器 |
| **github** | `search` | 🌐 公共 API |
| **v2ex** | `hot` `latest` `topic` | 🌐 公共 API |
| **hackernews** | `top` | 🌐 公共 API |
| **bbc** | `news` | 🌐 公共 API |

## 输出格式

```bash
opencli bilibili hot -f table   # 默认：表格
opencli bilibili hot -f json    # JSON（可 pipe 给 jq 或 AI agent）
opencli bilibili hot -f md      # Markdown
opencli bilibili hot -f csv     # CSV
opencli bilibili hot -v         # 详细模式：展示 pipeline 每步数据
```

## AI Agent 工作流

> [!IMPORTANT]
> AI Agent 创建新适配器时，**必须先阅读 [CLI-CREATOR.md](./CLI-CREATOR.md)**，其中包含完整的浏览器探索工作流、认证策略决策树和调试指南。

```bash
# 1. Deep Explore — 网络拦截 → 响应分析 → 能力推理 → 框架检测
opencli explore https://example.com --site mysite

# 2. Synthesize — 从探索成果物生成 evaluate-based YAML 适配器
opencli synthesize mysite

# 3. Generate — 一键完成：探索 → 合成 → 注册
opencli generate https://example.com --goal "hot"

# 4. Strategy Cascade — 自动降级探测：PUBLIC → COOKIE → HEADER
opencli cascade https://api.example.com/data
```

探索结果输出到 `.opencli/explore/<site>/`：
- `manifest.json` — 站点元数据、框架检测结果
- `endpoints.json` — 评分排序的 API 端点，含响应 schema
- `capabilities.json` — 推理出的能力及置信度
- `auth.json` — 认证策略建议

## 创建新命令

> [!CAUTION]
> **必须先阅读 [CLI-CREATOR.md](./CLI-CREATOR.md)！** 它是适配器开发的完全指南，包含 API 发现工作流、5 级认证策略、平台 SDK 参考、YAML/TS 选择决策树、`tap` 调试流程和常见陷阱。**跳过此文档直接写代码会导致大量可避免的错误。**

## 版本发布

```bash
# 升级版本号
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.0 → 0.2.0
npm version major   # 0.1.0 → 1.0.0

# 推送 tag，GitHub Actions 自动发 release 并发布到 npm
git push --follow-tags
```

## License

[BSD-3-Clause](./LICENSE)
