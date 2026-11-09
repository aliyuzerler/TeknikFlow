import { describe, expect, it } from 'vitest';
import { computeReadiness, type ServiceCheckResult } from './health.js';

describe('computeReadiness', () => {
  it('tüm kontroller ok ise ok döner', () => {
    const checks: Record<string, ServiceCheckResult> = {
      database: { state: 'ok', latencyMs: 4 },
      redis: { state: 'ok', latencyMs: 1 },
      objectStorage: { state: 'ok', latencyMs: 12 },
    };
    expect(computeReadiness(checks)).toEqual({ status: 'ok', failing: [] });
  });

  it('tek bir fail yeterli: degraded + failing listesi', () => {
    const checks: Record<string, ServiceCheckResult> = {
      database: { state: 'ok', latencyMs: 4 },
      redis: { state: 'fail', error: 'ECONNREFUSED' },
      objectStorage: { state: 'ok', latencyMs: 12 },
    };
    expect(computeReadiness(checks)).toEqual({ status: 'degraded', failing: ['redis'] });
  });

  it('boş küme ok kabul edilir (kontrol yok = engel yok)', () => {
    expect(computeReadiness({})).toEqual({ status: 'ok', failing: [] });
  });

  it('birden fazla fail hepsi listelenir', () => {
    const checks: Record<string, ServiceCheckResult> = {
      database: { state: 'fail', error: 'down' },
      redis: { state: 'fail', error: 'down' },
    };
    expect(computeReadiness(checks).failing).toEqual(['database', 'redis']);
  });
});
