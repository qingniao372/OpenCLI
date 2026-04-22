---

name: opencli-browser
description: 通过 opencli CDP 模式驱动 Chrome 浏览器——检查页面、填表、点击登录流程、即时提取数据。涵盖选择器目标约定、复合表单控件、过期引用处理、网络抓包。不用于写适配器（见 opencli-adapter-author）。
allowed-tools: Bash(opencli:*), Read, Edit, Write
---

# opencli-browser（CDP 直连模式）

通过 CDP 协议驱动外部 Chrome 实例，每个子命令返回结构化信封，告诉你匹配了什么、置信度多少、下一步该做什么。**信靠这些信封，不要猜**。

> **运行前提：CDP 直连模式**。环境变量 `OPENCLI_CDP_ENDPOINT` 必须指向运行中的 Chrome。
>
> **自定义命令**：`browser images` — 提取页面图片 URL 和 alt text（`--limit` / `--json`）。
>
> **Hang 修复**：已将 `ws.close()` 改为 `ws.terminate()`，命令执行完毕正常退出。

## 前置检查

```bash
# 1. 环境变量
echo $OPENCLI_CDP_ENDPOINT   # 应输出 http://127.0.0.1:9222

# 2. 浏览器可达
curl -s http://127.0.0.1:9222/json/version | head -3

# 3. 快速验证
opencli browser open "https://www.google.com"   # 输出 Navigated to... = 成功
```

三项都通过即可工作。不需要 `opencli doctor`，不需要扩展安装。

---

## 窗口生命周期

- `opencli browser *` 命令之间保持同一 CDP 连接和自动化 session。窗口持续打开直到 `opencli browser close` 或空闲超时。
- `--focus`（或 `OPENCLI_WINDOW_FOCUSED=1`）让自动化窗口前台打开，适合观察页面实时状态。
- `--live`（或 `OPENCLI_LIVE=1`）主要用于浏览器型适配器命令（如 `opencli xiaohongshu note ...`），命令返回后保持窗口打开供检查。

---

## 核心心智模型

1. **选择器优先的目标约定。** 所有交互命令（`click`, `type`, `select`, `get text/value/attributes`）接受 `<target>`，要么是 `state`/`find` 返回的数字 ref，要么是 CSS 选择器。用 `--nth <n>` 消除歧义。
2. **每个信封报告 `matches_n` 和 `match_level`。** `match_level` 为 `exact` / `stable` / `reidentified` —— CLI 已帮你处理了中等程度的 DOM 偏移，这个级别告诉你该多自信。
3. **紧凑输出优先，按需获取完整载荷。** `state` 是有预算的快照；`get html --as json` 支持 `--depth/--children-max/--text-max`；`network` 返回形状预览，用 `--detail <key>` 获取单个完整 body。别发巨型输出浪费 context。
4. **结构化错误可机器读取。** 失败时 CLI 返回 `{error: {code, message, hint?, candidates?}}`。按 `code` 分支，不要按消息文本。

---

## 关键规则

1. **先检查再操作。** 先跑 `state` 或 `find`。不要跨 session 硬编码 ref 或选择器——索引是按快照分配的。
2. **有数字 ref 后优先用它。** 数字 ref 能抵抗轻微 DOM 偏移（CLI 对每个元素做了指纹）。手写 CSS 选择器在站点首次重渲染就会断。
3. **每次写入后读 `match_level`。** `exact` = 一切好。`stable` = 元素相同但软属性偏移了——操作仍生效。`reidentified` = 原 ref 消失，CLI 找到唯一替代品重新打标——**确认你点对了元素再继续**。
4. **用 `compound` 字段处理表单控件。** 不要正则猜日期格式，不要跑两次 `state` 获取 `<select>` 选项列表。compound 信封包含格式字符串、完整选项列表（最多 50 条）、`options_total` 溢出标记、文件 input 的 `accept`/`multiple`。
5. **验证重要写入。** `type` 之后跑 `get value`，`select` 之后也跑 `get value`。自动补全控件、React 受控输入、掩码字段会静默吞字符，CLI 无法替你检测。
6. **页面跳转后必须重新 `state`。** 导航、表单提交、SPA 路由切换都会使 ref 失效。取新快照，不要用跳转前的旧 ref。
7. **用 `&&` 链式调用。** 链式序列在同一 shell 中运行，第一个命令获取的 ref 对第二个命令仍然有效。分开的 shell 调用丢失 session 上下文。
8. **`eval` 是只读的。** 用 IIFE 包裹 JS 并返回 JSON。如果要修改页面，用结构化的 `click` / `type` / `select` / `keys` 命令——它们产生结构化输出和指纹，`eval` 不产生。
9. **优先用 `network` 而非 DOM 抓取。** 如果你关心的页面数据来自 JSON API，API 几乎总是比渲染后的 DOM 更可靠。先抓一次看形状，再用 `--detail <key>` 取你需要的 body。

---

## 目标约定（`<target>` 用于 click / type / select / get）

```
<target> ::= <numeric-ref> | <css-selector>
```

- **数字 ref** — `state` 或 `find` 返回的 `[N]` 索引。廉价，抗 DOM 偏移。
- **CSS 选择器** — `querySelectorAll` 接受的任何选择器。写操作必须无歧义，否则配 `--nth <n>`。

### 成功信封

```json
{ "clicked": true, "target": "3", "matches_n": 1, "match_level": "exact" }
{ "value": "kalevin@example.com", "matches_n": 1, "match_level": "stable" }
```

### match_level 含义

| 级别 | 含义 | 你应该 |
|------|------|--------|
| `exact` | 标签 + 强 ID 完全匹配，最多轻微软属性偏移 | 继续 |
| `stable` | 标签 + 强 ID 仍一致，软信号（aria-label, role, text）偏移 | 继续，但如果操作内容关键，用 `get value` 或 `state` 复查 |
| `reidentified` | 原 ref 已消失；唯一存活元素匹配指纹并重新打上旧 ref | 继续前确认是否点对了元素 |

### 结构化错误码

| code | 含义 |
|------|------|
| `not_found` | 数字 ref 不在 DOM 中。重新 `state`。 |
| `stale_ref` | ref 存在但元素身份变了。重新 `state`。 |
| `invalid_selector` | CSS 被 `querySelectorAll` 拒绝。修正选择器。 |
| `selector_not_found` | CSS 匹配 0 个元素。用更宽松的选择器重试 `find`。 |
| `selector_ambiguous` | CSS 匹配 >1 且无 `--nth`。加 `--nth` 或收紧选择器。 |
| `selector_nth_out_of_range` | `--nth` 超出匹配数。 |
| `option_not_found` | `select` 找不到匹配选项。错误信封含 `available: string[]`（真实选项标签列表）。 |
| `not_a_select` | `select` 在非 `<select>` 元素上调用。 |

错误信封始终包含 `error.code` 和 `error.message`。目标类错误常附加 `error.candidates: string[]`（建议选择器）。`option_not_found` 附加 `error.available: string[]`。

---

## 命令参考

### 检查

| 命令 | 用途 |
|------|------|
| `browser state` | 文本树快照，含 `[N]` ref、滚动提示、隐藏交互提示、`compounds (N):` 侧栏 |
| `browser find --css <sel> [--limit N] [--text-max N]` | CSS 查询，每条匹配返回 `{nth, ref, tag, role, text, attrs, visible, compound?}`。为之前快照未标记的元素分配 ref。当你已知选择器时比 `state` 更轻量 |
| `browser frames` | 列出跨域 iframe 目标，传索引给 `eval --frame` |
| `browser screenshot [path]` | 视口 PNG。无路径 → base64 到 stdout。只需结构信息时优先用 `state` |
| `browser images [--limit N] [--json]` | **[自定义]** 提取页面所有图片 URL 和 alt text，返回 `{index, src, alt}[]` |

### 读取

| 命令 | 返回值 |
|------|--------|
| `browser get title` | 纯文本 |
| `browser get url` | 纯文本 |
| `browser get text <target> [--nth N]` | `{value, matches_n, match_level}` |
| `browser get value <target> [--nth N]` | `{value, matches_n, match_level}` |
| `browser get attributes <target> [--nth N]` | `{value: {attr: val, ...}, matches_n, match_level}` |
| `browser get html [--selector <css>] [--as html\|json] [--depth N] [--children-max N] [--text-max N] [--max N]` | 原始 HTML 或结构化树。JSON 树节点含 `{tag, attrs, text, children[], compound?}`。截断通过 `truncated: {...}` 报告 |

### 交互

| 命令 | 说明 |
|------|------|
| `browser click <target> [--nth N]` | 返回 `{clicked, target, matches_n, match_level}` |
| `browser type <target> <text> [--nth N]` | 先点击再输入。返回 `{typed, text, target, matches_n, match_level, autocomplete}`。`autocomplete: true` 表示出现了补全弹窗——几乎总是需要 `keys Enter` 或点击建议来确认值 |
| `browser select <target> <option> [--nth N]` | 先按 label 匹配，再按 value 匹配。用 `find`/`state` 的 compound 查看可用标签 |
| `browser keys <key>` | `Enter`, `Escape`, `Tab`, `Control+a` 等。作用于当前焦点元素 |
| `browser scroll <direction> [--amount px]` | `up` / `down`，默认 500px |

### 等待

```bash
browser wait selector "<css>" [--timeout ms]    # 等待选择器匹配
browser wait text "<substring>" [--timeout ms]  # 等待文本出现
browser wait time <seconds>                     # 硬等待，最后手段
```

默认超时 10000ms。SPA 路由、登录重定向、懒加载列表需要在 `state`/`get` 前 `wait`。

### 提取

- **`browser eval <js> [--frame N]`** — 在页面（或跨域 iframe）中执行 JS。用 IIFE 包裹并返回 JSON。**只读**：不能 `document.forms[0].submit()`、不能点击、不能导航。结果为字符串时 stdout 直接输出字符串，否则输出 JSON。
- **`browser extract [--selector <css>] [--chunk-size N] [--start N]`** — Markdown 格式提取长文内容，带续游标。返回 `{url, title, selector, total_chars, chunk_size, start, end, next_start_char, content}`。循环直到 `next_start_char` 为 null。未指定 `--selector` 时自动限定到 `<main>`/`<article>`/`<body>`。

### 网络

```bash
browser network                        # 形状预览 + 缓存 key 列表
browser network --detail <key>         # 单条缓存 entry 的完整 body
browser network --filter "field1,field2" # 只保留 body shape 包含所有指定字段（路径段语义，AND 关系）的条目
browser network --all                  # 包含静态资源（通常噪音大）
browser network --raw                  # 全部 body 内联——很大，慎用
browser network --ttl <ms>             # 缓存 TTL（默认 24h）
```

列表项格式：`{key, method, status, url, ct, size, shape, body_truncated?}`。详情信封：`{key, url, method, status, ct, size, shape, body, body_truncated?, body_full_size?, body_truncation_reason}`。缓存位于 `~/.opencli/cache/browser-network/`，可重复检查而不触发请求。

### 标签页 & Session

| 命令 | 用途 |
|------|------|
| `browser tab list` | JSON 数组 `{index, page, url, title, active}`。`page` 字符串是标签页身份标识 |
| `browser tab new [url]` | 打开新标签页，打印新的 `page` 字符串 |
| `browser tab select [targetId]` | 设为默认标签页。所有子命令支持 `--tab <targetId>` 指定目标而不改变默认 |
| `browser tab close [targetId]` | 按 `page` 关闭 |
| `browser back` | 当前标签页后退 |
| `browser close` | 关闭自动化窗口 |

---

## 复合表单控件

每个日期/时间/选择/文件输入都携带 `compound` 字段。用它，不要正则属性。

### 日期类

```json
{
  "control": "date",
  "format": "YYYY-MM-DD",
  "current": "2026-04-22",
  "min": "2026-01-01",
  "max": "2026-12-31"
}
```

`control` 可选值：`date | time | datetime-local | month | week`。`format` 是具体模板字符串——按此格式输入，或如果站点包裹了自定义控件则用 `select` 按 label 选择。

### 下拉选择

```json
{
  "control": "select",
  "multiple": false,
  "current": "United States",
  "options": [
    { "label": "United States", "value": "us", "selected": true },
    { "label": "Canada", "value": "ca" }
  ],
  "options_total": 137
}
```

`options[]` 截断在 50 条。**`current` 始终正确**——即使选中项超出截断范围（通过扫描全部选项计算）。当 `options_total > options.length` 且你需要不在列表中的选项时，直接 `browser select <target> "<label>"`——CLI 匹配的是真实 DOM 而非截断列表。

### 文件上传

```json
{
  "control": "file",
  "multiple": true,
  "current": ["report.pdf", "cover.png"],
  "accept": "application/pdf,image/*"
}
```

不要编造文件路径。上传走正常 click 流程，按 `accept` 告诉用户接受什么类型。

### compound 出现位置

- `browser find --css <sel>` 结果：内联在每条匹配上
- `browser get html --as json` 树节点：内联在匹配节点上
- `browser state` 快照：侧栏 `compounds (N):` 按 ref 索引，一眼看出哪些 `[N]` 有丰富元数据

---

## 开销指南

考虑每次调用的 payload 大小。context 预算有限。

| 命令 | 开销 | 使用时机 |
|------|------|---------|
| `state` | 中等（有内部预算上限） | 每次页面跳转后第一件事，需要 ref 时 |
| `find --css <sel>` | 小 | 已知选择器——一次查询，紧凑结果 |
| `get title` / `get url` | 极小 | 步骤间的完整性检查 |
| `get text/value/attributes` | 极小/次 | 验证单个字段 |
| `get html`（原始） | 可能极大 | 无界页面避免使用。始终配 `--selector` + 预算限制 |
| `get html --as json --depth 3 --children-max 20` | 中等 | 需要理解结构而非特定字段时 |
| `screenshot` | 大 | 仅页面真正可视化时（验证码、图表）。优先用 `state` |
| `images` | 中等 | 需要图片 URL/alt text 时。用 `--limit` 控制量 |
| `extract` | 中等/块 | 长文阅读。循环保留 `next_start_char` |
| `network`（默认） | 小 | 先看 API |
| `network --detail <key>` | 不定 | 取单条 body |
| `network --raw` | 极大 | 仅在 `--filter` 缩小候选集后使用 |
| `eval "JSON.stringify(...)"` | 可控 | 以上都不适用时的定向提取 |

经验法则：**每次页面跳转一次 `state`，后续查询一次 `find`，每次操作一次 `get`/`click`/`type`**。如果一个页面计划超过 10 次调用，你可能是在做抓取而非交互——考虑 `extract` 或 `network`。

---

## 链式调用规则

**好——同一 shell，live session：**

```bash
opencli browser open "https://news.ycombinator.com" \
  && opencli browser state \
  && opencli browser click 3
```

**差——每行独立 shell，call 1 的 ref 在 call 2 执行时已遗忘。**（只在依赖 shell 作用域状态时有问题；浏览器 ref 本身跨 shell 持久存在，但交错无关 shell 会引发竞态。）原子操作步骤用 `&&`。

**绝对不要**在写操作后立即 `state` 而中间不加 `wait`——如果操作触发网络往返，你会拍到响应前的 DOM 快照并基于过时数据做决策。

---

## 示例

### 填写登录表单

```bash
opencli browser open "https://example.com/login"
opencli browser state                          # 找 email/password/submit 的 [N]
opencli browser type 4 "me@example.com"
opencli browser type 5 "hunter2"
opencli browser get value 4                    # 验证（自动补全可能吞字符）
opencli browser click 6                        # 提交
opencli browser wait selector "[data-testid=account-menu]" --timeout 15000
opencli browser state                          # 登录后刷新 ref
```

### 从长下拉菜单选择

```bash
opencli browser state                          # 侧栏显示 [12] <select name=country>
opencli browser find --css "select[name=country]"
# compound.options_total = 137，compound.current = "" ——未选择
opencli browser select 12 "Uruguay"
opencli browser get value 12                   # { value: "uy", match_level: "exact" }
```

### 用网络抓包代替 DOM 抓取

```bash
opencli browser open "https://news.ycombinator.com"
opencli browser network --filter "title,score"
# -> 找到 /topstories 条目，记下 key
opencli browser network --detail topstories-a1b2
```

### 分块阅读长文章

```bash
opencli browser open "https://blog.example.com/long-post"
opencli browser extract --chunk-size 8000
# -> content + next_start_char: 8000
opencli browser extract --start 8000 --chunk-size 8000
# ...直到 next_start_char 为 null
```

### 提取页面图片（自定义命令）

```bash
opencli browser open "https://example.com/gallery"
opencli browser images --limit 20 --json
# -> [{index: 1, src: "https://...", alt: "..."}, ...]
```

### 跨域 iframe 操作

```bash
opencli browser frames
# -> [{"index": 0, "url": "https://checkout.stripe.com/...", ...}]
opencli browser eval "(() => document.querySelector('input[name=cardnumber]')?.value)()" --frame 0
```

---

## 常见陷阱

- **不要用 `eval "document.forms[0].submit()"` 提交表单**——现代站点用 JS handler 拦截并静默丢弃。直接 `click` 提交按钮的 ref，或（如果你知道 GET URL）直接 `open`。
- **不要跨页面跳转复用 ref。** `wait` 新状态后再 `state`。旧 ref 要么 404 要么（更糟）`reidentify` 到新页面的相似元素上。
- **`match_level: reidentified` 是警告不是错误。** 操作已执行，但如果你后面还要链 5 次写入且都依赖它是对的，先用 `get text` 或 `get value` 确认。
- **有预算的命令静默截断。** `get html --as json` 默认预算会返回 `truncated: {...}`。如果下游逻辑需要完整子树，提高 `--depth` / `--children-max` 或收紧选择器。
- **`type` 返回 `autocomplete: true` 不是错误。** 表示补全弹窗打开了，值尚未提交。通常 `keys Enter` 接受第一个建议，或 `click` 你要的那个。
- **`network --filter` 是路径段的 AND 语义。** `--filter "title,score"` 保留 body shape 同时包含 `title` 和 `score`（任意深度）的条目。不是正则。
- **截图是给人看的，不是给 agent 的。** 用 `state` + `find`，除非页面真的需要视觉判断（验证码、图表）。截图烧 token 且很少增加 agent 可操作的信号。
- **Hang 问题已修复。** 如果遇到命令完成但不退出，确认安装的是本 fork 版本（含 commit `92a5912` 的 `ws.terminate` 修复）。

---

## 排查（CDP 模式专用）

| 症状 | 原因与修复 |
|------|-----------|
| CDP 连接超时 / 拒绝 | 外部浏览器未运行或端口错误：`curl -s http://127.0.0.1:9222/json/version` |
| `selector_not_found` 就在 `state` 之后 | 页面突变。`wait selector "..."` 后重试 |
| 每个命令都是 `stale_ref` | 你在复用旧页面的 ref。重新 `state`。 |
| `click` 成功但无反应 | 元素可能是装饰性包装层偷走了点击。用更窄选择器 `find --css` 重试内部元素 |
| `type` 完成但值不对 | 自动补全、掩码输入或 React 受控重渲染。`get value` 验证后加 `keys Enter` 或重新输入 |
| `get html` 输出巨大 | 加 `--selector` + `--as json --depth 3 --children-max 20 --text-max 200` |
| 网络缓存似乎过期 | 降低 `--ttl` 或等它过期。缓存位置 `~/.opencli/cache/browser-network/` |
| 命令 hang 不退出 | 确认 fork 已安装且含 hang 修复：`grep terminate $(npm root -g)/@jackwener/opencli/dist/src/browser/cdp.js` |

---

## 相关 skill

- `opencli-adapter-author` — 把你刚摸索出的流程变成可复用的 `~/.opencli/clis/<site>/<command>.js`
- `opencli-autofix` — 已有适配器损坏时，用 `OPENCLI_DIAGNOSTIC` 诊断并修补
