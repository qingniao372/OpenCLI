---

name: opencli-usage
description: OpenCLI 顶层入口——了解 opencli 能做什么、如何发现适配器、通用参数和输出格式。当 agent 问"opencli 能做什么"或"怎么找命令"时加载此 skill。
allowed-tools: Bash(opencli:*), Read
---

# opencli-usage（CDP 直连模式）

OpenCLI 将任何网站、Electron 桌面应用或外部 CLI 统一为 `opencli <site> <command>` 接口，agent 无需屏幕抓取即可驱动。

**运行模式：CDP 直连**。通过 `OPENCLI_CDP_ENDPOINT` 连接外部 Chrome 实例，不需要扩展、不需要 daemon、不需要 Browser Bridge。

## 三大能力

| 能力 | 命令形式 | 说明 |
|------|---------|------|
| **适配器命令** | `opencli <site> <command>` | 内置 100+ 站点适配器，按 strategy 区分是否需要浏览器 |
| **浏览器驱动** | `opencli browser *` | 即时交互：导航、点击、填表、提取数据、网络抓包。见 `opencli-browser` |
| **外部 CLI 透传** | `opencli gh` / `opencli docker` 等 | 通过统一入口调用已注册的外部工具 |

## 安装

```bash
# 从本地 fork 安装（唯一正确方式）
cd /opt/data/home/tools/opencli
npm install -g .

# 验证
opencli --version          # 1.7.6+
opencli browser images --help  # 自定义命令存在 = 安装正确
```

⚠️ 不要用 `npm install -g @jackwener/opencli`，官方包没有 CDP 补丁和自定义命令。

## 环境变量（必须配置）

```bash
# CDP 浏览器端点（必须）
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9222"

# 写入持久化（Hermes 用 dash shell）
echo 'export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9222"' >> ~/.profile
echo 'export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9222"' >> ~/.shrc
```

完整环境变量表：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENCLI_CDP_ENDPOINT` | **必填** | CDP 浏览器地址，如 `http://127.0.0.1:9222` |
| `OPENCLI_BROWSER_CONNECT_TIMEOUT` | `30` | CDP 连接超时（秒） |
| `OPENCLI_BROWSER_COMMAND_TIMEOUT` | `60` | 单命令超时（秒） |
| `OPENCLI_BROWSER_EXPLORE_TIMEOUT` | `120` | 长时间侦察超时（秒） |
| `OPENCLI_CACHE_DIR` | `~/.opencli/cache` | 网络缓存 + 浏览器状态缓存 |
| `OPENCLI_WINDOW_FOCUSED` | `false` | 设为 `1` 则自动化窗口前台打开 |
| `OPENCLI_VERBOSE` | `false` | 详细日志 |
| `OPENCLI_DIAGNOSTIC` | `false` | 设为 `1` 输出 RepairContext JSON（供 autofix 用） |

## 各 Strategy 对浏览器的需求

| Strategy | 需要浏览器？ | 说明 |
|----------|:-----------:|------|
| `PUBLIC` | ❌ | 纯 HTTP，无需浏览器 |
| `LOCAL` | ❌ | 本地/开发端点 |
| `COOKIE` | ✅ | 需要 Chrome 已登录目标站点（CDP 共享 session） |
| `HEADER` | ✅ | 同 COOKIE |
| `INTERCEPT` | ✅ | 同 COOKIE + 自动化窗口捕获签名请求 |
| `UI` | ✅ | 完整 DOM 交互 |

Electron 桌面应用（cursor, codex, chatwise, notion, discord-app, doubao-app, antigravity, chatgpt-app）通过 CDP 连接运行中的应用，无需 cookie。确保应用正在运行即可。

## 发现可用命令

不要硬编码适配器列表——每周都在变。用命令查：

```bash
opencli list                # 按站点分组的表格
opencli list -f json        # 机器可读，适合 agent
opencli list | grep twitter # 找特定站点的命令
opencli <site> --help       # 查看某站点所有子命令
opencli <site> <cmd> --help # 查看具体参数
```

`opencli list -f json` 是唯一权威来源，每条包含 `{site, name, description, strategy, browser, args, columns}`。

## 通用参数（所有适配器命令都支持）

| 参数 | 效果 |
|------|------|
| `-f, --format <fmt>` | `table`（TTY 默认）· `yaml`（非 TTY 默认）· `json` · `plain` · `md` · `csv`。Agent 几乎总是用 `-f json` |
| `-v, --verbose` | 调试日志 + 错误堆栈 |

各命令自有参数（`--limit`, `--tab`, `--filter` 等）需查阅 `--help`。

## 输出格式

| 格式 | 适用场景 |
|------|---------|
| `json` | Agent 首选，2 缩进 pretty-print |
| `plain` | 单字段输出（response/content/text/value），适合管道 |
| `yaml` | 非 TTY 且未指定 `-f` 时的 fallback |
| `table` | 彩色表格，给人看的 |
| `md` / `csv` | 表格导出 |

部分命令通过 `cmd.defaultFormat` 覆盖默认值（如 chat 命令默认 `plain`），不要假设，看 `--help`。

## 自适应修复（AutoFix）

当适配器因网站改版失败时，CLI 会提示：`# AutoFix: re-run with OPENCLI_DIAGNOSTIC=1 ...`。按提示执行，读取 `RepairContext`，修补适配器源文件后重试。最多 3 轮。完整流程见 `opencli-autofix`。

## 编写自定义适配器

两种存储路径：

- **私有**：`~/.opencli/clis/<site>/<command>.js` — 免 build，即写即用
- **公开/PR**：`clis/<site>/<command>.js` — 需贡献上游，要 build

脚手架与验证：

```bash
opencli browser init <site>/<command>   # 生成骨架
opencli validate [target]               # 语义检查（无网络、无浏览器）
opencli verify [target] [--smoke]       # 合成参数试跑
opencli browser verify <site>/<command> # CDP 端到端验证
```

适配器只引入 `@jackwener/opencli/registry` 和 `@jackwener/opencli/errors`。`columns` 必须与 `func` 返回对象的 keys 一一对应（含顺序）。完整流程见 `opencli-adapter-author`。

## 插件

```bash
opencli plugin install github:user/repo    # 安装
opencli plugin list [-f json]              # 查看
opencli plugin update [name] | --all       # 更新
opencli plugin uninstall <name>
opencli plugin create <name>               # 创建骨架
```

## 外部 CLI 透传

```bash
opencli install gh             # 按 external-clis.yaml 自动安装
opencli register my-tool \
    --binary my-tool \
    --install "npm i -g my-tool" \
    --desc "My internal CLI"
opencli gh pr list --limit 5   # 透传，stdin/stdout/exit code 直接传递
```

内置条目在 `src/external-clis.yaml`，用户自定义在 `~/.opencli/external-clis.yaml`。常见内置：`gh`, `docker`, `vercel`, `lark-cli`, `dws`, `wecom-cli`, `obsidian`。

## Shell 补全

```bash
opencli completion bash   # 也支持 zsh, fish
```

## 下一步

| 你要做的事 | 加载 skill |
|-----------|-----------|
| 即时驱动浏览器（无适配器或原型验证） | `opencli-browser` |
| 写新适配器或给已有站点加命令 | `opencli-adapter-author` |
| 修复损坏的适配器 | `opencli-autofix` |
| 搜索/查询/研究路由 | `smart-search` |

## 已废弃的命令

以下在 PR #1094 合并中移除，不要使用：

- `opencli explore <url>` — 已被 `opencli browser network` + `opencli browser find` 和 `opencli-adapter-author` 工作流替代
- `opencli record <url>` — 已移除；手动抓包用 `opencli browser network --detail`
- `opencli web read` / `opencli desktop *` 作为顶级分组 — 已折叠到各自适配器中

## 注意事项

- 不要把命令列表粘贴到计划里——会过时。每次任务开始时跑 `opencli list -f json`。
- 不要假设所有适配器都需要浏览器——`PUBLIC` 和 `LOCAL` 不需要，先查 `strategy` 字段。
- 适配器失败时不要静默回退到手写 `fetch`——先用 `OPENCLI_DIAGNOSTIC=1` 诊断，几乎总能告诉你该改什么。
