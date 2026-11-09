import { describe, expect, it } from 'vitest';
import { buildHealthBody, heartbeatAgeSeconds, isHeartbeatFresh } from './heartbeat.js';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const MAX_AGE = 90000;

describe('isHeartbeatFresh', () => {
  it('taze kayıt → true', () => {
    expect(isHeartbeatFresh('2026-11-09T11:59:40Z', NOW, MAX_AGE)).toBe(true);
  });
  it('bayat kayıt → false', () => {
    expect(isHeartbeatFresh('2026-11-09T11:30:00Z', NOW, MAX_AGE)).toBe(false);
  });
  it('kayıt yok / geçersiz → false', () => {
    expect(isHeartbeatFresh(undefined, NOW, MAX_AGE)).toBe(false);
    expect(isHeartbeatFresh('geçersiz', NOW, MAX_AGE)).toBe(false);
  });
  it('sınır değeri kapsayıcıdır', () => {
    const exactly = new Date(NOW - MAX_AGE).toISOString();
    expect(isHeartbeatFresh(exactly, NOW, MAX_AGE)).toBe(true);
  });
});

describe('heartbeatAgeSeconds', () => {
  it('yaşı saniyeye yuvarlar', () => {
    expect(heartbeatAgeSeconds('2026-11-09T11:59:30Z', NOW)).toBe(30);
  });
  it('kayıt yoksa undefined', () => {
    expect(heartbeatAgeSeconds(undefined, NOW)).toBeUndefined();
  });
});

describe('buildHealthBody', () => {
  it('taze kalp atışı → ok', () => {
    expect(buildHealthBody('2026-11-09T11:59:50Z', NOW, MAX_AGE)).toEqual({
      status: 'ok',
      lastHeartbeat: '2026-11-09T11:59:50Z',
      ageSeconds: 10,
    });
  });
  it('bayat kalp atışı → degraded', () => {
    const body = buildHealthBody('2026-11-09T11:00:00Z', NOW, MAX_AGE);
    expect(body.status).toBe('degraded');
    expect(body.ageSeconds).toBe(3600);
  });
  it('kalp atışı hiç yoksa alan gönderilmez', () => {
    expect(buildHealthBody(undefined, NOW, MAX_AGE)).toEqual({ status: 'degraded' });
  });
});
