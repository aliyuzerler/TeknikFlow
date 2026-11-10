import { describe, expect, it } from 'vitest';
import {
  hasCustomerSignatures,
  isTerminalStatus,
  laborDurationMinutes,
  missingRequiredChecklist,
  validateChecklistResponseValue,
  visitDataFromLocation,
} from './execution-rules.js';

/**
 * TEST-08 §2 — Faz 08 yürütme saf kuralları birim testleri.
 */

describe('validateChecklistResponseValue', () => {
  it('BOOLEAN: bool kabul, string reddi', () => {
    expect(validateChecklistResponseValue('BOOLEAN', null, true)).toBeNull();
    expect(validateChecklistResponseValue('BOOLEAN', null, 'evet')).toBeTruthy();
  });

  it('NUMBER: sonlu sayı kabul; NaN/Infinity/string reddi', () => {
    expect(validateChecklistResponseValue('NUMBER', null, 4.5)).toBeNull();
    expect(validateChecklistResponseValue('NUMBER', null, Number.NaN)).toBeTruthy();
    expect(validateChecklistResponseValue('NUMBER', null, '4.5')).toBeTruthy();
  });

  it('TEXT: ≤2000 karakter; uzun metin reddi', () => {
    expect(validateChecklistResponseValue('TEXT', null, 'tamam')).toBeNull();
    expect(validateChecklistResponseValue('TEXT', null, 'x'.repeat(2001))).toBeTruthy();
  });

  it('SINGLE_SELECT: seçenek dışı değer reddi', () => {
    expect(
      validateChecklistResponseValue('SINGLE_SELECT', ['Tamam', 'Arızalı'], 'Tamam'),
    ).toBeNull();
    expect(
      validateChecklistResponseValue('SINGLE_SELECT', ['Tamam', 'Arızalı'], 'Bilinmiyor'),
    ).toBeTruthy();
    expect(validateChecklistResponseValue('SINGLE_SELECT', null, 'Tamam')).toBeTruthy();
  });

  it('MULTI_SELECT: tekrarlı/olmayan seçenek reddi', () => {
    expect(validateChecklistResponseValue('MULTI_SELECT', ['A', 'B'], ['A', 'B'])).toBeNull();
    expect(validateChecklistResponseValue('MULTI_SELECT', ['A', 'B'], ['A', 'A'])).toBeTruthy();
    expect(validateChecklistResponseValue('MULTI_SELECT', ['A', 'B'], ['A', 'C'])).toBeTruthy();
    expect(validateChecklistResponseValue('MULTI_SELECT', ['A', 'B'], 'A')).toBeTruthy();
  });

  it('null her tipte kabul (temizleme)', () => {
    for (const type of ['BOOLEAN', 'NUMBER', 'TEXT', 'SINGLE_SELECT', 'MULTI_SELECT'] as const) {
      expect(validateChecklistResponseValue(type, null, null)).toBeNull();
    }
  });
});

describe('laborDurationMinutes', () => {
  it('dakika yuvarlama ve minimum 1', () => {
    const base = new Date('2026-11-10T10:00:00.000Z');
    expect(laborDurationMinutes(base, new Date('2026-11-10T11:00:00.000Z'))).toBe(60);
    expect(laborDurationMinutes(base, new Date('2026-11-10T10:00:20.000Z'))).toBe(1);
    expect(laborDurationMinutes(base, new Date('2026-11-10T10:29:59.000Z'))).toBe(30);
  });
});

describe('visitDataFromLocation', () => {
  const gpsLocation = {
    latitude: 41.0082,
    longitude: 28.9784,
    accuracyMeters: 8.3,
    capturedAt: '2026-11-10T09:30:00.000Z',
    source: 'GPS' as const,
  };

  it('GPS konumu korunur; doğruluk ve zaman taşınır', () => {
    const visit = visitDataFromLocation(gpsLocation, 'CHECK_IN');
    expect(visit).toMatchObject({
      visitType: 'CHECK_IN',
      latitude: 41.0082,
      longitude: 28.9784,
      accuracyMeters: 8.3,
      source: 'GPS',
      manualReason: null,
    });
    expect(visit.capturedAt).toEqual(new Date('2026-11-10T09:30:00.000Z'));
  });

  it('MANUEL konum: neden taşınır, doğruluk boş', () => {
    const visit = visitDataFromLocation(
      {
        latitude: 41.0,
        longitude: 29.0,
        capturedAt: '2026-11-10T09:30:00.000Z',
        source: 'MANUAL',
        manualReason: 'GPS izni verilmedi',
      },
      'CHECK_OUT',
    );
    expect(visit).toMatchObject({
      visitType: 'CHECK_OUT',
      source: 'MANUAL',
      manualReason: 'GPS izni verilmedi',
      accuracyMeters: null,
    });
  });

  it('KONUM YOK (izin reddi fallback): MANUAL + konum paylaşılmadı', () => {
    const visit = visitDataFromLocation(undefined, 'CHECK_IN');
    expect(visit).toEqual({
      visitType: 'CHECK_IN',
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      source: 'MANUAL',
      manualReason: 'Konum paylaşılmadı',
      capturedAt: null,
    });
  });
});

describe('kanıt kapıları', () => {
  it('zorunlu ama yanıtlanmamış maddeler eksik listeye düşer', () => {
    const items = [
      { id: '1', label: 'Enerji kesildi mi?', required: true, responseValue: true },
      { id: '2', label: 'Filtre değişti mi?', required: true, responseValue: null },
      { id: '3', label: 'Not', required: false, responseValue: null },
    ];
    expect(missingRequiredChecklist(items)).toEqual([{ id: '2', label: 'Filtre değişti mi?' }]);
  });

  it('müşteri imzası yoksa kapatma kapısı kapalı', () => {
    expect(hasCustomerSignatures([{ signedBy: 'TECHNICIAN' }])).toBe(false);
    expect(hasCustomerSignatures([{ signedBy: 'TECHNICIAN' }, { signedBy: 'CUSTOMER' }])).toBe(
      true,
    );
    expect(hasCustomerSignatures([])).toBe(false);
  });

  it('terminal durumlar CLOSED/CANCELLED', () => {
    expect(isTerminalStatus('CLOSED')).toBe(true);
    expect(isTerminalStatus('CANCELLED')).toBe(true);
    expect(isTerminalStatus('COMPLETED')).toBe(false);
  });
});
