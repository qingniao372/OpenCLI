/**
 * Live state sync service: Chrome → Camoufox.
 *
 * Subscribes to daemon /sync WebSocket for real-time cookie/storage change events
 * from Chrome Extension, then applies each change to the connected Camoufox context.
 *
 * Flow:
 *   chrome.cookies.onChanged → Extension → daemon /sync WS → THIS → Camoufox context
 */

import { WebSocket } from 'ws';
import type { Browser, BrowserContext } from 'playwright-core';
import { firefox } from 'playwright-core';

export interface SyncServiceOptions {
  /** Daemon WebSocket URL base (default: ws://127.0.0.1:19825) */
  daemonUrl?: string;
  /** Camoufox WebSocket endpoint */
  camoufoxWs: string;
  /** Domains to watch (empty = all) */
  domains?: string[];
  /** Callback on each synced event */
  onSync?: (event: SyncEvent) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

interface SyncEvent {
  type: 'state-change';
  changeType: 'cookie' | 'localStorage' | 'sessionStorage';
  domain: string;
  cookie?: {
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    expirationDate?: number;
    removed: boolean;
    cause?: string;
  };
  storage?: {
    key: string;
    newValue: string | null;
    oldValue: string | null;
    storageArea: 'localStorage' | 'sessionStorage';
    url: string;
  };
  timestamp: number;
}

export class LiveSyncService {
  private daemonWs: WebSocket | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private running = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stats = { cookies: 0, storage: 0, errors: 0 };

  constructor(private readonly opts: SyncServiceOptions) {}

  async start(): Promise<void> {
    this.running = true;

    // Connect to Camoufox
    this.browser = await firefox.connect(this.opts.camoufoxWs, { timeout: 10000 });
    this.context = await this.browser.newContext();

    // Connect to daemon /sync WebSocket
    this.connectToDaemon();

    // Tell extension to start watching
    await this.sendWatchCommand();
  }

  async stop(): Promise<void> {
    this.running = false;

    // Tell extension to stop watching
    await this.sendUnwatchCommand().catch(() => {});

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.daemonWs?.close();
    this.daemonWs = null;

    try { await this.context?.close(); } catch {}
    this.context = null;
    this.browser = null;
  }

  getStats() { return { ...this.stats }; }

  private connectToDaemon(): void {
    const base = this.opts.daemonUrl ?? 'ws://127.0.0.1:19825';
    const syncUrl = `${base}/sync`;

    this.daemonWs = new WebSocket(syncUrl);

    this.daemonWs.on('open', () => {
      // Connected to daemon sync channel
    });

    this.daemonWs.on('message', (data) => {
      try {
        const event: SyncEvent = JSON.parse(data.toString());
        if (event.type === 'state-change') {
          this.handleSyncEvent(event).catch(err => {
            this.stats.errors++;
            this.opts.onError?.(err);
          });
        }
      } catch { /* ignore malformed */ }
    });

    this.daemonWs.on('close', () => {
      if (this.running) {
        // Auto-reconnect
        this.reconnectTimer = setTimeout(() => this.connectToDaemon(), 2000);
      }
    });

    this.daemonWs.on('error', () => {
      // Will trigger 'close' event
    });
  }

  private async handleSyncEvent(event: SyncEvent): Promise<void> {
    if (!this.context) return;

    if (event.changeType === 'cookie' && event.cookie) {
      if (event.cookie.removed) {
        // Cookie deleted — remove from Camoufox context
        // Playwright doesn't have a deleteCookie API, so we set it with expired date
        await this.context.addCookies([{
          name: event.cookie.name,
          value: '',
          domain: event.cookie.domain,
          path: event.cookie.path,
          expires: 0, // epoch = expired
        }]);
      } else {
        // Cookie added/updated — set in Camoufox context
        await this.context.addCookies([{
          name: event.cookie.name,
          value: event.cookie.value,
          domain: event.cookie.domain,
          path: event.cookie.path,
          secure: event.cookie.secure,
          httpOnly: event.cookie.httpOnly,
          expires: event.cookie.expirationDate ?? -1,
        }]);
      }
      this.stats.cookies++;
    }

    if (event.changeType === 'localStorage' && event.storage) {
      // Apply to all matching pages in context
      const pages = this.context.pages();
      for (const page of pages) {
        try {
          const pageUrl = page.url();
          if (!pageUrl.includes(event.domain)) continue;
          if (event.storage.newValue !== null) {
            await page.evaluate(`window.localStorage.setItem(${JSON.stringify(event.storage.key)}, ${JSON.stringify(event.storage.newValue)})`);
          } else {
            await page.evaluate(`window.localStorage.removeItem(${JSON.stringify(event.storage.key)})`);
          }
          this.stats.storage++;
        } catch { /* page might be navigating */ }
      }
    }

    this.opts.onSync?.(event);
  }

  private async sendWatchCommand(): Promise<void> {
    const daemonHttp = (this.opts.daemonUrl ?? 'ws://127.0.0.1:19825').replace('ws://', 'http://');
    const body = JSON.stringify({
      id: `watch-${Date.now()}`,
      action: 'watch-state',
      domains: this.opts.domains ?? [],
    });
    const resp = await fetch(`${daemonHttp}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const result = await resp.json();
    if (!result.ok) throw new Error(`watch-state failed: ${result.error}`);
  }

  private async sendUnwatchCommand(): Promise<void> {
    const daemonHttp = (this.opts.daemonUrl ?? 'ws://127.0.0.1:19825').replace('ws://', 'http://');
    const body = JSON.stringify({
      id: `unwatch-${Date.now()}`,
      action: 'unwatch-state',
    });
    await fetch(`${daemonHttp}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {});
  }
}
