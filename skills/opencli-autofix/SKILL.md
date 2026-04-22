---

name: opencli-autofix
description: OpenCLI 适配器自动修复——当命令失败时自动诊断、修补适配器、重试。加载条件：opencli 命令执行失败且错误可修复。CDP 直连模式。
allowed-tools: Bash(opencli:*), Bash(gh:*), Read, Edit, Write
---

# OpenCLI AutoFix（CDP 模式）

当 `opencli` 命令因网站改版（DOM 变化、API 变更、响应 schema 偏移）而失败时，**自动诊断→修复适配器→重试**——不要只报错。

## 安全边界

**开始修复前，先检查硬停止条件：**

- **`AUTH_REQUIRED`**（exit code 77）——**停止。** 不改代码。告诉用户在 Chrome 中登录目标站点。
- **`BROWSER_CONNECT`**（exit code 69）——**停止。** 不改代码。检查 `OPENCLI_CDP_ENDPOINT` 是否设置正确，浏览器是否运行：`curl -s http://127.0.0.1:9222/json/version`
- **CAPTCHA / 频率限制** ——**停止。** 不是适配器问题。

**范围约束：**
- **只修改 `RepairContext.adapter.sourcePath` 指向的文件**——权威位置可能在 repo (`clis/`) 或本地 (`~/.opencli/clis/`)
- **绝不修改** `src/`, `extension/`, `tests/`, `package.json`, `tsconfig.json`

**重试预算：每次失败最多 3 轮修复。** 3 轮诊断→修复→重试仍未解决则停止并报告。

## 前置确认

```bash
# 确认 CDP 连通（不需要 doctor）
curl -s http://127.0.0.1:9222/json/version | head -3
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9222"
```

## 触发条件

以下错误类型适用此 skill：

| 错误码 | 含义 |
|--------|------|
| `SELECTOR` | DOM 元素找不到（网站改版） |
| `EMPTY_RESULT` | 无数据返回（API 响应变化） |
| `API_ERROR` / `NETWORK` | 端点移动或损坏 |
| `PAGE_CHANGED` | 页面结构不再匹配 |
| `COMMAND_EXEC` | 适配器逻辑运行时错误 |
| `TIMEOUT` | 页面加载不同，适配器等错了东西 |

## 修复前："空结果" ≠ "坏了"

`EMPTY_RESULT`——以及有时结构上有效的 `SELECTOR` 返回空——往往**不是适配器 bug**。平台在反爬策略下主动降级返回结果，"not found" 的响应不代表内容真的缺失。在进入修复流程前先排除：

- **用不同查询或入口重试。** 如果 `opencli xiaohongshu search "X"` 返回 0 但 `opencli xiaohongshu search "X 攻略"` 返回 20 条，适配器没问题——平台在塑形第一个查询的结果。
- **在正常 Chrome 标签页中目视检查。** 数据在用户自己浏览器中可见但适配器返回空，问题通常是认证状态、频率限制或软拦截——不是代码 bug。修复方式是检查 CDP 登录态，不是编辑源码。
- **注意 soft 404。** 小红书/微博/抖音等站点对已隐藏或删除内容返回 HTTP 200 + 空 payload 而非真正 404。快照看起来结构完全正常。过几秒重试一次常能区分"暂时隐藏"和"确实没了"。
- **"0 条搜索结果"是一个有效答案。** 如果适配器成功到达搜索端点、拿到 HTTP 200、平台返回 `results: []`，这是合法答案——向用户报告"无匹配结果"而不是去修补适配器。

**只有**空结果/选择器缺失**跨重试和替代入口均可复现**时才进入 Step 1。否则你是在修补一个工作正常的适配器来追逐噪声，补丁版的下一个正常路径反而会断。

## Step 1: 收集诊断上下文

```bash
OPENCLI_DIAGNOSTIC=1 opencli <site> <command> [args...] 2>diagnostic.json
```

输出 `RepairContext` JSON 到 stderr（标记在 `___OPENCLI_DIAGNOSTIC___` 之间）：

```json
{
  "error": {
    "code": "SELECTOR",
    "message": "Could not find element: .old-selector",
    "hint": "The page UI may have changed."
  },
  "adapter": {
    "site": "example",
    "command": "example/search",
    "sourcePath": "/path/to/clis/example/search.js",
    "source": "// 完整适配器源码"
  },
  "page": {
    "url": "https://example.com/search",
    "snapshot": "// DOM 快照含 [N] 索引",
    "networkRequests": [],
    "consoleErrors": []
  },
  "timestamp": "2026-04-22T00:00:00.000Z"
}
```

## Step 2: 分析失败原因

读诊断上下文和适配器源码，归类根因：

| 错误码 | 可能原因 | 修复策略 |
|--------|---------|---------|
| `SELECTOR` | DOM 重构，class/id 改名 | 探索当前 DOM → 找新选择器 |
| `EMPTY_RESULT` | API 响应 schema 变化或数据移位 | 检查网络 → 找新响应路径 |
| `API_ERROR` | 端点 URL 变化，需要新参数 | 通过网络拦截发现新 API |
| `AUTH_REQUIRED` | 登录流变化，cookie 过期 | **停止**——让用户登录，不改代码 |
| `TIMEOUT` | 页面加载不同，spinner/懒加载 | 更新/添加等待条件 |
| `PAGE_CHANGED` | 大改版 | 可能需要完整适配器重写 |

**关键问题：**
1. 适配器要做什么？（读 `source` 字段）
2. 失败时页面什么样？（读 `snapshot` 字段）
3. 发生了哪些网络请求？（读 `networkRequests`）
4. 适配器期望的和页面实际提供的之间差距在哪？

## Step 3: 用 CDP 浏览器探索当前网站

**不要用坏掉的适配器**——它只会再失败一次。

### DOM 变化（SELECTOR 错误）

```bash
# 打开页面并检查当前 DOM
opencli browser open https://example.com/target-page && opencli browser state

# 找与适配器意图匹配的元素
# 对比快照和适配器的期望
```

### API 变化（API_ERROR, EMPTY_RESULT）

```bash
# 打开页面并观察网络
opencli browser open https://example.com/target-page && opencli browser state

# 交互触发 API 调用
opencli browser click <N> && opencli browser network

# 缩小到你关心的请求
opencli browser network --filter author,text,likes

# 查看特定 API 响应（key 是默认 JSON 输出中的 key 字段）
opencli browser network --detail <key>
```

## Step 4: 修补适配器

读取 `RepairContext.adapter.sourcePath` 指向的源文件，做针对性修改。

### 常见修复

**选择器更新：**
```javascript
// 改前: page.evaluate('document.querySelector(".old-class")...')
// 改后:  page.evaluate('document.querySelector(".new-class")...')
```

**API 端点变更：**
```javascript
// 改前: const resp = await page.evaluate(`fetch('/api/v1/old-endpoint')...`)
// 改后:  const resp = await page.evaluate(`fetch('/api/v2/new-endpoint')...`)
```

**响应 schema 变化：**
```javascript
// 改前: const items = data.results
// 改后:  const items = data.data.items  // API 现在嵌套在 "data" 下
```

**等待条件更新：**
```javascript
// 改前: await page.wait({ selector: '.loading-spinner', hidden: true })
// 改后:  await page.wait({ selector: '[data-loaded="true"]' })
```

### 修补规则

1. **最小改动**——只修坏的，不重构
2. **保持相同输出结构**——`columns` 和返回格式必须兼容
3. **优先 API 胜过 DOM 抓取**——如果在探索中发现 JSON API，切换到它
4. **只用 `@jackwener/opencli/*` 引入**——不加第三方包导入
5. **修补后立即测试**
6. **不要放松 verify fixture 来掩盖失败。** `patterns` / `notEmpty` / `mustNotContain` / `mustBeTruthy` 规则失败意味着适配器输出确实有问题。收紧适配器让它产出正确值；不要放宽 fixture 来接受错误值。唯一合理的 fixture 编辑场景是**站点本身**变了形状（如 URL 格式迁移）——此时更新 fixture 并在 `~/.opencli/sites/<site>/notes.md` 中记录。

## Step 5: 验证修复

```bash
# 正常运行（不带 diagnostic 模式）
opencli <site> <command> [args...]
```

仍失败则回到 Step 1 收集新鲜诊断。你有 **3 轮修复预算**（诊断→修复→重试）。同一错误持续则换不同方法尝试。3 轮后停止报告。

## Step 6: 提交上游 Issue

如果重试**通过**，本地适配器和上游已有偏差。提交 GitHub issue 让修复回流到 `jackwener/OpenCLI`。

**不要为以下情况提 issue：**
- `AUTH_REQUIRED`, `BROWSER_CONNECT`, `ARGUMENT`, `CONFIG` ——环境/使用问题，不是适配器 bug
- CAPTCHA 或频率限制 ——上游无法修复
- 你实际没修好的失败（3 轮耗尽）

**只在验证通过的本地修复后提 issue。**

**流程：**

1. 从 RepairContext 准备 issue 内容：
   - **标题：** `[autofix] <site>/<command>: <error_code>`
   - **正文模板：**

```markdown
## Summary
OpenCLI autofix repaired this adapter locally, and the retry passed.

## Adapter
- Site: `<site>`
- Command: `<command>`
- OpenCLI version: `<opencli --version 输出>`

## Original failure
- Error code: `<error_code>`

~~~
<error_message>
~~~

## Local fix summary

~~~
<1-2 句话描述改了什么为什么改>
~~~

_Issue filed by OpenCLI autofix after a verified local repair._
```

2. **先给用户看草稿。** 展示标题和正文，用户确认后才操作。
3. 用户批准且 `gh auth status` 通过：

```bash
gh issue create --repo jackwener/OpenCLI \
  --title "[autofix] <site>/<command>: <error_code>" \
  --body "<上面的正文>"
```

`gh` 未安装或未认证则告知用户并跳过——不要因此报错。

## 停止条件

**硬停止（不修改代码）：**
- `AUTH_REQUIRED / BROWSER_CONNECT` ——环境问题，不是适配器 bug
- 站点要求 CAPTCHA ——无法自动化
- 被 IP 封禁/频率限制 ——不是适配器问题

**软停止（尝试后报告）：**
- 3 轮修复耗尽 ——报告尝试了什么和什么失败了
- 功能完全移除 ——数据不再存在
- 大改版 ——需要通过 `opencli-adapter-author` skill 完整重写

所有停止情况下明确向用户沟通状况，不要做无效修补。

## 示例修复过程

```
1. 用户运行: opencli zhihu hot
   → 失败: SELECTOR "Could not find element: .HotList-item"

2. AI 运行: OPENCLI_DIAGNOSTIC=1 opencli zhihu hot 2>diag.json
   → 获得 RepairContext，DOM 快照显示页面已加载

3. AI 读诊断: 快照显示页面用了 ".HotItem" 而非 ".HotList-item"

4. AI 探索: opencli browser open https://www.zhihu.com/hot && opencli browser state
   → 确认新 class 名 ".HotItem"，子元素 ".HotItem-content"

5. AI 修补: 编辑 RepairContext.adapter.sourcePath ——替换 ".HotList-item" 为 ".HotItem"

6. AI 验证: opencli zhihu hot
   → 成功: 返回热搜话题

7. AI 准备 upstream issue 草稿，展示给用户

8. 用户批准 → AI 运行: gh issue create --repo jackwener/OpenCLI --title "[autofix] zhihu/hot: SELECTOR" --body "..."
```
