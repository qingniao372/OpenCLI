const DAEMON_PORT = 19825;
const DAEMON_HOST = "localhost";
const DAEMON_WS_URL = `ws://${DAEMON_HOST}:${DAEMON_PORT}/ext`;
const WS_RECONNECT_BASE_DELAY = 2e3;
const WS_RECONNECT_MAX_DELAY = 6e4;

const attached = /* @__PURE__ */ new Set();
async function ensureAttached(tabId) {
  if (attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Another debugger is already attached")) {
      try {
        await chrome.debugger.detach({ tabId });
      } catch {
      }
      try {
        await chrome.debugger.attach({ tabId }, "1.3");
      } catch {
        throw new Error(`attach failed: ${msg}`);
      }
    } else {
      throw new Error(`attach failed: ${msg}`);
    }
  }
  attached.add(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
  } catch {
  }
}
async function evaluate(tabId, expression) {
  await ensureAttached(tabId);
  const result = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) {
    const errMsg = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Eval error";
    throw new Error(errMsg);
  }
  return result.result?.value;
}
const evaluateAsync = evaluate;
async function screenshot(tabId, options = {}) {
  await ensureAttached(tabId);
  const format = options.format ?? "png";
  if (options.fullPage) {
    const metrics = await chrome.debugger.sendCommand({ tabId }, "Page.getLayoutMetrics");
    const size = metrics.cssContentSize || metrics.contentSize;
    if (size) {
      await chrome.debugger.sendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
        mobile: false,
        width: Math.ceil(size.width),
        height: Math.ceil(size.height),
        deviceScaleFactor: 1
      });
    }
  }
  try {
    const params = { format };
    if (format === "jpeg" && options.quality !== void 0) {
      params.quality = Math.max(0, Math.min(100, options.quality));
    }
    const result = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", params);
    return result.data;
  } finally {
    if (options.fullPage) {
      await chrome.debugger.sendCommand({ tabId }, "Emulation.clearDeviceMetricsOverride").catch(() => {
      });
    }
  }
}
function detach(tabId) {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try {
    chrome.debugger.detach({ tabId });
  } catch {
  }
}
function registerListeners() {
  chrome.tabs.onRemoved.addListener((tabId) => {
    attached.delete(tabId);
  });
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId) attached.delete(source.tabId);
  });
}

let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);
function forwardLog(level, args) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const msg = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
    ws.send(JSON.stringify({ type: "log", level, msg, ts: Date.now() }));
  } catch {
  }
}
console.log = (...args) => {
  _origLog(...args);
  forwardLog("info", args);
};
console.warn = (...args) => {
  _origWarn(...args);
  forwardLog("warn", args);
};
console.error = (...args) => {
  _origError(...args);
  forwardLog("error", args);
};
function connect() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
  try {
    ws = new WebSocket(DAEMON_WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    console.log("[opencli] Connected to daemon");
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };
  ws.onmessage = async (event) => {
    try {
      const command = JSON.parse(event.data);
      const result = await handleCommand(command);
      ws?.send(JSON.stringify(result));
    } catch (err) {
      console.error("[opencli] Message handling error:", err);
    }
  };
  ws.onclose = () => {
    console.log("[opencli] Disconnected from daemon");
    ws = null;
    scheduleReconnect();
  };
  ws.onerror = () => {
    ws?.close();
  };
}
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts++;
  const delay = Math.min(WS_RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), WS_RECONNECT_MAX_DELAY);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}
const automationSessions = /* @__PURE__ */ new Map();
const WINDOW_IDLE_TIMEOUT = 3e4;
function getWorkspaceKey(workspace) {
  return workspace?.trim() || "default";
}
function resetWindowIdleTimer(workspace) {
  const session = automationSessions.get(workspace);
  if (!session) return;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleDeadlineAt = Date.now() + WINDOW_IDLE_TIMEOUT;
  session.idleTimer = setTimeout(async () => {
    const current = automationSessions.get(workspace);
    if (!current) return;
    try {
      await chrome.windows.remove(current.windowId);
      console.log(`[opencli] Automation window ${current.windowId} (${workspace}) closed (idle timeout)`);
    } catch {
    }
    automationSessions.delete(workspace);
  }, WINDOW_IDLE_TIMEOUT);
}
async function getAutomationWindow(workspace) {
  const existing = automationSessions.get(workspace);
  if (existing) {
    try {
      await chrome.windows.get(existing.windowId);
      return existing.windowId;
    } catch {
      automationSessions.delete(workspace);
    }
  }
  const win = await chrome.windows.create({
    url: "about:blank",
    focused: false,
    width: 1280,
    height: 900,
    type: "normal"
  });
  const session = {
    windowId: win.id,
    idleTimer: null,
    idleDeadlineAt: Date.now() + WINDOW_IDLE_TIMEOUT
  };
  automationSessions.set(workspace, session);
  console.log(`[opencli] Created automation window ${session.windowId} (${workspace})`);
  resetWindowIdleTimer(workspace);
  return session.windowId;
}
chrome.windows.onRemoved.addListener((windowId) => {
  for (const [workspace, session] of automationSessions.entries()) {
    if (session.windowId === windowId) {
      console.log(`[opencli] Automation window closed (${workspace})`);
      if (session.idleTimer) clearTimeout(session.idleTimer);
      automationSessions.delete(workspace);
    }
  }
});
let initialized = false;
function initialize() {
  if (initialized) return;
  initialized = true;
  chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
  registerListeners();
  connect();
  console.log("[opencli] OpenCLI extension initialized");
}
chrome.runtime.onInstalled.addListener(() => {
  initialize();
});
chrome.runtime.onStartup.addListener(() => {
  initialize();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive") connect();
});
async function handleCommand(cmd) {
  const workspace = getWorkspaceKey(cmd.workspace);
  resetWindowIdleTimer(workspace);
  try {
    switch (cmd.action) {
      case "exec":
        return await handleExec(cmd, workspace);
      case "navigate":
        return await handleNavigate(cmd, workspace);
      case "tabs":
        return await handleTabs(cmd, workspace);
      case "cookies":
        return await handleCookies(cmd);
      case "screenshot":
        return await handleScreenshot(cmd, workspace);
      case "close-window":
        return await handleCloseWindow(cmd, workspace);
      case "sessions":
        return await handleSessions(cmd);
      case "export-state":
        return await handleExportState(cmd, workspace);
      case "import-state":
        return await handleImportState(cmd, workspace);
      case "watch-state":
        return handleWatchState(cmd);
      case "unwatch-state":
        return handleUnwatchState(cmd);
      default:
        return { id: cmd.id, ok: false, error: `Unknown action: ${cmd.action}` };
    }
  } catch (err) {
    return {
      id: cmd.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
function isDebuggableUrl(url) {
  if (!url) return false;
  return !url.startsWith("chrome://") && !url.startsWith("chrome-extension://");
}
async function resolveTabId(tabId, workspace) {
  if (tabId !== void 0) return tabId;
  const windowId = await getAutomationWindow(workspace);
  const tabs = await chrome.tabs.query({ windowId });
  const debuggableTab = tabs.find((t) => t.id && isDebuggableUrl(t.url));
  if (debuggableTab?.id) return debuggableTab.id;
  const reuseTab = tabs.find((t) => t.id);
  if (reuseTab?.id) {
    await chrome.tabs.update(reuseTab.id, { url: "about:blank" });
    return reuseTab.id;
  }
  const newTab = await chrome.tabs.create({ windowId, url: "about:blank", active: true });
  if (!newTab.id) throw new Error("Failed to create tab in automation window");
  return newTab.id;
}
async function listAutomationTabs(workspace) {
  const session = automationSessions.get(workspace);
  if (!session) return [];
  try {
    return await chrome.tabs.query({ windowId: session.windowId });
  } catch {
    automationSessions.delete(workspace);
    return [];
  }
}
async function listAutomationWebTabs(workspace) {
  const tabs = await listAutomationTabs(workspace);
  return tabs.filter((tab) => isDebuggableUrl(tab.url));
}
async function handleExec(cmd, workspace) {
  if (!cmd.code) return { id: cmd.id, ok: false, error: "Missing code" };
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    const data = await evaluateAsync(tabId, cmd.code);
    return { id: cmd.id, ok: true, data };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function handleNavigate(cmd, workspace) {
  if (!cmd.url) return { id: cmd.id, ok: false, error: "Missing url" };
  const tabId = await resolveTabId(cmd.tabId, workspace);
  await chrome.tabs.update(tabId, { url: cmd.url });
  await new Promise((resolve) => {
    chrome.tabs.get(tabId).then((tab2) => {
      if (tab2.status === "complete") {
        resolve();
        return;
      }
      const listener = (id, info) => {
        if (id === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 15e3);
    });
  });
  const tab = await chrome.tabs.get(tabId);
  return { id: cmd.id, ok: true, data: { title: tab.title, url: tab.url, tabId } };
}
async function handleTabs(cmd, workspace) {
  switch (cmd.op) {
    case "list": {
      const tabs = await listAutomationWebTabs(workspace);
      const data = tabs.map((t, i) => ({
        index: i,
        tabId: t.id,
        url: t.url,
        title: t.title,
        active: t.active
      }));
      return { id: cmd.id, ok: true, data };
    }
    case "new": {
      const windowId = await getAutomationWindow(workspace);
      const tab = await chrome.tabs.create({ windowId, url: cmd.url ?? "about:blank", active: true });
      return { id: cmd.id, ok: true, data: { tabId: tab.id, url: tab.url } };
    }
    case "close": {
      if (cmd.index !== void 0) {
        const tabs = await listAutomationWebTabs(workspace);
        const target = tabs[cmd.index];
        if (!target?.id) return { id: cmd.id, ok: false, error: `Tab index ${cmd.index} not found` };
        await chrome.tabs.remove(target.id);
        detach(target.id);
        return { id: cmd.id, ok: true, data: { closed: target.id } };
      }
      const tabId = await resolveTabId(cmd.tabId, workspace);
      await chrome.tabs.remove(tabId);
      detach(tabId);
      return { id: cmd.id, ok: true, data: { closed: tabId } };
    }
    case "select": {
      if (cmd.index === void 0 && cmd.tabId === void 0)
        return { id: cmd.id, ok: false, error: "Missing index or tabId" };
      if (cmd.tabId !== void 0) {
        await chrome.tabs.update(cmd.tabId, { active: true });
        return { id: cmd.id, ok: true, data: { selected: cmd.tabId } };
      }
      const tabs = await listAutomationWebTabs(workspace);
      const target = tabs[cmd.index];
      if (!target?.id) return { id: cmd.id, ok: false, error: `Tab index ${cmd.index} not found` };
      await chrome.tabs.update(target.id, { active: true });
      return { id: cmd.id, ok: true, data: { selected: target.id } };
    }
    default:
      return { id: cmd.id, ok: false, error: `Unknown tabs op: ${cmd.op}` };
  }
}
async function handleCookies(cmd) {
  const details = {};
  if (cmd.domain) details.domain = cmd.domain;
  if (cmd.url) details.url = cmd.url;
  const cookies = await chrome.cookies.getAll(details);
  const data = cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    expirationDate: c.expirationDate
  }));
  return { id: cmd.id, ok: true, data };
}
async function handleScreenshot(cmd, workspace) {
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    const data = await screenshot(tabId, {
      format: cmd.format,
      quality: cmd.quality,
      fullPage: cmd.fullPage
    });
    return { id: cmd.id, ok: true, data };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function handleCloseWindow(cmd, workspace) {
  const session = automationSessions.get(workspace);
  if (session) {
    try {
      await chrome.windows.remove(session.windowId);
    } catch {
    }
    if (session.idleTimer) clearTimeout(session.idleTimer);
    automationSessions.delete(workspace);
  }
  return { id: cmd.id, ok: true, data: { closed: true } };
}
async function handleSessions(cmd) {
  const now = Date.now();
  const data = await Promise.all([...automationSessions.entries()].map(async ([workspace, session]) => ({
    workspace,
    windowId: session.windowId,
    tabCount: (await chrome.tabs.query({ windowId: session.windowId })).filter((tab) => isDebuggableUrl(tab.url)).length,
    idleMsRemaining: Math.max(0, session.idleDeadlineAt - now)
  })));
  return { id: cmd.id, ok: true, data };
}
const readStorageJs = (type) => `
  (() => {
    try {
      const s = window.${type};
      const result = {};
      for (let i = 0; i < s.length; i++) {
        const key = s.key(i);
        if (key !== null) result[key] = s.getItem(key);
      }
      return result;
    } catch (e) { return {}; }
  })()
`;
const READ_INDEXEDDB_JS = `
  (async () => {
    try {
      if (!window.indexedDB || !window.indexedDB.databases) return [];
      const dbs = await window.indexedDB.databases();
      const results = [];
      for (const dbInfo of dbs) {
        if (!dbInfo.name) continue;
        try {
          const db = await new Promise((resolve, reject) => {
            const req = window.indexedDB.open(dbInfo.name, dbInfo.version);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onupgradeneeded = () => { req.transaction.abort(); reject(new Error('upgrade')); };
          });
          const storeNames = Array.from(db.objectStoreNames);
          const objectStores = [];
          for (const storeName of storeNames) {
            try {
              const tx = db.transaction(storeName, 'readonly');
              const store = tx.objectStore(storeName);
              const records = await new Promise((resolve, reject) => {
                const allReq = store.getAll();
                const keysReq = store.getAllKeys();
                allReq.onsuccess = () => {
                  keysReq.onsuccess = () => {
                    const r = [];
                    for (let i = 0; i < allReq.result.length; i++) {
                      r.push({ key: keysReq.result[i], value: allReq.result[i] });
                    }
                    resolve(r);
                  };
                  keysReq.onerror = () => resolve([]);
                };
                allReq.onerror = () => reject(allReq.error);
              });
              objectStores.push({
                name: storeName,
                keyPath: store.keyPath,
                autoIncrement: store.autoIncrement,
                records
              });
            } catch { /* skip unreadable stores */ }
          }
          db.close();
          results.push({ name: dbInfo.name, version: dbInfo.version || 1, objectStores });
        } catch { /* skip unreadable databases */ }
      }
      return results;
    } catch { return []; }
  })()
`;
async function handleExportState(cmd, workspace) {
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || "";
    let domain = "";
    try {
      domain = new URL(url).hostname;
    } catch {
    }
    const cookieQuery = {};
    if (cmd.domain) cookieQuery.domain = cmd.domain;
    else if (url) cookieQuery.url = url;
    const rawCookies = await chrome.cookies.getAll(cookieQuery);
    const cookies = rawCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      expirationDate: c.expirationDate
    }));
    const localStorage = await evaluate(tabId, readStorageJs("localStorage")) ?? {};
    const sessionStorage = await evaluate(tabId, readStorageJs("sessionStorage")) ?? {};
    const indexedDB = await evaluate(tabId, READ_INDEXEDDB_JS) ?? [];
    return {
      id: cmd.id,
      ok: true,
      data: {
        version: 1,
        url,
        domain: cmd.domain || domain,
        timestamp: Date.now(),
        cookies,
        localStorage,
        sessionStorage,
        indexedDB
      }
    };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function handleImportState(cmd, workspace) {
  if (!cmd.state) return { id: cmd.id, ok: false, error: "Missing state data" };
  const { cookies, localStorage, sessionStorage, indexedDB, url } = cmd.state;
  const errors = [];
  if (url) {
    const tabId2 = await resolveTabId(cmd.tabId, workspace);
    await chrome.tabs.update(tabId2, { url });
    await new Promise((resolve) => {
      const listener = (id, info) => {
        if (id === tabId2 && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 15e3);
    });
  }
  if (cookies?.length) {
    for (const c of cookies) {
      try {
        await chrome.cookies.set({
          url: c.url || `http${c.secure ? "s" : ""}://${c.domain.replace(/^\\./, "")}${c.path || "/"}`,
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || "/",
          secure: c.secure,
          httpOnly: c.httpOnly,
          expirationDate: c.expirationDate
        });
      } catch (e) {
        errors.push(`Cookie ${c.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  const tabId = await resolveTabId(cmd.tabId, workspace);
  for (const [type, data] of [["localStorage", localStorage], ["sessionStorage", sessionStorage]]) {
    if (data && Object.keys(data).length > 0) {
      try {
        const entries = JSON.stringify(data);
        await evaluate(tabId, `(() => { const e = ${entries}; for (const [k,v] of Object.entries(e)) window.${type}.setItem(k,v); return Object.keys(e).length; })()`);
      } catch (e) {
        errors.push(`${type}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (indexedDB?.length) {
    const idbData = JSON.stringify(indexedDB);
    try {
      await evaluate(tabId, `
        (async () => {
          const dbs = ${idbData};
          for (const dbInfo of dbs) {
            const db = await new Promise((resolve, reject) => {
              const req = window.indexedDB.open(dbInfo.name, dbInfo.version);
              req.onupgradeneeded = () => {
                const d = req.result;
                for (const s of dbInfo.objectStores) {
                  if (!d.objectStoreNames.contains(s.name)) {
                    d.createObjectStore(s.name, { keyPath: s.keyPath || undefined, autoIncrement: s.autoIncrement });
                  }
                }
              };
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            for (const s of dbInfo.objectStores) {
              if (!db.objectStoreNames.contains(s.name)) continue;
              const tx = db.transaction(s.name, 'readwrite');
              const os = tx.objectStore(s.name);
              for (const r of s.records) os.put(r.value, s.keyPath ? undefined : r.key);
              await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
            }
            db.close();
          }
          return { ok: true };
        })()
      `);
    } catch (e) {
      errors.push(`IndexedDB: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { id: cmd.id, ok: true, data: { imported: true, ...errors.length ? { errors } : {} } };
}
let watchedDomains = null;
function handleWatchState(cmd) {
  if (cmd.domains?.length) {
    watchedDomains = new Set(cmd.domains);
  } else {
    watchedDomains = /* @__PURE__ */ new Set();
  }
  console.log(`[opencli] Watching state changes for: ${watchedDomains.size > 0 ? [...watchedDomains].join(", ") : "all domains"}`);
  return { id: cmd.id, ok: true, data: { watching: true, domains: cmd.domains ?? [] } };
}
function handleUnwatchState(cmd) {
  watchedDomains = null;
  console.log("[opencli] Stopped watching state changes");
  return { id: cmd.id, ok: true, data: { watching: false } };
}
function isDomainWatched(domain) {
  if (watchedDomains === null) return false;
  if (watchedDomains.size === 0) return true;
  const clean = domain.replace(/^\./, "");
  for (const watched of watchedDomains) {
    if (clean === watched || clean.endsWith("." + watched)) return true;
  }
  return false;
}
function sendSyncEvent(event) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(event));
  } catch {
  }
}
chrome.cookies.onChanged.addListener((changeInfo) => {
  const { cookie, removed, cause } = changeInfo;
  if (!isDomainWatched(cookie.domain)) return;
  const event = {
    type: "state-change",
    changeType: "cookie",
    domain: cookie.domain.replace(/^\./, ""),
    cookie: {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expirationDate,
      removed,
      cause
    },
    timestamp: Date.now()
  };
  sendSyncEvent(event);
});
