import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHealthLive, fetchHealthReady } from './health-client.js';

const liveBody = {
  status: 'ok',
  uptimeSeconds: 3,
  timestamp: new Date().toISOString(),
};

const readyBody = {
  status: 'ok',
  checks: {
    database: { state: 'ok', latencyMs: 2 },
    redis: { state: 'ok', latencyMs: 1 },
    objectStorage: { state: 'ok', latencyMs: 9 },
  },
  version: '0.1.0',
  timestamp: new Date().toISOString(),
};

function mockFetchOnce(body: unknown, init: { status?: number; json?: () => unknown } = {}) {
  return vi.fn(
    async () =>
      new Response(init.json ? undefined : JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchHealthLive', () => {
  it('geçerli yanıtı sözleşmeyle doğrulayıp döner', async () => {
    const fetchMock = mockFetchOnce(liveBody);
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchHealthLive('http://localhost:4000');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('ok');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/health/live',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
  });

  it('HTTP hatası ok:false + http-error döner', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({}, { status: 503 }));
    const result = await fetchHealthLive('http://localhost:4000');
    expect(result).toEqual({
      ok: false,
      error: { kind: 'http-error', message: 'HTTP 503', httpStatus: 503 },
    });
  });

  it('sözleşmeye uymayan gövde contract-mismatch döner', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ status: 'weird' }));
    const result = await fetchHealthLive('http://localhost:4000');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('contract-mismatch');
    }
  });

  it('ağ hatası network-error döner', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    );
    const result = await fetchHealthLive('http://localhost:4000');
    expect(result).toEqual({
      ok: false,
      error: { kind: 'network-error', message: 'Ağa ulaşılamadı' },
    });
  });
});

describe('fetchHealthReady', () => {
  it('geçerli ready yanıtı döner', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(readyBody));
    const result = await fetchHealthReady('http://localhost:4000/');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.checks.redis.state).toBe('ok');
    }
  });
});
