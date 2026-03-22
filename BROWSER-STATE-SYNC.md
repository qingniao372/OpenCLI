# Browser State Sync: Chrome → Camoufox

## 目标

`opencli` 无缝对接 camoufox 无头浏览器：登录态从 Chrome 实时导出，注入 camoufox 后直接自动化。

## 架构

```
Chrome Extension ──WebSocket──→  opencli daemon  ←──HTTP──→  CLI
                                                              │
                                    playwright-core ──Juggler WS──→  Camoufox
```

- **Chrome 侧**: 现有 Extension + daemon 架构不变，新增 `export-state` / `import-state` action
- **Camoufox 侧**: `playwright-core`（Node.js 轻量 client ~3MB）通过 Juggler WS 直连，**不需要 Extension**
- **CLI**: `CamoufoxBridge` 实现 `IBrowserFactory`，所有现有 adapter 自动兼容 camoufox

## 浏览器状态覆盖

| 类型 | 导出（Chrome Extension） | 导入（Camoufox Playwright） |
|------|---|---|
| Cookie | `chrome.cookies.getAll()` | `context.addCookies()` |
| localStorage | CDP `Runtime.evaluate` 遍历 | `page.evaluate(setItem)` |
| sessionStorage | CDP `Runtime.evaluate` 遍历 | `page.evaluate(setItem)` |
| IndexedDB | CDP `Runtime.evaluate` 全量读取 | `page.evaluate(indexedDB.put)` |

> 覆盖 99%+ 登录态场景。Playwright `page.evaluate()` 走 Juggler 协议，**完全绕过 CSP**。

---

## 文件变更清单

### Phase 1: Chrome Extension — export-state / import-state

| 文件 | 变更 |
|------|------|
| `extension/src/protocol.ts` | `export-state`/`import-state` actions + IndexedDB 类型 |
| `extension/manifest.json` | `storage` permission + `host_permissions: ["<all_urls>"]` |
| `extension/src/background.ts` | +200 行: `handleExportState` / `handleImportState` |

### Phase 2: CLI Types & IPage

| 文件 | 变更 |
|------|------|
| `src/types.ts` | `BrowserState`, `IndexedDBSnapshot` 接口 + `IPage.exportState/importState` |
| `src/browser/daemon-client.ts` | 新 action 类型 + `state` 字段 |
| `src/browser/page.ts` | `exportState()` / `importState()` 通过 daemon 调用 |
| `src/browser/cdp.ts` | Stub methods (CDP 模式不支持) |

### Phase 3: CamoufoxBridge (playwright-core)

| 文件 | 变更 |
|------|------|
| `src/browser/camoufox-page.ts` | **[NEW]** 376 行 — 完整 `IPage` via Playwright Juggler |
| `src/browser/camoufox-bridge.ts` | **[NEW]** 43 行 — `IBrowserFactory` |
| `src/runtime.ts` | `OPENCLI_CAMOUFOX_WS` 环境变量自动切换后端 |
| `src/browser/index.ts` | 导出 `CamoufoxBridge` / `CamoufoxPage` |

### Phase 4: CLI Commands

| 文件 | 变更 |
|------|------|
| `src/cli.ts` | +212 行: `browser` + `camoufox` 命令组 |

### Phase 5: Dependencies

| 文件 | 变更 |
|------|------|
| `package.json` | `playwright-core` (~3MB, 不含浏览器二进制) |

---

## CLI 命令

### Browser 状态管理

```bash
# 一次性快照导出/导入
opencli browser export-state --domain github.com -o github-state.json
opencli browser import-state github-state.json

# 一键同步 Chrome → Camoufox
opencli browser sync --domain github.com

# 🔥 实时同步（长驻进程，Chrome cookie 变化自动推送到 camoufox）
opencli browser watch --domain github.com,twitter.com
```

### Camoufox 生命周期

```bash
opencli camoufox setup                     # 安装 camoufox
opencli camoufox start [--no-headless]     # 启动 server
opencli camoufox start --import state.json # 启动并导入状态
opencli camoufox status                    # 查看状态
```

---

## 🔥 实时同步架构

解决"登录态过期"的核心方案——**Chrome cookie 变化实时推送到 camoufox**：

```
chrome.cookies.onChanged ──→ Extension ──WS──→ Daemon ──/sync WS──→ LiveSyncService
                                                                        ↓
                                                          context.addCookies() / evaluate()
                                                                        ↓
                                                                    Camoufox
```

| 层 | 文件 | 职责 |
|----|------|------|
| Extension | `background.ts` | 监听 `chrome.cookies.onChanged`，按 domain 过滤，推送 `SyncEvent` |
| Daemon | `daemon.ts` | `/sync` WS path 接收订阅者，fan-out `state-change` 事件 |
| CLI | `live-sync.ts` | 订阅 daemon，实时 `context.addCookies()` 到 camoufox |

**特性**:
- domain 过滤：只同步你关心的站点
- 自动重连：daemon 或 camoufox 断线后自动恢复
- Cookie 新增/修改/删除 全覆盖
- 统计信息：`Ctrl+C` 退出时显示同步计数

---

## 端到端使用流

```bash
# 1. 安装 camoufox（一次性）
opencli camoufox setup

# 2. 启动 camoufox 无头服务
opencli camoufox start

# 3. 一次性同步当前登录态
opencli browser sync --domain github.com

# 4. 启动实时同步（保持运行）
opencli browser watch --domain github.com &

# 5. 在 camoufox 上运行任何 adapter！
OPENCLI_CAMOUFOX_WS=ws://... opencli run github/notifications
```

---

## 导出格式 BrowserState

```json
{
  "version": 1,
  "url": "https://github.com/jackwener",
  "domain": "github.com",
  "timestamp": 1711094210000,
  "cookies": [
    { "name": "user_session", "value": "abc...", "domain": ".github.com",
      "path": "/", "secure": true, "httpOnly": true, "expirationDate": 1742630210 }
  ],
  "localStorage": { "colorMode": "{\"mode\":\"dark\"}" },
  "sessionStorage": {},
  "indexedDB": [
    {
      "name": "firebaseLocalStorageDb",
      "version": 1,
      "objectStores": [
        { "name": "firebaseLocalStorage", "keyPath": "fbase_key",
          "autoIncrement": false,
          "records": [{ "key": "...", "value": { "token": "..." } }] }
      ]
    }
  ]
}
```

---

## 关键设计决策

1. **Juggler 而非 Firefox Extension**: Camoufox 原生支持 Playwright Server，通过 Juggler WS 连接
2. **playwright-core 而非 playwright**: 只装协议 client（~3MB），不含浏览器二进制
3. **IPage 统一接口**: CamoufoxPage 和 Page 都实现 IPage，所有 adapter 零修改
4. **实时同步 > 快照**: `chrome.cookies.onChanged` 流式推送，Cookie 永不过期
5. **CSP 绕过**: Playwright evaluate 走 Juggler 协议，等同 CDP
6. **Python launcher**: `launch_server()` JSON 输出 WS endpoint，不猜测端口/path
