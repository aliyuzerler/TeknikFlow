import { describe, expect, it } from 'vitest';
import type { HealthReadyResponse } from '@teknikflow/contracts';
import {
  overallFromCards,
  serviceCardsFromApi,
  statusLabel,
  workerCard,
  type ApiReadyResult,
} from './status.js';

const readyOk: HealthReadyResponse = {
  status: 'ok',
  checks: {
    database: { state: 'ok', latencyMs: 3 },
    redis: { state: 'ok', latencyMs: 1 },
    objectStorage: { state: 'ok', latencyMs: 11 },
  },
  version: '0.1.0',
  timestamp: new Date().toISOString(),
};

const readyDegraded: HealthReadyResponse = {
  ...readyOk,
  status: 'degraded',
  checks: { ...readyOk.checks, redis: { state: 'fail', error: 'ECONNREFUSED' } },
};

describe('serviceCardsFromApi', () => {
  it('başarılı yanıtta 4 kart: API + 3 bağımlılık, hepsi ok', () => {
    const cards = serviceCardsFromApi({ ok: true, data: readyOk } as ApiReadyResult, 42);
    expect(cards).toHaveLength(4);
    expect(cards.map((c) => c.state)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(cards[0]!.latencyMs).toBe(42);
  });

  it('degraded yanıtta API kartı sınırlı, redis hizmet dışı', () => {
    const cards = serviceCardsFromApi({ ok: true, data: readyDegraded } as ApiReadyResult);
    expect(cards[0]!.label).toBe('Sınırlı');
    const redis = cards.find((c) => c.id === 'redis');
    expect(redis?.state).toBe('fail');
    expect(redis?.error).toBe('ECONNREFUSED');
  });

  it('API erişilemezse 4 kart da bilinmiyor/hizmet dışı üretilir', () => {
    const result = {
      ok: false,
      error: { kind: 'network-error' as const, message: 'Ağa ulaşılamadı' },
    } as ApiReadyResult;
    const cards = serviceCardsFromApi(result);
    expect(cards).toHaveLength(4);
    expect(cards.every((c) => c.state === 'fail')).toBe(true);
    expect(cards[0]!.label).toBe('Erişilemedi');
  });

  it('zaman aşımı etiketi ayrıştırılır', () => {
    const result = {
      ok: false,
      error: { kind: 'timeout' as const, message: 'İstek zaman aşımına uğradı' },
    } as ApiReadyResult;
    const cards = serviceCardsFromApi(result);
    expect(cards[0]!.label).toBe('Zaman aşımı');
  });
});

describe('workerCard', () => {
  it('taze kalp atışı → ok', () => {
    const card = workerCard({ status: 'ok', ageSeconds: 5 });
    expect(card.state).toBe('ok');
    expect(card.label).toBe('Çalışıyor');
  });

  it('bayat kalp atışı → fail + yaş bilgisi', () => {
    const card = workerCard({ status: 'degraded', ageSeconds: 120 });
    expect(card.state).toBe('fail');
    expect(card.error).toContain('120');
  });

  it('ulaşılamayan worker → fail', () => {
    const card = workerCard(null);
    expect(card.state).toBe('fail');
    expect(card.label).toBe('Erişilemedi');
  });
});

describe('overallFromCards', () => {
  it('hepsi ok → genel hazır', () => {
    const cards = serviceCardsFromApi({ ok: true, data: readyOk } as ApiReadyResult);
    expect(overallFromCards([...cards, workerCard({ status: 'ok' })]).text).toBe(
      'Tüm sistemler hazır',
    );
  });

  it('tek fail → kısıtlı + servis adı', () => {
    const cards = serviceCardsFromApi({ ok: true, data: readyDegraded } as ApiReadyResult);
    const overall = overallFromCards(cards);
    expect(overall.state).toBe('degraded');
    expect(overall.text).toContain('Redis');
  });
});

describe('statusLabel', () => {
  it('etiketler Türkçe', () => {
    expect(statusLabel('ok')).toBe('Çalışıyor');
    expect(statusLabel('fail')).toBe('Hizmet dışı');
  });
});
