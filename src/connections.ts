import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { CliError } from './errors.js';
import type { CliCommand } from './registry.js';

export type SavedConnection = {
  endpoint: string;
  updatedAt: string;
};

type ConnectionsFile = {
  version: 1;
  cdp: Record<string, SavedConnection>;
};

export const DESKTOP_CDP_SITES: Record<string, { defaultPort: number; appName: string }> = {
  antigravity: { defaultPort: 9224, appName: 'Antigravity' },
  codex: { defaultPort: 9222, appName: 'Codex' },
  cursor: { defaultPort: 9226, appName: 'Cursor' },
  'discord-app': { defaultPort: 9232, appName: 'Discord' },
  notion: { defaultPort: 9230, appName: 'Notion' },
  chatwise: { defaultPort: 9228, appName: 'ChatWise' },
};

const OPENCLI_DIR = path.join(os.homedir(), '.opencli');
const CONNECTIONS_PATH = path.join(OPENCLI_DIR, 'connections.json');

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

function toProbeUrl(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(normalizeEndpoint(endpoint));
  } catch {
    throw new CliError(
      'CONNECT_INVALID_ENDPOINT',
      `Invalid CDP endpoint: ${endpoint}.`,
      'Use a full URL such as http://127.0.0.1:9222 or ws://127.0.0.1:9222/devtools/browser/<id>.'
    );
  }

  if (url.protocol === 'ws:') url.protocol = 'http:';
  else if (url.protocol === 'wss:') url.protocol = 'https:';
  else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CliError(
      'CONNECT_UNSUPPORTED_PROTOCOL',
      `Unsupported CDP endpoint protocol: ${url.protocol}`,
      'Use an http(s) or ws(s) CDP endpoint.'
    );
  }

  url.pathname = '/json/version';
  url.search = '';
  url.hash = '';
  return url;
}

export function parseCdpPort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || String(port) !== value.trim() || port < 1 || port > 65535) {
    throw new CliError(
      'CONNECT_INVALID_PORT',
      `Invalid CDP port: ${value}.`,
      'Provide an integer between 1 and 65535.'
    );
  }
  return port;
}

export function isDesktopCdpSite(site: string): boolean {
  return site in DESKTOP_CDP_SITES;
}

export function isDesktopCdpCommand(cmd: CliCommand): boolean {
  return cmd.browser === true && cmd.domain === 'localhost' && isDesktopCdpSite(cmd.site);
}

export function loadConnections(): ConnectionsFile {
  try {
    const raw = fs.readFileSync(CONNECTIONS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ConnectionsFile>;
    return {
      version: 1,
      cdp: parsed.cdp ?? {},
    };
  } catch {
    return { version: 1, cdp: {} };
  }
}

function saveConnections(data: ConnectionsFile): void {
  fs.mkdirSync(OPENCLI_DIR, { recursive: true });
  fs.writeFileSync(CONNECTIONS_PATH, JSON.stringify(data, null, 2) + '\n');
}

export function saveSiteConnection(site: string, endpoint: string): SavedConnection {
  const data = loadConnections();
  const saved: SavedConnection = {
    endpoint: normalizeEndpoint(endpoint),
    updatedAt: new Date().toISOString(),
  };
  data.cdp[site] = saved;
  saveConnections(data);
  return saved;
}

export function removeSiteConnection(site: string): void {
  const data = loadConnections();
  delete data.cdp[site];
  saveConnections(data);
}

export function getSavedSiteConnection(site: string): SavedConnection | undefined {
  return loadConnections().cdp[site];
}

export function defaultSiteEndpoint(site: string): string | undefined {
  const meta = DESKTOP_CDP_SITES[site];
  if (!meta) return undefined;
  return `http://127.0.0.1:${meta.defaultPort}`;
}

export async function probeCdpEndpoint(endpoint: string, timeoutMs = 800): Promise<boolean> {
  const probeUrl = toProbeUrl(endpoint);
  const transport = probeUrl.protocol === 'https:' ? https : http;
  return new Promise<boolean>((resolve) => {
    const req = transport.get(probeUrl, (res) => {
      res.resume();
      resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function resolveLiveSiteEndpoint(site: string): Promise<string | undefined> {
  const saved = getSavedSiteConnection(site)?.endpoint;
  if (saved && await probeCdpEndpoint(saved)) return saved;

  const env = process.env.OPENCLI_CDP_ENDPOINT;
  if (env && await probeCdpEndpoint(env)) return normalizeEndpoint(env);

  return undefined;
}

export function buildDisconnectedStatusRow(cmd: CliCommand): Record<string, string> {
  const row: Record<string, string> = {};
  const columns = cmd.columns ?? ['Status'];

  for (const column of columns) {
    const lower = column.toLowerCase();
    if (lower === 'status') row[column] = 'Disconnected';
    else if (lower === 'detail') row[column] = `Run "opencli connect ${cmd.site}" after launching the app with remote debugging enabled.`;
    else row[column] = '';
  }

  if (!columns.some((c) => c.toLowerCase() === 'status')) {
    row.Status = 'Disconnected';
  }

  return row;
}
