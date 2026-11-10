import { captureCurrentLocation, manualFallback, toGpsLocation } from './gps';

/**
 * TEST-08 §7 — GPS kilometre taşı çekirdeği: izin reddi/manuel geri dönüş,
 * doğruluk meta'sı ve normalize kuralları (sahte sağlayıcıyla — native yok).
 */

const FIX = {
  latitude: 41.0082,
  longitude: 28.9784,
  accuracyMeters: 12.5,
  timestampMs: Date.parse('2026-11-10T09:30:00.000Z'),
};

describe('toGpsLocation', () => {
  it('ham düzeltmeyi sözleşme konumuna çevirir (kaynak GPS)', () => {
    const location = toGpsLocation(FIX);
    expect(location).toEqual({
      latitude: 41.0082,
      longitude: 28.9784,
      accuracyMeters: 12.5,
      capturedAt: '2026-11-10T09:30:00.000Z',
      source: 'GPS',
    });
  });
});

describe('manualFallback', () => {
  it('nedenle manuel onay üretir (koordinatsız)', () => {
    const at = new Date('2026-11-10T09:35:00.000Z');
    const location = manualFallback('Konum izni reddedildi', at);
    expect(location).toEqual({
      capturedAt: '2026-11-10T09:35:00.000Z',
      source: 'MANUAL',
      manualReason: 'Konum izni reddedildi',
    });
  });

  it('çok kısa neden reddedilir', () => {
    expect(() => manualFallback('x')).toThrow();
  });
});

describe('captureCurrentLocation', () => {
  it('başarılı düzeltme → gps outcome (doğruluk dahil)', async () => {
    const outcome = await captureCurrentLocation(async () => ({ granted: true, fix: FIX }));
    expect(outcome.kind).toBe('gps');
    if (outcome.kind === 'gps') {
      expect(outcome.location.source).toBe('GPS');
      expect(outcome.accuracyMeters).toBe(12.5);
      expect(outcome.location.latitude).toBeCloseTo(41.0082);
    }
  });

  it('izin reddi → denied (manuel onay gerektirir)', async () => {
    const outcome = await captureCurrentLocation(async () => ({ granted: false }));
    expect(outcome.kind).toBe('denied');
  });

  it('sinyal yok → unavailable', async () => {
    const outcome = await captureCurrentLocation(async () => ({ granted: true, fix: null }));
    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind === 'unavailable') {
      expect(outcome.message.length).toBeGreaterThan(0);
    }
  });
});
