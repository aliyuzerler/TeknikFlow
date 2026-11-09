import { describe, expect, it } from 'vitest';
import {
  ConvertServiceRequestRequestSchema,
  CreateServiceRequestRequestSchema,
  CreateWorkOrderRequestSchema,
  TransitionWorkOrderRequestSchema,
  UpdateWorkOrderRequestSchema,
  UpsertSlaPolicyRequestSchema,
  WorkOrderNoteCreateSchema,
} from '@teknikflow/contracts';

/**
 * Faz 05 sözleşme doğrulamaları — API sınırındaki ilk savunma.
 * Sınır değerleri: boş/uzun metin, geçersiz enum, schedule sırası,
 * eyleme özgü zorunlu parametreler (atama/iptal).
 */

const UUID = 'a41dffca-ec44-4da4-a56f-5b585018c071';

describe('servis talebi şemaları', () => {
  it('geçerli talep varsayılanlarıyla: source=OFFICE, priority=MEDIUM', () => {
    const parsed = CreateServiceRequestRequestSchema.parse({
      customerId: UUID,
      subject: 'Klima çalışmıyor',
    });
    expect(parsed.source).toBe('OFFICE');
    expect(parsed.priority).toBe('MEDIUM');
  });

  it('kısa konu ve aşırı uzun açıklama reddedilir (sınır değerleri)', () => {
    expect(
      CreateServiceRequestRequestSchema.safeParse({ customerId: UUID, subject: 'abc' }).success,
    ).toBe(false);
    expect(
      CreateServiceRequestRequestSchema.safeParse({
        customerId: UUID,
        subject: 'x'.repeat(201),
      }).success,
    ).toBe(false);
    expect(
      CreateServiceRequestRequestSchema.safeParse({
        customerId: UUID,
        subject: 'Klima arızası',
        description: 'x'.repeat(5001),
      }).success,
    ).toBe(false);
  });

  it('geçersiz kaynak/öncelik reddedilir', () => {
    expect(
      CreateServiceRequestRequestSchema.safeParse({
        customerId: UUID,
        subject: 'Klima arızası',
        source: 'SMS',
      }).success,
    ).toBe(false);
    expect(
      CreateServiceRequestRequestSchema.safeParse({
        customerId: UUID,
        subject: 'Klima arızası',
        priority: 'CRITICAL',
      }).success,
    ).toBe(false);
  });

  it('SLA politikası: 15 dakika altı ve 30 gün üstü reddedilir', () => {
    expect(
      UpsertSlaPolicyRequestSchema.safeParse({ priority: 'HIGH', resolveMinutes: 14 }).success,
    ).toBe(false);
    expect(
      UpsertSlaPolicyRequestSchema.safeParse({ priority: 'HIGH', resolveMinutes: 60 * 24 * 31 })
        .success,
    ).toBe(false);
    expect(
      UpsertSlaPolicyRequestSchema.safeParse({ priority: 'HIGH', resolveMinutes: 480 }).success,
    ).toBe(true);
  });
});

describe('iş emri oluşturma şeması', () => {
  it('schedule sırası ters reddedilir (bitiş ≤ başlangıç)', () => {
    expect(
      CreateWorkOrderRequestSchema.safeParse({
        customerId: UUID,
        subject: 'Bakım',
        scheduledStart: '2026-11-10T13:00:00.000Z',
        scheduledEnd: '2026-11-10T09:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      CreateWorkOrderRequestSchema.safeParse({
        customerId: UUID,
        subject: 'Bakım',
        scheduledStart: '2026-11-10T09:00:00.000Z',
        scheduledEnd: '2026-11-10T13:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('tarih ISO 8601 olmalı; lokalsaat dizisi reddedilir', () => {
    expect(
      CreateWorkOrderRequestSchema.safeParse({
        customerId: UUID,
        subject: 'Bakım',
        scheduledStart: '10.11.2026 09:00',
      }).success,
    ).toBe(false);
  });
});

describe('geçiş isteği şeması (eyleme özgü zorunlular)', () => {
  it('ASSIGNED hedefi assigneeUserId zorunlu', () => {
    const result = TransitionWorkOrderRequestSchema.safeParse({ to: 'ASSIGNED' });
    expect(result.success).toBe(false);
    expect(
      TransitionWorkOrderRequestSchema.safeParse({ to: 'ASSIGNED', assigneeUserId: UUID }).success,
    ).toBe(true);
  });

  it('CANCELLED hedefi reasonCode zorunlu', () => {
    expect(TransitionWorkOrderRequestSchema.safeParse({ to: 'CANCELLED' }).success).toBe(false);
    expect(
      TransitionWorkOrderRequestSchema.safeParse({ to: 'CANCELLED', reasonCode: 'DUPLICATE' })
        .success,
    ).toBe(true);
  });

  it('terminal olmayan hedefler ek parametre istemez; expectedVersion opsiyonel', () => {
    const parsed = TransitionWorkOrderRequestSchema.parse({
      to: 'IN_PROGRESS',
      expectedVersion: 7,
    });
    expect(parsed.expectedVersion).toBe(7);
    expect(TransitionWorkOrderRequestSchema.safeParse({ to: 'ACCEPTED' }).success).toBe(true);
  });

  it('PLAN için schedule sırası doğrulanır', () => {
    expect(
      TransitionWorkOrderRequestSchema.safeParse({
        to: 'PLANNED',
        scheduledStart: '2026-11-10T13:00:00.000Z',
        scheduledEnd: '2026-11-10T09:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('güncelleme (iyimser eşzamanlılık) şeması', () => {
  it('expectedVersion zorunlu ve negatif reddedilir', () => {
    expect(UpdateWorkOrderRequestSchema.safeParse({ subject: 'Yeni konu' }).success).toBe(false);
    expect(
      UpdateWorkOrderRequestSchema.safeParse({ subject: 'Yeni konu', expectedVersion: -1 }).success,
    ).toBe(false);
    expect(
      UpdateWorkOrderRequestSchema.safeParse({ subject: 'Yeni konu', expectedVersion: 3 }).success,
    ).toBe(true);
  });
});

describe('not şeması', () => {
  it('görünürlük varsayılanı INTERNAL; boş gövde reddedilir', () => {
    const parsed = WorkOrderNoteCreateSchema.parse({ body: 'Parça sipariş edildi' });
    expect(parsed.visibility).toBe('INTERNAL');
    expect(WorkOrderNoteCreateSchema.safeParse({ body: '' }).success).toBe(false);
    expect(WorkOrderNoteCreateSchema.safeParse({ body: 'x'.repeat(2001) }).success).toBe(false);
    expect(
      WorkOrderNoteCreateSchema.safeParse({ body: 'Müşteriye görünür', visibility: 'CUSTOMER' })
        .success,
    ).toBe(true);
  });
});

describe('dönüşüm isteği şeması', () => {
  it('varsayılan tip CORRECTIVE', () => {
    const parsed = ConvertServiceRequestRequestSchema.parse({});
    expect(parsed.type).toBe('CORRECTIVE');
  });
});
