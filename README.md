# OpenCLI

> **Make any website your CLI.**  
> Zero risk · Reuse Chrome login · AI-powered discovery

[中文文档](./README.zh-CN.md)

[![npm](https://img.shields.io/npm/v/@jackwener/opencli)](https://www.npmjs.com/package/@jackwener/opencli)

A CLI tool that turns **any website** into a command-line interface. **47 commands** across **17 sites** — bilibili, zhihu, xiaohongshu, twitter, reddit, xueqiu, github, v2ex, hackernews, bbc, weibo, boss, yahoo-finance, reuters, smzdm, ctrip, youtube — powered by browser session reuse and AI-native discovery.

## Highlights

- **Account-safe** — Reuses Chrome's logged-in state; your credentials never leave the browser
- **AI Agent ready** — `explore` discovers APIs, `synthesize` generates adapters, `cascade` finds auth strategies
- **Dynamic Loader** — Simply drop `.ts` or `.yaml` adapters into the `clis/` folder for auto-registration
- **Dual-Engine Architecture**:
  - **YAML Declarative Engine**: Most adapters are minimal ~30 lines of YAML pipeline
  - **Native Browser Injection Engine**: Advanced TypeScript utilities (`installInterceptor`, `autoScroll`) for XHR hijacking, GraphQL unwrapping, and store mutation

## Quick Start

### Install via npm (recommended)

```bash
npm install -g @jackwener/opencli
```

Then use directly:

```bash
opencli list                              # See all commands
opencli hackernews top --limit 5          # Public API, no browser
opencli bilibili hot --limit 5            # Browser command
opencli zhihu hot -f json                 # JSON output
```

### Install from source

```bash
git clone git@github.com:jackwener/opencli.git
cd opencli && npm install
npx tsx src/main.ts list
```

### Update

```bash
# npm global
npm update -g @jackwener/opencli

# Or reinstall to latest
npm install -g @jackwener/opencli@latest
```

## Prerequisites

Browser commands need:
1. **Chrome** running **and logged into the target site** (e.g. bilibili.com, zhihu.com, xiaohongshu.com)
2. **[Playwright MCP Bridge](https://chromewebstore.google.com/detail/playwright-mcp-bridge/mmlmfjhmonkocbjadbfplnigmagldckm)** extension installed

This is the default connection mode — no extra configuration needed beyond installing the extension.

#### Alternative: Chrome 144+ CDP Auto-Discovery

For Chrome 144+, you can skip the extension and use built-in remote debugging instead:

1. Open `chrome://inspect#remote-debugging` in Chrome
2. Check **"Allow remote debugging for this browser instance"**
3. Set `OPENCLI_USE_CDP=1` before running opencli

You can also manually specify an endpoint via `OPENCLI_CDP_ENDPOINT` env var.

Public API commands (`hackernews`, `github search`, `v2ex`) need no browser at all.

> **⚠️ Important**: Browser commands reuse your Chrome login session. You must be logged into the target website in Chrome before running commands. If you get empty data or errors, check your login status first.

## Built-in Commands

| Site | Commands | Mode |
|------|----------|------|
| **bilibili** | `hot` `search` `me` `favorite` `history` `feed` `user-videos` `subtitle` `dynamic` `ranking` `following` | 🔐 Browser |
| **zhihu** | `hot` `search` `question` | 🔐 Browser |
| **xiaohongshu** | `search` `notifications` `feed` `me` `user` | 🔐 Browser |
| **xueqiu** | `feed` `hot-stock` `hot` `search` `stock` `watchlist` | 🔐 Browser |
| **twitter** | `trending` `bookmarks` `profile` `search` `timeline` | 🔐 Browser |
| **reddit** | `hot` `frontpage` `search` `subreddit` | 🔐 Browser |
| **weibo** | `hot` | 🔐 Browser |
| **boss** | `search` | 🔐 Browser |
| **youtube** | `search` | 🔐 Browser |
| **yahoo-finance** | `quote` | 🔐 Browser |
| **reuters** | `search` | 🔐 Browser |
| **smzdm** | `search` | 🔐 Browser |
| **ctrip** | `search` | 🔐 Browser |
| **github** | `search` | 🌐 Public |
| **v2ex** | `hot` `latest` `topic` | 🌐 Public |
| **hackernews** | `top` | 🌐 Public |
| **bbc** | `news` | 🌐 Public |

## Output Formats

```bash
opencli bilibili hot -f table   # Default: rich table
opencli bilibili hot -f json    # JSON (pipe to jq, feed to AI)
opencli bilibili hot -f md      # Markdown
opencli bilibili hot -f csv     # CSV
opencli bilibili hot -v         # Verbose: show pipeline steps
```

## AI Agent Workflow

> [!IMPORTANT]
> AI Agent 创建新适配器时，**必须先阅读 [CLI-CREATOR.md](./CLI-CREATOR.md)**，其中包含完整的浏览器探索工作流、认证策略决策树和调试指南。

```bash
# 1. Deep Explore — discover APIs, infer capabilities, detect framework
opencli explore https://example.com --site mysite

# 2. Synthesize — generate YAML adapters from explore artifacts
opencli synthesize mysite

# 3. Generate — one-shot: explore → synthesize → register
opencli generate https://example.com --goal "hot"

# 4. Strategy Cascade — auto-probe: PUBLIC → COOKIE → HEADER
opencli cascade https://api.example.com/data
```

Explore outputs to `.opencli/explore/<site>/`:
- `manifest.json` — site metadata, framework detection
- `endpoints.json` — scored API endpoints with response schemas
- `capabilities.json` — inferred capabilities with confidence scores
- `auth.json` — authentication strategy recommendations

## Create New Commands

> [!CAUTION]
> **必须先阅读 [CLI-CREATOR.md](./CLI-CREATOR.md)！** 它是适配器开发的完全指南，包含 API 发现工作流、5 级认证策略、平台 SDK 参考、YAML/TS 选择决策树、`tap` 调试流程和常见陷阱。**跳过此文档直接写代码会导致大量可避免的错误。**

## Releasing New Versions

```bash
# Bump version
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.0 → 0.2.0
npm version major   # 0.1.0 → 1.0.0

# Push tag to trigger GitHub Actions auto-release
git push --follow-tags
```

The CI will automatically build, create a GitHub release, and publish to npm.

## License

[BSD-3-Clause](./LICENSE)
