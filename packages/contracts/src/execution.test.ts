import { describe, expect, it } from 'vitest';
import {
  CaptureSignatureRequestSchema,
  CompleteChecklistItemRequestSchema,
  CreateChecklistItemRequestSchema,
  CreateTimeEntryRequestSchema,
  InitMediaUploadRequestSchema,
  MEDIA_RULES,
  StopTimeEntryRequestSchema,
} from './execution.js';
import { GpsLocationSchema, TransitionWorkOrderRequestSchema } from './service.js';

/**
 * TEST-08 §2 — Faz 08 sözleşme doğrulama sınırları.
 *
 * GPS kilometre taşı kuralları (koordinat zorunluluğu / manuel neden),
 * checklist, süre kaydı aralıkları, medya üst limitleri ve imza
 * nokta/stroke sınırları.
 */

describe('GpsLocationSchema', () => {
  const capturedAt = '2026-11-10T09:30:00.000Z';

  it('GPS kaynağında koordinat zorunludur', () => {
    const ok = GpsLocationSchema.safeParse({
      latitude: 41.0082,
      longitude: 28.9784,
      accuracyMeters: 12.5,
      capturedAt,
      source: 'GPS',
    });
    expect(ok.success).toBe(true);
    expect(
      GpsLocationSchema.safeParse({ capturedAt, source: 'GPS' }).success,
      'koordinatsız GPS reddedilir',
    ).toBe(false);
  });

  it('MANUEL kaynağında neden zorunludur; koordinatsız geçerli', () => {
    expect(
      GpsLocationSchema.safeParse({ capturedAt, source: 'MANUAL' }).success,
      'neden yok → red',
    ).toBe(false);
    const manual = GpsLocationSchema.safeParse({
      capturedAt,
      source: 'MANUAL',
      manualReason: 'Konum izni reddedildi',
    });
    expect(manual.success).toBe(true);
  });

  it('enlem/boylam ve doğruluk sınırları uygulanır', () => {
    expect(
      GpsLocationSchema.safeParse({
        latitude: 91,
        longitude: 0,
        capturedAt,
        source: 'GPS',
      }).success,
    ).toBe(false);
    expect(
      GpsLocationSchema.safeParse({
        latitude: 0,
        longitude: -181,
        capturedAt,
        source: 'GPS',
      }).success,
    ).toBe(false);
    expect(
      GpsLocationSchema.safeParse({
        latitude: 0,
        longitude: 0,
        accuracyMeters: 20_001,
        capturedAt,
        source: 'GPS',
      }).success,
    ).toBe(false);
  });
});

describe('TransitionWorkOrderRequestSchema — Faz 08 GPS kapısı', () => {
  it('ON_SITE hedefi konum olmadan reddedilir', () => {
    const result = TransitionWorkOrderRequestSchema.safeParse({ to: 'ON_SITE' });
    expect(result.success).toBe(false);
  });

  it('ON_SITE hedefi manuel onay + nedenle kabul edilir', () => {
    const result = TransitionWorkOrderRequestSchema.safeParse({
      to: 'ON_SITE',
      location: {
        capturedAt: '2026-11-10T09:30:00.000Z',
        source: 'MANUAL',
        manualReason: 'Konum izni reddedildi',
      },
    });
    expect(result.success).toBe(true);
  });

  it('ON_SITE dışındaki hedeflerde konum opsiyoneldir', () => {
    expect(TransitionWorkOrderRequestSchema.safeParse({ to: 'EN_ROUTE' }).success).toBe(true);
    expect(TransitionWorkOrderRequestSchema.safeParse({ to: 'IN_PROGRESS' }).success).toBe(true);
  });
});

describe('CreateChecklistItemRequestSchema', () => {
  it('etiket 2..200 karakter; required varsayılan true', () => {
    const parsed = CreateChecklistItemRequestSchema.parse({ label: 'Emniyet kilidi testi' });
    expect(parsed.required).toBe(true);
    expect(CreateChecklistItemRequestSchema.safeParse({ label: 'a' }).success).toBe(false);
    expect(CreateChecklistItemRequestSchema.safeParse({ label: 'x'.repeat(201) }).success).toBe(
      false,
    );
  });
});

describe('CompleteChecklistItemRequestSchema', () => {
  it('done zorunlu boolean; not opsiyonel', () => {
    expect(CompleteChecklistItemRequestSchema.safeParse({ done: true }).success).toBe(true);
    expect(CompleteChecklistItemRequestSchema.safeParse({ note: 'x' }).success).toBe(false);
    expect(
      CompleteChecklistItemRequestSchema.safeParse({ done: true, note: 'x'.repeat(1001) }).success,
    ).toBe(false);
  });
});

describe('CreateTimeEntryRequestSchema', () => {
  it('bitiş başlangıçtan sonra olmalı', () => {
    const startedAt = '2026-11-10T09:00:00.000Z';
    expect(
      CreateTimeEntryRequestSchema.safeParse({
        type: 'LABOR',
        startedAt,
        endedAt: '2026-11-10T10:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      CreateTimeEntryRequestSchema.safeParse({
        type: 'LABOR',
        startedAt,
        endedAt: startedAt,
      }).success,
      'eşit zaman reddedilir',
    ).toBe(false);
  });

  it('tür katalog dışı reddedilir', () => {
    expect(
      CreateTimeEntryRequestSchema.safeParse({
        type: 'BREAK',
        startedAt: '2026-11-10T09:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('StopTimeEntryRequestSchema', () => {
  it('endedAt zorunlu ISO tarih-saat', () => {
    expect(
      StopTimeEntryRequestSchema.safeParse({ endedAt: '2026-11-10T10:00:00.000Z' }).success,
    ).toBe(true);
    expect(StopTimeEntryRequestSchema.safeParse({ endedAt: '10:00' }).success).toBe(false);
  });
});

describe('InitMediaUploadRequestSchema', () => {
  it('dosya adı yol bileşeni içeremez (path traversal engeli)', () => {
    for (const fileName of ['../../etc/passwd', 'a/b.jpg', 'a\\b.jpg']) {
      expect(
        InitMediaUploadRequestSchema.safeParse({
          kind: 'PHOTO',
          fileName,
          contentType: 'image/jpeg',
          sizeBytes: 1024,
        }).success,
        `reddedilmeliydi: ${fileName}`,
      ).toBe(false);
    }
    expect(
      InitMediaUploadRequestSchema.safeParse({
        kind: 'PHOTO',
        fileName: 'kompresor-arizasi.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 1024,
      }).success,
    ).toBe(true);
  });

  it('medya üst limitleri kural tablosunda tutarlı', () => {
    expect(MEDIA_RULES.PHOTO.maxBytes).toBeLessThan(MEDIA_RULES.VIDEO.maxBytes);
    expect(MEDIA_RULES.DOCUMENT.maxBytes).toBeLessThan(MEDIA_RULES.VIDEO.maxBytes);
    expect(MEDIA_RULES.PHOTO.mimes).toContain('image/jpeg');
    expect(MEDIA_RULES.PHOTO.mimes).not.toContain('image/svg+xml');
  });
});

describe('CaptureSignatureRequestSchema', () => {
  const point = (x: number, y: number, t: number) => ({ x, y, t });

  it('geçerli imza kabul edilir', () => {
    const result = CaptureSignatureRequestSchema.safeParse({
      role: 'CUSTOMER',
      signerName: 'Ayşe Yılmaz',
      signedAt: '2026-11-10T12:00:00.000Z',
      strokes: [
        [point(0.1, 0.2, 0), point(0.2, 0.25, 40), point(0.3, 0.3, 80), point(0.4, 0.32, 120)],
      ],
    });
    expect(result.success).toBe(true);
  });

  it('tek noktalı stroke reddedilir; toplam nokta alt sınırı uygulanır', () => {
    expect(
      CaptureSignatureRequestSchema.safeParse({
        role: 'CUSTOMER',
        signerName: 'Ayşe Yılmaz',
        signedAt: '2026-11-10T12:00:00.000Z',
        strokes: [[point(0.1, 0.2, 0)]],
      }).success,
    ).toBe(false);
  });

  it('boş imza reddedilir (strokes >= 1)', () => {
    expect(
      CaptureSignatureRequestSchema.safeParse({
        role: 'CUSTOMER',
        signerName: 'Ayşe Yılmaz',
        signedAt: '2026-11-10T12:00:00.000Z',
        strokes: [],
      }).success,
    ).toBe(false);
  });

  it('nokta koordinatları 0..1 normalize; dışı reddedilir', () => {
    expect(
      CaptureSignatureRequestSchema.safeParse({
        role: 'TECHNICIAN',
        signerName: 'Mehmet Demir',
        signedAt: '2026-11-10T12:00:00.000Z',
        strokes: [[point(1.2, 0.2, 0), point(0.2, 0.25, 40)]],
      }).success,
    ).toBe(false);
  });
});
