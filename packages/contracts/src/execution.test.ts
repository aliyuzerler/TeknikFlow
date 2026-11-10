import { describe, expect, it } from 'vitest';
import { TransitionWorkOrderRequestSchema } from './service.js';
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_RULES,
  AttachmentInitSchema,
  ChecklistItemCreateSchema,
  ChecklistResponsesUpdateSchema,
  IdempotencyKeySchema,
  LaborEntryCreateSchema,
  OutboxEnvelopeSchema,
  SignatureCaptureSchema,
} from './execution.js';

/**
 * TEST-08 §2 — Faz 08 sözleşme doğrulama sınırları.
 *
 * GPS doğruluk/neden kuralları (izin reddi fallback'i), checklist madde
 * tipi kuralları, işçilik süre sınırları, medya MIME/boyut kuralları,
 * imza append-only/düzeltme kısıtları ve idempotency anahtar deseni.
 */

const validGps = {
  latitude: 41.0082,
  longitude: 28.9784,
  accuracyMeters: 12.5,
  capturedAt: '2026-11-10T09:30:00.000Z',
  source: 'GPS',
};

describe('GpsLocationSchema (geçiş gövdesi içinde)', () => {
  it('GPS kaynağında doğruluk zorunlu — doğru kayıt kabul', () => {
    const parsed = TransitionWorkOrderRequestSchema.safeParse({
      to: 'ON_SITE',
      location: validGps,
    });
    expect(parsed.success).toBe(true);
  });

  it('GPS doğruluksuz reddedilir (accuracy metadata kabul kriteri)', () => {
    const { accuracyMeters: _omit, ...withoutAccuracy } = validGps;
    const parsed = TransitionWorkOrderRequestSchema.safeParse({
      to: 'ON_SITE',
      location: withoutAccuracy,
    });
    expect(parsed.success).toBe(false);
  });

  it('MANUEL kaynakta neden zorunlu (izin reddi fallback)', () => {
    const manualNoReason = {
      latitude: 41.0,
      longitude: 29.0,
      capturedAt: '2026-11-10T09:30:00.000Z',
      source: 'MANUAL',
    };
    expect(
      TransitionWorkOrderRequestSchema.safeParse({ to: 'ON_SITE', location: manualNoReason })
        .success,
    ).toBe(false);

    const manual = { ...manualNoReason, manualReason: 'GPS izni verilmedi' };
    expect(
      TransitionWorkOrderRequestSchema.safeParse({ to: 'ON_SITE', location: manual }).success,
    ).toBe(true);
  });

  it('konum yalnız varış ve tamamlama geçişlerinde kabul edilir', () => {
    for (const to of ['EN_ROUTE', 'IN_PROGRESS', 'ACCEPTED', 'CLOSED'] as const) {
      const parsed = TransitionWorkOrderRequestSchema.safeParse({ to, location: validGps });
      expect(parsed.success).toBe(false);
    }
    expect(
      TransitionWorkOrderRequestSchema.safeParse({ to: 'COMPLETED', location: validGps }).success,
    ).toBe(true);
  });

  it('enlem/boylam ve doğruluk sınırları uygulanır', () => {
    expect(
      TransitionWorkOrderRequestSchema.safeParse({
        to: 'ON_SITE',
        location: { ...validGps, latitude: 91 },
      }).success,
    ).toBe(false);
    expect(
      TransitionWorkOrderRequestSchema.safeParse({
        to: 'ON_SITE',
        location: { ...validGps, longitude: -181 },
      }).success,
    ).toBe(false);
    expect(
      TransitionWorkOrderRequestSchema.safeParse({
        to: 'ON_SITE',
        location: { ...validGps, accuracyMeters: 20_000 },
      }).success,
    ).toBe(false);
  });

  it('konumsuz geçiş geçerli kalır (geriye dönük uyumluluk)', () => {
    expect(TransitionWorkOrderRequestSchema.safeParse({ to: 'ON_SITE' }).success).toBe(true);
    expect(
      TransitionWorkOrderRequestSchema.safeParse({
        to: 'ASSIGNED',
        assigneeUserId: crypto.randomUUID(),
      }).success,
    ).toBe(true);
  });
});

describe('ChecklistItemCreateSchema', () => {
  it('seçim tiplerinde options zorunlu (≥2)', () => {
    expect(
      ChecklistItemCreateSchema.safeParse({ label: 'Kontrol', responseType: 'SINGLE_SELECT' })
        .success,
    ).toBe(false);
    expect(
      ChecklistItemCreateSchema.safeParse({
        label: 'Kontrol',
        responseType: 'SINGLE_SELECT',
        options: ['Tamam'],
      }).success,
    ).toBe(false);
    expect(
      ChecklistItemCreateSchema.safeParse({
        label: 'Kontrol',
        responseType: 'SINGLE_SELECT',
        options: ['Tamam', 'Arızalı'],
      }).success,
    ).toBe(true);
  });

  it('seçim dışı tipte options reddedilir', () => {
    expect(
      ChecklistItemCreateSchema.safeParse({
        label: 'Basınç değeri',
        responseType: 'NUMBER',
        options: ['1'],
      }).success,
    ).toBe(false);
    expect(
      ChecklistItemCreateSchema.safeParse({ label: 'Basınç değeri', responseType: 'NUMBER' })
        .success,
    ).toBe(true);
  });

  it('required varsayılan false; boş etiket reddedilir', () => {
    const parsed = ChecklistItemCreateSchema.parse({
      label: 'Fiş kontrol',
      responseType: 'BOOLEAN',
    });
    expect(parsed.required).toBe(false);
    expect(
      ChecklistItemCreateSchema.safeParse({ label: '', responseType: 'BOOLEAN' }).success,
    ).toBe(false);
  });
});

describe('ChecklistResponsesUpdateSchema', () => {
  it('boş dizi ve 100+ yanıt reddedilir', () => {
    expect(ChecklistResponsesUpdateSchema.safeParse({ responses: [] }).success).toBe(false);
    expect(
      ChecklistResponsesUpdateSchema.safeParse({
        responses: Array.from({ length: 101 }, () => ({
          checklistItemId: crypto.randomUUID(),
          value: true,
        })),
      }).success,
    ).toBe(false);
  });

  it('null yanıtı (temizleme) kabul edilir', () => {
    expect(
      ChecklistResponsesUpdateSchema.safeParse({
        responses: [{ checklistItemId: crypto.randomUUID(), value: null }],
      }).success,
    ).toBe(true);
  });
});

describe('LaborEntryCreateSchema', () => {
  it('ters ve eşit zaman aralığı reddedilir', () => {
    expect(
      LaborEntryCreateSchema.safeParse({
        startedAt: '2026-11-10T10:00:00.000Z',
        endedAt: '2026-11-10T09:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      LaborEntryCreateSchema.safeParse({
        startedAt: '2026-11-10T10:00:00.000Z',
        endedAt: '2026-11-10T10:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('24 saatten uzun tek kayıt reddedilir', () => {
    expect(
      LaborEntryCreateSchema.safeParse({
        startedAt: '2026-11-10T10:00:00.000Z',
        endedAt: '2026-11-11T10:00:01.000Z',
      }).success,
    ).toBe(false);
    expect(
      LaborEntryCreateSchema.safeParse({
        startedAt: '2026-11-10T10:00:00.000Z',
        endedAt: '2026-11-11T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});

describe('AttachmentInitSchema', () => {
  it('tür-kural uyumu: PHOTO için video MIME reddedilir', () => {
    expect(
      AttachmentInitSchema.safeParse({
        kind: 'PHOTO',
        fileName: 'kayit.mp4',
        contentType: 'video/mp4',
        sizeBytes: 1024,
      }).success,
    ).toBe(false);
  });

  it('boyut sınırı aşımı reddedilir (DOCUMENT > 25MB)', () => {
    expect(
      AttachmentInitSchema.safeParse({
        kind: 'DOCUMENT',
        fileName: 'rapor.pdf',
        contentType: 'application/pdf',
        sizeBytes: 25 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
    expect(
      AttachmentInitSchema.safeParse({
        kind: 'DOCUMENT',
        fileName: 'rapor.pdf',
        contentType: 'application/pdf',
        sizeBytes: 25 * 1024 * 1024,
      }).success,
    ).toBe(true);
  });

  it('geçerli fotoğraf init kabul edilir; boyut sıfır reddedilir', () => {
    expect(
      AttachmentInitSchema.safeParse({
        kind: 'PHOTO',
        fileName: 'pano.jpeg',
        contentType: 'image/jpeg',
        sizeBytes: 2048,
      }).success,
    ).toBe(true);
    expect(
      AttachmentInitSchema.safeParse({
        kind: 'PHOTO',
        fileName: 'pano.jpeg',
        contentType: 'image/jpeg',
        sizeBytes: 0,
      }).success,
    ).toBe(false);
  });

  it('ATTACHMENT_RULES her tür için dolu ve pozitif', () => {
    for (const kind of ATTACHMENT_KINDS) {
      const rules = ATTACHMENT_RULES[kind];
      expect(rules.contentTypes.length).toBeGreaterThan(0);
      expect(rules.maxBytes).toBeGreaterThan(0);
    }
    expect(ATTACHMENT_RULES.PHOTO.contentTypes).toContain('image/jpeg');
    expect(ATTACHMENT_RULES.DOCUMENT.contentTypes).toEqual(['application/pdf']);
  });
});

describe('SignatureCaptureSchema', () => {
  const validStrokes = [
    [
      { x: 10, y: 20 },
      { x: 30, y: 22 },
    ],
  ];

  it('geçerli müşteri imzası kabul edilir', () => {
    expect(
      SignatureCaptureSchema.safeParse({
        signedBy: 'CUSTOMER',
        signerName: 'Deniz Aydın',
        strokes: validStrokes,
        capturedAt: '2026-11-10T11:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('tek noktalı stroke ve boş stroke seti reddedilir', () => {
    expect(
      SignatureCaptureSchema.safeParse({
        signedBy: 'CUSTOMER',
        signerName: 'Deniz Aydın',
        strokes: [[{ x: 1, y: 1 }]],
        capturedAt: '2026-11-10T11:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      SignatureCaptureSchema.safeParse({
        signedBy: 'CUSTOMER',
        signerName: 'Deniz Aydın',
        strokes: [],
        capturedAt: '2026-11-10T11:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('düzeltme imzası yalnız müşteri imzalarında geçerli', () => {
    expect(
      SignatureCaptureSchema.safeParse({
        signedBy: 'TECHNICIAN',
        signerName: 'Mert Kaya',
        strokes: validStrokes,
        capturedAt: '2026-11-10T11:00:00.000Z',
        correctionOfSignatureId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      SignatureCaptureSchema.safeParse({
        signedBy: 'CUSTOMER',
        signerName: 'Deniz Aydın',
        strokes: validStrokes,
        capturedAt: '2026-11-10T11:00:00.000Z',
        correctionOfSignatureId: crypto.randomUUID(),
      }).success,
    ).toBe(true);
  });

  it('nokta koordinatları 0..4000 aralığı dışında reddedilir', () => {
    expect(
      SignatureCaptureSchema.safeParse({
        signedBy: 'CUSTOMER',
        signerName: 'Deniz Aydın',
        strokes: [
          [
            { x: -1, y: 10 },
            { x: 5, y: 10 },
          ],
        ],
        capturedAt: '2026-11-10T11:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('IdempotencyKeySchema / OutboxEnvelopeSchema', () => {
  it('anahtar deseni: 8-128 karakter izinli alfabe', () => {
    expect(IdempotencyKeySchema.safeParse('abc').success).toBe(false);
    expect(IdempotencyKeySchema.safeParse('kısa-anahtar!').success).toBe(false);
    expect(IdempotencyKeySchema.safeParse('op-1234-abcd').success).toBe(true);
    expect(IdempotencyKeySchema.safeParse(crypto.randomUUID()).success).toBe(true);
  });

  it('outbox zarfı: bilinen operasyon + uuid iş emri', () => {
    expect(
      OutboxEnvelopeSchema.safeParse({
        operation: 'work_order.signature',
        workOrderId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        payload: {},
      }).success,
    ).toBe(true);
    expect(
      OutboxEnvelopeSchema.safeParse({
        operation: 'work_order.unknown',
        workOrderId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        payload: {},
      }).success,
    ).toBe(false);
  });
});
