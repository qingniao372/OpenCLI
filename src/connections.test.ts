import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError } from './errors.js';

const { TEST_HOME, httpGetMock, httpsGetMock } = vi.hoisted(() => ({
  TEST_HOME: '/tmp/opencli-connections-vitest',
  httpGetMock: vi.fn(),
  httpsGetMock: vi.fn(),
}));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => TEST_HOME,
  };
});

vi.mock('node:http', async () => {
  const actual = await vi.importActual<typeof import('node:http')>('node:http');
  return {
    ...actual,
    get: httpGetMock,
  };
});

vi.mock('node:https', async () => {
  const actual = await vi.importActual<typeof import('node:https')>('node:https');
  return {
    ...actual,
    get: httpsGetMock,
  };
});

import {
  getSavedSiteConnection,
  loadConnections,
  parseCdpPort,
  probeCdpEndpoint,
  removeSiteConnection,
  resolveLiveSiteEndpoint,
  saveSiteConnection,
} from './connections.js';

const CONNECTIONS_PATH = path.join(TEST_HOME, '.opencli', 'connections.json');

function mockRequest() {
  return {
    on: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
  } as any;
}

function mockProbeStatuses(statusByUrl: Record<string, number>) {
  const req = mockRequest();
  httpGetMock.mockImplementation((input: string | URL, cb: any) => {
    cb({ statusCode: statusByUrl[String(input)] ?? 503, resume() {} });
    return req;
  });
  return req;
}

describe('connections', () => {
  beforeEach(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    delete process.env.OPENCLI_CDP_ENDPOINT;
    httpGetMock.mockReset();
    httpsGetMock.mockReset();
  });

  afterEach(() => {
    delete process.env.OPENCLI_CDP_ENDPOINT;
    vi.restoreAllMocks();
  });

  it('saves and removes site connections', () => {
    const saved = saveSiteConnection('chatwise', 'http://127.0.0.1:9228/');

    expect(saved.endpoint).toBe('http://127.0.0.1:9228');
    expect(getSavedSiteConnection('chatwise')?.endpoint).toBe('http://127.0.0.1:9228');
    expect(loadConnections().cdp.chatwise?.endpoint).toBe('http://127.0.0.1:9228');
    expect(fs.existsSync(CONNECTIONS_PATH)).toBe(true);

    removeSiteConnection('chatwise');

    expect(getSavedSiteConnection('chatwise')).toBeUndefined();
    expect(loadConnections().cdp.chatwise).toBeUndefined();
  });

  it('validates CDP ports', () => {
    expect(parseCdpPort('9222')).toBe(9222);
    expect(() => parseCdpPort('abc')).toThrowError(CliError);
    expect(() => parseCdpPort('70000')).toThrowError(CliError);
  });

  it('probes ws endpoints via the http json/version URL', async () => {
    const req = mockRequest();
    httpGetMock.mockImplementation((input: string | URL, cb: any) => {
      cb({ statusCode: 200, resume() {} });
      return req;
    });

    await expect(probeCdpEndpoint('ws://127.0.0.1:9222/devtools/browser/abc')).resolves.toBe(true);
    expect(httpGetMock).toHaveBeenCalledTimes(1);
    expect(String(httpGetMock.mock.calls[0][0])).toBe('http://127.0.0.1:9222/json/version');
  });

  it('probes https endpoints with the https transport', async () => {
    const req = mockRequest();
    httpsGetMock.mockImplementation((input: string | URL, cb: any) => {
      cb({ statusCode: 204, resume() {} });
      return req;
    });

    await expect(probeCdpEndpoint('https://example.com:9222')).resolves.toBe(true);
    expect(httpsGetMock).toHaveBeenCalledTimes(1);
    expect(String(httpsGetMock.mock.calls[0][0])).toBe('https://example.com:9222/json/version');
  });

  it('rejects unsupported endpoint protocols with a clear error', async () => {
    await expect(probeCdpEndpoint('ftp://example.com')).rejects.toMatchObject({
      code: 'CONNECT_UNSUPPORTED_PROTOCOL',
    });
  });

  it('resolves a saved endpoint before falling back', async () => {
    saveSiteConnection('chatwise', 'http://127.0.0.1:9555');
    mockProbeStatuses({ 'http://127.0.0.1:9555/json/version': 200 });

    await expect(resolveLiveSiteEndpoint('chatwise')).resolves.toBe('http://127.0.0.1:9555');
  });

  it('falls back to the env endpoint when the saved one is unavailable', async () => {
    saveSiteConnection('chatwise', 'http://127.0.0.1:9555');
    process.env.OPENCLI_CDP_ENDPOINT = 'http://127.0.0.1:9666/';
    mockProbeStatuses({ 'http://127.0.0.1:9666/json/version': 200 });

    await expect(resolveLiveSiteEndpoint('chatwise')).resolves.toBe('http://127.0.0.1:9666');
  });

});
