/**
 * opencli browser protocol — shared types between daemon, extension, and CLI.
 *
 * Actions: exec, navigate, tabs, cookies, screenshot, export-state, import-state.
 * Everything else is just JS code sent via 'exec'.
 */

export type Action = 'exec' | 'navigate' | 'tabs' | 'cookies' | 'screenshot' | 'close-window' | 'sessions' | 'export-state' | 'import-state' | 'watch-state' | 'unwatch-state';

export interface Command {
  /** Unique request ID */
  id: string;
  /** Action type */
  action: Action;
  /** Target tab ID (omit for active tab) */
  tabId?: number;
  /** JS code to evaluate in page context (exec action) */
  code?: string;
  /** Logical workspace for automation session reuse */
  workspace?: string;
  /** URL to navigate to (navigate action) */
  url?: string;
  /** Sub-operation for tabs: list, new, close, select */
  op?: 'list' | 'new' | 'close' | 'select';
  /** Tab index for tabs select/close */
  index?: number;
  /** Cookie domain filter */
  domain?: string;
  /** Screenshot format: png (default) or jpeg */
  format?: 'png' | 'jpeg';
  /** JPEG quality (0-100), only for jpeg format */
  quality?: number;
  /** Whether to capture full page (not just viewport) */
  fullPage?: boolean;
  /** Storage type to export (export-state action) */
  storageType?: 'localStorage' | 'sessionStorage' | 'all';
  /** Domain filter for watch-state */
  domains?: string[];
  /** Browser state to import (import-state action) */
  state?: {
    cookies?: Array<{
      name: string;
      value: string;
      domain: string;
      path?: string;
      secure?: boolean;
      httpOnly?: boolean;
      expirationDate?: number;
      url?: string;
    }>;
    localStorage?: Record<string, string>;
    sessionStorage?: Record<string, string>;
    indexedDB?: Array<{
      name: string;
      version: number;
      objectStores: Array<{
        name: string;
        keyPath: string | string[] | null;
        autoIncrement: boolean;
        records: Array<{ key: unknown; value: unknown }>;
      }>;
    }>;
    url?: string;
  };
}

/** Real-time state change event pushed from extension → daemon → sync subscribers */
export interface SyncEvent {
  type: 'state-change';
  changeType: 'cookie' | 'localStorage' | 'sessionStorage';
  /** The domain this change applies to */
  domain: string;
  /** For cookies: the changed cookie */
  cookie?: {
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    expirationDate?: number;
    removed: boolean;
    /** Reason for removal: 'expired', 'explicit', 'overwrite', etc */
    cause?: string;
  };
  /** For storage: key-value change */
  storage?: {
    key: string;
    newValue: string | null;
    oldValue: string | null;
    storageArea: 'localStorage' | 'sessionStorage';
    url: string;
  };
  timestamp: number;
}

export interface Result {
  /** Matching request ID */
  id: string;
  /** Whether the command succeeded */
  ok: boolean;
  /** Result data on success */
  data?: unknown;
  /** Error message on failure */
  error?: string;
}

/** Default daemon port */
export const DAEMON_PORT = 19825;
export const DAEMON_HOST = 'localhost';
export const DAEMON_WS_URL = `ws://${DAEMON_HOST}:${DAEMON_PORT}/ext`;
export const DAEMON_HTTP_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}`;

/** Base reconnect delay for extension WebSocket (ms) */
export const WS_RECONNECT_BASE_DELAY = 2000;
/** Max reconnect delay (ms) */
export const WS_RECONNECT_MAX_DELAY = 60000;
/** Idle timeout before daemon auto-exits (ms) */
export const DAEMON_IDLE_TIMEOUT = 5 * 60 * 1000;
