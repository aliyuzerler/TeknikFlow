import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

// configureApp/vitest .env yükler: CORS_ORIGINS=http://localhost:3000 (kök .env).
import { csrfProtection } from './csrf.middleware.js';

function makeRequest(overrides: {
  method?: string;
  cookie?: string;
  csrfHeader?: string;
  authorization?: string;
  origin?: string;
}): Request {
  const headers: Record<string, string> = {};
  if (overrides.cookie) headers.cookie = overrides.cookie;
  if (overrides.csrfHeader) headers['x-csrf-token'] = overrides.csrfHeader;
  if (overrides.authorization) headers.authorization = overrides.authorization;
  if (overrides.origin) headers.origin = overrides.origin;
  return {
    method: overrides.method ?? 'POST',
    headers,
  } as unknown as Request;
}

function makeResponse() {
  return {} as Response;
}

describe('CSRF middleware (çift-gönderim + Origin)', () => {
  it('güvenli fiiller geçer', () => {
    const next = vi.fn();
    csrfProtection(makeRequest({ method: 'GET' }), makeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('oturum çerezi yoksa (login/signup) geçer', () => {
    const next = vi.fn();
    csrfProtection(makeRequest({ method: 'POST' }), makeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('Bearer taşıyan istekler muaftır (mobil)', () => {
    const next = vi.fn();
    csrfProtection(
      makeRequest({ method: 'POST', authorization: 'Bearer abc', cookie: 'tf_session=x' }),
      makeResponse(),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('çerez var + CSRF başlığı yok → 403', () => {
    const next = vi.fn();
    csrfProtection(makeRequest({ method: 'POST', cookie: 'tf_session=x' }), makeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0];
    expect(err?.status).toBe(403);
    expect(err?.response?.code).toBe('CSRF_INVALID');
  });

  it('çerez ve başlık eşleşmez → 403', () => {
    const next = vi.fn();
    csrfProtection(
      makeRequest({ method: 'POST', cookie: 'tf_session=x; tf_csrf=A', csrfHeader: 'B' }),
      makeResponse(),
      next,
    );
    const err = next.mock.calls[0]?.[0];
    expect(err?.status).toBe(403);
  });

  it('çerez ve başlık eşleşirse geçer', () => {
    const next = vi.fn();
    csrfProtection(
      makeRequest({ method: 'PATCH', cookie: 'tf_session=x; tf_csrf=TOKEN', csrfHeader: 'TOKEN' }),
      makeResponse(),
      next,
    );
    expect(next).toHaveBeenCalledWith(); // hata olmadan çağrıldı
  });

  it('izinli olmayan Origin → 403 CSRF_ORIGIN', () => {
    const next = vi.fn();
    csrfProtection(
      makeRequest({
        method: 'POST',
        cookie: 'tf_session=x; tf_csrf=TOKEN',
        csrfHeader: 'TOKEN',
        origin: 'https://evil.example',
      }),
      makeResponse(),
      next,
    );
    const err = next.mock.calls[0]?.[0];
    expect(err?.status).toBe(403);
    expect(err?.response?.code).toBe('CSRF_ORIGIN');
  });

  it('izinli Origin (CORS_ORIGINS) geçer', () => {
    const next = vi.fn();
    csrfProtection(
      makeRequest({
        method: 'POST',
        cookie: 'tf_session=x; tf_csrf=TOKEN',
        csrfHeader: 'TOKEN',
        origin: 'http://localhost:3000',
      }),
      makeResponse(),
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });
});
