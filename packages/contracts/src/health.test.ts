import { describe, expect, it } from 'vitest';
import { HealthReadyResponseSchema, HealthLiveResponseSchema } from './health.js';
import { ApiErrorEnvelopeSchema } from './error.js';

const validReady = {
  status: 'ok',
  checks: {
    database: { state: 'ok', latencyMs: 3 },
    redis: { state: 'ok', latencyMs: 1 },
    objectStorage: { state: 'ok', latencyMs: 11 },
  },
  version: '0.1.0',
  timestamp: new Date().toISOString(),
};

describe('HealthLiveResponseSchema', () => {
  it('geçerli yanıt kabul edilir', () => {
    expect(
      HealthLiveResponseSchema.parse({
        status: 'ok',
        uptimeSeconds: 12.5,
        timestamp: new Date().toISOString(),
      }),
    ).toBeTruthy();
  });
  it('yanlış status reddedilir', () => {
    expect(() =>
      HealthLiveResponseSchema.parse({ status: 'degraded', uptimeSeconds: 1, timestamp: 'x' }),
    ).toThrow();
  });
});

describe('HealthReadyResponseSchema', () => {
  it('geçerli yanıt kabul edilir', () => {
    expect(HealthReadyResponseSchema.parse(validReady)).toBeTruthy();
  });
  it('eksik kontrol reddedilir (sözleşme sıkı)', () => {
    const { checks, ...rest } = validReady;
    expect(() =>
      HealthReadyResponseSchema.parse({
        ...rest,
        checks: { ...checks, redis: undefined },
      }),
    ).toThrow();
  });
  it('degraded + fail kontrolleri kabul edilir', () => {
    expect(
      HealthReadyResponseSchema.parse({
        ...validReady,
        status: 'degraded',
        checks: { ...validReady.checks, redis: { state: 'fail', error: 'ECONNREFUSED' } },
      }),
    ).toBeTruthy();
  });
});

describe('ApiErrorEnvelopeSchema', () => {
  it('geçerli zarf kabul edilir', () => {
    expect(
      ApiErrorEnvelopeSchema.parse({
        code: 'NOT_FOUND',
        message: 'Kaynak bulunamadı',
        requestId: '8f1c2d3e-0000-4000-8000-000000000000',
        statusCode: 404,
      }),
    ).toBeTruthy();
  });
  it('statusCode < 400 reddedilir (hata zarfı)', () => {
    expect(() =>
      ApiErrorEnvelopeSchema.parse({
        code: 'X',
        message: 'x',
        requestId: 'r',
        statusCode: 200,
      }),
    ).toThrow();
  });
});
