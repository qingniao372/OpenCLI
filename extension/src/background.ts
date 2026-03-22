/**
 * OpenCLI — Service Worker (background script).
 *
 * Connects to the opencli daemon via WebSocket, receives commands,
 * dispatches them to Chrome APIs (debugger/tabs/cookies), returns results.
 */

import type { Command, Result, SyncEvent } from './protocol';
import { DAEMON_WS_URL, WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY } from './protocol';
import * as executor from './cdp';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

// ─── Console log forwarding ──────────────────────────────────────────
// Hook console.log/warn/error to forward logs to daemon via WebSocket.

const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);

function forwardLog(level: 'info' | 'warn' | 'error', args: unknown[]): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    ws.send(JSON.stringify({ type: 'log', level, msg, ts: Date.now() }));
  } catch { /* don't recurse */ }
}

console.log = (...args: unknown[]) => { _origLog(...args); forwardLog('info', args); };
console.warn = (...args: unknown[]) => { _origWarn(...args); forwardLog('warn', args); };
console.error = (...args: unknown[]) => { _origError(...args); forwardLog('error', args); };

// ─── WebSocket connection ────────────────────────────────────────────

function connect(): void {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  try {
    ws = new WebSocket(DAEMON_WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[opencli] Connected to daemon');
    reconnectAttempts = 0; // Reset on successful connection
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = async (event) => {
    try {
      const command = JSON.parse(event.data as string) as Command;
      const result = await handleCommand(command);
      ws?.send(JSON.stringify(result));
    } catch (err) {
      console.error('[opencli] Message handling error:', err);
    }
  };

  ws.onclose = () => {
    console.log('[opencli] Disconnected from daemon');
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectAttempts++;
  // Exponential backoff: 2s, 4s, 8s, 16s, ..., capped at 60s
  const delay = Math.min(WS_RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), WS_RECONNECT_MAX_DELAY);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

// ─── Automation window isolation ─────────────────────────────────────
// All opencli operations happen in a dedicated Chrome window so the
// user's active browsing session is never touched.
// The window auto-closes after 30s of idle (no commands).

type AutomationSession = {
  windowId: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  idleDeadlineAt: number;
};

const automationSessions = new Map<string, AutomationSession>();
const WINDOW_IDLE_TIMEOUT = 30000; // 30s

function getWorkspaceKey(workspace?: string): string {
  return workspace?.trim() || 'default';
}

function resetWindowIdleTimer(workspace: string): void {
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
      // Already gone
    }
    automationSessions.delete(workspace);
  }, WINDOW_IDLE_TIMEOUT);
}

/** Get or create the dedicated automation window. */
async function getAutomationWindow(workspace: string): Promise<number> {
  // Check if our window is still alive
  const existing = automationSessions.get(workspace);
  if (existing) {
    try {
      await chrome.windows.get(existing.windowId);
      return existing.windowId;
    } catch {
      // Window was closed by user
      automationSessions.delete(workspace);
    }
  }

  // Create a new window with about:blank (not chrome://newtab which blocks scripting)
  const win = await chrome.windows.create({
    url: 'about:blank',
    focused: false,
    width: 1280,
    height: 900,
    type: 'normal',
  });
  const session: AutomationSession = {
    windowId: win.id!,
    idleTimer: null,
    idleDeadlineAt: Date.now() + WINDOW_IDLE_TIMEOUT,
  };
  automationSessions.set(workspace, session);
  console.log(`[opencli] Created automation window ${session.windowId} (${workspace})`);
  resetWindowIdleTimer(workspace);
  return session.windowId;
}

// Clean up when the automation window is closed
chrome.windows.onRemoved.addListener((windowId) => {
  for (const [workspace, session] of automationSessions.entries()) {
    if (session.windowId === windowId) {
      console.log(`[opencli] Automation window closed (${workspace})`);
      if (session.idleTimer) clearTimeout(session.idleTimer);
      automationSessions.delete(workspace);
    }
  }
});

// ─── Lifecycle events ────────────────────────────────────────────────

let initialized = false;

function initialize(): void {
  if (initialized) return;
  initialized = true;
  chrome.alarms.create('keepalive', { periodInMinutes: 0.4 }); // ~24 seconds
  executor.registerListeners();
  connect();
  console.log('[opencli] OpenCLI extension initialized');
}

chrome.runtime.onInstalled.addListener(() => {
  initialize();
});

chrome.runtime.onStartup.addListener(() => {
  initialize();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') connect();
});

// ─── Command dispatcher ─────────────────────────────────────────────

async function handleCommand(cmd: Command): Promise<Result> {
  const workspace = getWorkspaceKey(cmd.workspace);
  // Reset idle timer on every command (window stays alive while active)
  resetWindowIdleTimer(workspace);
  try {
    switch (cmd.action) {
      case 'exec':
        return await handleExec(cmd, workspace);
      case 'navigate':
        return await handleNavigate(cmd, workspace);
      case 'tabs':
        return await handleTabs(cmd, workspace);
      case 'cookies':
        return await handleCookies(cmd);
      case 'screenshot':
        return await handleScreenshot(cmd, workspace);
      case 'close-window':
        return await handleCloseWindow(cmd, workspace);
      case 'sessions':
        return await handleSessions(cmd);
      case 'export-state':
        return await handleExportState(cmd, workspace);
      case 'import-state':
        return await handleImportState(cmd, workspace);
      case 'watch-state':
        return handleWatchState(cmd);
      case 'unwatch-state':
        return handleUnwatchState(cmd);
      default:
        return { id: cmd.id, ok: false, error: `Unknown action: ${cmd.action}` };
    }
  } catch (err) {
    return {
      id: cmd.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Action handlers ─────────────────────────────────────────────────

/** Check if a URL can be attached via CDP (not chrome:// or chrome-extension://) */
function isDebuggableUrl(url?: string): boolean {
  if (!url) return false;
  return !url.startsWith('chrome://') && !url.startsWith('chrome-extension://');
}

/**
 * Resolve target tab in the automation window.
 * If explicit tabId is given, use that directly.
 * Otherwise, find or create a tab in the dedicated automation window.
 */
async function resolveTabId(tabId: number | undefined, workspace: string): Promise<number> {
  if (tabId !== undefined) return tabId;

  // Get (or create) the automation window
  const windowId = await getAutomationWindow(workspace);

  // Prefer an existing debuggable tab (about:blank, http://, https://, etc.)
  const tabs = await chrome.tabs.query({ windowId });
  const debuggableTab = tabs.find(t => t.id && isDebuggableUrl(t.url));
  if (debuggableTab?.id) return debuggableTab.id;

  // No debuggable tab found — this typically happens when a "New Tab Override"
  // extension replaces about:blank with a chrome-extension:// page.
  // Reuse the first existing tab by navigating it to about:blank (avoids
  // accumulating orphan tabs if chrome.tabs.create is also intercepted).
  const reuseTab = tabs.find(t => t.id);
  if (reuseTab?.id) {
    await chrome.tabs.update(reuseTab.id, { url: 'about:blank' });
    return reuseTab.id;
  }

  // Window has no tabs at all — create one
  const newTab = await chrome.tabs.create({ windowId, url: 'about:blank', active: true });
  if (!newTab.id) throw new Error('Failed to create tab in automation window');
  return newTab.id;
}

async function listAutomationTabs(workspace: string): Promise<chrome.tabs.Tab[]> {
  const session = automationSessions.get(workspace);
  if (!session) return [];
  try {
    return await chrome.tabs.query({ windowId: session.windowId });
  } catch {
    automationSessions.delete(workspace);
    return [];
  }
}

async function listAutomationWebTabs(workspace: string): Promise<chrome.tabs.Tab[]> {
  const tabs = await listAutomationTabs(workspace);
  return tabs.filter((tab) => isDebuggableUrl(tab.url));
}

async function handleExec(cmd: Command, workspace: string): Promise<Result> {
  if (!cmd.code) return { id: cmd.id, ok: false, error: 'Missing code' };
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    const data = await executor.evaluateAsync(tabId, cmd.code);
    return { id: cmd.id, ok: true, data };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleNavigate(cmd: Command, workspace: string): Promise<Result> {
  if (!cmd.url) return { id: cmd.id, ok: false, error: 'Missing url' };
  const tabId = await resolveTabId(cmd.tabId, workspace);
  await chrome.tabs.update(tabId, { url: cmd.url });

  // Wait for page to finish loading, checking current status first to avoid race
  await new Promise<void>((resolve) => {
    // Check if already complete (e.g. cached pages)
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') { resolve(); return; }

      const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
        if (id === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      // Timeout fallback
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 15000);
    });
  });

  const tab = await chrome.tabs.get(tabId);
  return { id: cmd.id, ok: true, data: { title: tab.title, url: tab.url, tabId } };
}

async function handleTabs(cmd: Command, workspace: string): Promise<Result> {
  switch (cmd.op) {
    case 'list': {
      const tabs = await listAutomationWebTabs(workspace);
      const data = tabs
        .map((t, i) => ({
          index: i,
          tabId: t.id,
          url: t.url,
          title: t.title,
          active: t.active,
        }));
      return { id: cmd.id, ok: true, data };
    }
    case 'new': {
      const windowId = await getAutomationWindow(workspace);
      const tab = await chrome.tabs.create({ windowId, url: cmd.url ?? 'about:blank', active: true });
      return { id: cmd.id, ok: true, data: { tabId: tab.id, url: tab.url } };
    }
    case 'close': {
      if (cmd.index !== undefined) {
        const tabs = await listAutomationWebTabs(workspace);
        const target = tabs[cmd.index];
        if (!target?.id) return { id: cmd.id, ok: false, error: `Tab index ${cmd.index} not found` };
        await chrome.tabs.remove(target.id);
        executor.detach(target.id);
        return { id: cmd.id, ok: true, data: { closed: target.id } };
      }
      const tabId = await resolveTabId(cmd.tabId, workspace);
      await chrome.tabs.remove(tabId);
      executor.detach(tabId);
      return { id: cmd.id, ok: true, data: { closed: tabId } };
    }
    case 'select': {
      if (cmd.index === undefined && cmd.tabId === undefined)
        return { id: cmd.id, ok: false, error: 'Missing index or tabId' };
      if (cmd.tabId !== undefined) {
        await chrome.tabs.update(cmd.tabId, { active: true });
        return { id: cmd.id, ok: true, data: { selected: cmd.tabId } };
      }
      const tabs = await listAutomationWebTabs(workspace);
      const target = tabs[cmd.index!];
      if (!target?.id) return { id: cmd.id, ok: false, error: `Tab index ${cmd.index} not found` };
      await chrome.tabs.update(target.id, { active: true });
      return { id: cmd.id, ok: true, data: { selected: target.id } };
    }
    default:
      return { id: cmd.id, ok: false, error: `Unknown tabs op: ${cmd.op}` };
  }
}

async function handleCookies(cmd: Command): Promise<Result> {
  const details: chrome.cookies.GetAllDetails = {};
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
    expirationDate: c.expirationDate,
  }));
  return { id: cmd.id, ok: true, data };
}

async function handleScreenshot(cmd: Command, workspace: string): Promise<Result> {
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    const data = await executor.screenshot(tabId, {
      format: cmd.format,
      quality: cmd.quality,
      fullPage: cmd.fullPage,
    });
    return { id: cmd.id, ok: true, data };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleCloseWindow(cmd: Command, workspace: string): Promise<Result> {
  const session = automationSessions.get(workspace);
  if (session) {
    try {
      await chrome.windows.remove(session.windowId);
    } catch {
      // Window may already be closed
    }
    if (session.idleTimer) clearTimeout(session.idleTimer);
    automationSessions.delete(workspace);
  }
  return { id: cmd.id, ok: true, data: { closed: true } };
}

async function handleSessions(cmd: Command): Promise<Result> {
  const now = Date.now();
  const data = await Promise.all([...automationSessions.entries()].map(async ([workspace, session]) => ({
    workspace,
    windowId: session.windowId,
    tabCount: (await chrome.tabs.query({ windowId: session.windowId })).filter((tab) => isDebuggableUrl(tab.url)).length,
    idleMsRemaining: Math.max(0, session.idleDeadlineAt - now),
  })));
  return { id: cmd.id, ok: true, data };
}

// ─── State export/import handlers ──────────────────────────────────────────

/** JS code to read all key-value pairs from localStorage or sessionStorage */
const readStorageJs = (type: 'localStorage' | 'sessionStorage') => `
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

/** JS code to enumerate all IndexedDB databases and read all records */
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

async function handleExportState(cmd: Command, workspace: string): Promise<Result> {
  const tabId = await resolveTabId(cmd.tabId, workspace);

  try {
    // 1. Get current tab info
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';
    let domain = '';
    try { domain = new URL(url).hostname; } catch {}

    // 2. Read cookies
    const cookieQuery: chrome.cookies.GetAllDetails = {};
    if (cmd.domain) cookieQuery.domain = cmd.domain;
    else if (url) cookieQuery.url = url;
    const rawCookies = await chrome.cookies.getAll(cookieQuery);
    const cookies = rawCookies.map(c => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate,
    }));

    // 3. Read localStorage
    const localStorage = await executor.evaluate(tabId, readStorageJs('localStorage')) as Record<string, string> ?? {};

    // 4. Read sessionStorage
    const sessionStorage = await executor.evaluate(tabId, readStorageJs('sessionStorage')) as Record<string, string> ?? {};

    // 5. Read IndexedDB
    const indexedDB = await executor.evaluate(tabId, READ_INDEXEDDB_JS) ?? [];

    return {
      id: cmd.id, ok: true,
      data: { version: 1, url, domain: cmd.domain || domain, timestamp: Date.now(),
              cookies, localStorage, sessionStorage, indexedDB },
    };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleImportState(cmd: Command, workspace: string): Promise<Result> {
  if (!cmd.state) return { id: cmd.id, ok: false, error: 'Missing state data' };
  const { cookies, localStorage, sessionStorage, indexedDB, url } = cmd.state;
  const errors: string[] = [];

  // 1. Navigate to target URL (required for same-origin storage access)
  if (url) {
    const tabId = await resolveTabId(cmd.tabId, workspace);
    await chrome.tabs.update(tabId, { url });
    await new Promise<void>((resolve) => {
      const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
        if (id === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
    });
  }

  // 2. Import cookies
  if (cookies?.length) {
    for (const c of cookies) {
      try {
        await chrome.cookies.set({
          url: c.url || `http${c.secure ? 's' : ''}://${c.domain.replace(/^\\./, '')}${c.path || '/'}`,
          name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
          secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate,
        });
      } catch (e) { errors.push(`Cookie ${c.name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }

  // 3. Import localStorage / sessionStorage via CDP
  const tabId = await resolveTabId(cmd.tabId, workspace);
  for (const [type, data] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]] as const) {
    if (data && Object.keys(data).length > 0) {
      try {
        const entries = JSON.stringify(data);
        await executor.evaluate(tabId, `(() => { const e = ${entries}; for (const [k,v] of Object.entries(e)) window.${type}.setItem(k,v); return Object.keys(e).length; })()`);
      } catch (e) { errors.push(`${type}: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }

  // 4. Import IndexedDB
  if (indexedDB?.length) {
    const idbData = JSON.stringify(indexedDB);
    try {
      await executor.evaluate(tabId, `
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
    } catch (e) { errors.push(`IndexedDB: ${e instanceof Error ? e.message : String(e)}`); }
  }

  return { id: cmd.id, ok: true, data: { imported: true, ...(errors.length ? { errors } : {}) } };
}

// ─── Real-time state sync ──────────────────────────────────────────────

/** Set of domains being watched for state changes. Empty = all domains. */
let watchedDomains: Set<string> | null = null; // null = not watching

function handleWatchState(cmd: Command): Result {
  if (cmd.domains?.length) {
    watchedDomains = new Set(cmd.domains);
  } else {
    watchedDomains = new Set(); // empty = watch all
  }
  console.log(`[opencli] Watching state changes for: ${watchedDomains.size > 0 ? [...watchedDomains].join(', ') : 'all domains'}`);
  return { id: cmd.id, ok: true, data: { watching: true, domains: cmd.domains ?? [] } };
}

function handleUnwatchState(cmd: Command): Result {
  watchedDomains = null;
  console.log('[opencli] Stopped watching state changes');
  return { id: cmd.id, ok: true, data: { watching: false } };
}

function isDomainWatched(domain: string): boolean {
  if (watchedDomains === null) return false;
  if (watchedDomains.size === 0) return true; // watch all
  // Check exact and parent domain match (e.g. .github.com matches github.com)
  const clean = domain.replace(/^\./, '');
  for (const watched of watchedDomains) {
    if (clean === watched || clean.endsWith('.' + watched)) return true;
  }
  return false;
}

function sendSyncEvent(event: SyncEvent): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(event));
  } catch { /* ignore */ }
}

// Cookie change listener — fires whenever any cookie is set, deleted, or modified
chrome.cookies.onChanged.addListener((changeInfo) => {
  const { cookie, removed, cause } = changeInfo;
  if (!isDomainWatched(cookie.domain)) return;

  const event: SyncEvent = {
    type: 'state-change',
    changeType: 'cookie',
    domain: cookie.domain.replace(/^\./, ''),
    cookie: {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expirationDate,
      removed,
      cause,
    },
    timestamp: Date.now(),
  };

  sendSyncEvent(event);
});

export const __test__ = {
  handleTabs,
  handleSessions,
  getAutomationWindowId: (workspace: string = 'default') => automationSessions.get(workspace)?.windowId ?? null,
  setAutomationWindowId: (workspace: string, windowId: number | null) => {
    if (windowId === null) {
      const session = automationSessions.get(workspace);
      if (session?.idleTimer) clearTimeout(session.idleTimer);
      automationSessions.delete(workspace);
      return;
    }
    automationSessions.set(workspace, {
      windowId,
      idleTimer: null,
      idleDeadlineAt: Date.now() + WINDOW_IDLE_TIMEOUT,
    });
  },
};
