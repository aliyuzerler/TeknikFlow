import { describe, expect, it } from 'vitest';
import {
  CreateSkillRequestSchema,
  ScheduleWorkOrderRequestSchema,
  SetUserSkillRequestSchema,
  TechnicianProfileUpsertRequestSchema,
  TimeOffCreateSchema,
  WorkingHourWindowSchema,
  WorkingHoursUpsertRequestSchema,
} from './dispatch.js';

/**
 * TEST-06 §2 — Faz 06 sözleşme doğrulama sınırları.
 *
 * Pencere dakikaları, izin aralığı, override neden uzunluğu ve yetenek
 * seviyesi sınırları; çakışan aynı-gün pencerelerinin reddi.
 */

describe('WorkingHourWindowSchema', () => {
  it('geçerli pencere kabul edilir (Pzt 09:00-18:00)', () => {
    expect(
      WorkingHourWindowSchema.parse({ weekday: 1, startMinute: 540, endMinute: 1080 }),
    ).toEqual({ weekday: 1, startMinute: 540, endMinute: 1080 });
  });

  it('hafta içi 1..7 dışı reddedilir', () => {
    expect(
      WorkingHourWindowSchema.safeParse({ weekday: 0, startMinute: 0, endMinute: 60 }).success,
    ).toBe(false);
    expect(
      WorkingHourWindowSchema.safeParse({ weekday: 8, startMinute: 0, endMinute: 60 }).success,
    ).toBe(false);
  });

  it('bitiş başlangıçtan büyük olmalı; gün sınırı 1440', () => {
    expect(
      WorkingHourWindowSchema.safeParse({ weekday: 3, startMinute: 600, endMinute: 600 }).success,
    ).toBe(false);
    expect(
      WorkingHourWindowSchema.safeParse({ weekday: 3, startMinute: 1440, endMinute: 1440 }).success,
    ).toBe(false);
  });
});

describe('WorkingHoursUpsertRequestSchema', () => {
  it('aynı günde üst üste binen pencereler reddedilir', () => {
    expect(
      WorkingHoursUpsertRequestSchema.safeParse({
        hours: [
          { weekday: 1, startMinute: 540, endMinute: 780 },
          { weekday: 1, startMinute: 720, endMinute: 1080 }, // 12:00'dan başlıyor — örtüşür
        ],
      }).success,
    ).toBe(false);
  });

  it('ayrık iki pencere (öğlen arası) kabul edilir', () => {
    expect(
      WorkingHoursUpsertRequestSchema.safeParse({
        hours: [
          { weekday: 1, startMinute: 540, endMinute: 780 },
          { weekday: 1, startMinute: 840, endMinute: 1080 },
        ],
      }).success,
    ).toBe(true);
  });

  it('farklı günlerde örtüşen saatler serbesttir', () => {
    expect(
      WorkingHoursUpsertRequestSchema.safeParse({
        hours: [
          { weekday: 1, startMinute: 540, endMinute: 1080 },
          { weekday: 2, startMinute: 540, endMinute: 1080 },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('TimeOffCreateSchema', () => {
  it('bitiş başlangıçtan sonra olmalı', () => {
    expect(
      TimeOffCreateSchema.safeParse({
        startAt: '2026-11-16T06:00:00.000Z',
        endAt: '2026-11-16T05:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('ScheduleWorkOrderRequestSchema', () => {
  const base = {
    assigneeUserId: '00000000-0000-4000-8000-000000000001',
    scheduledStart: '2026-11-16T06:00:00.000Z',
    scheduledEnd: '2026-11-16T10:00:00.000Z',
  };

  it('geçerli planlama kabul edilir', () => {
    expect(ScheduleWorkOrderRequestSchema.parse(base)).toMatchObject({
      scheduledStart: '2026-11-16T06:00:00.000Z',
    });
  });

  it('bitiş başlangıçtan önce reddedilir', () => {
    expect(
      ScheduleWorkOrderRequestSchema.safeParse({
        ...base,
        scheduledEnd: '2026-11-16T05:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('override için ≥10 karakter neden zorunlu', () => {
    expect(
      ScheduleWorkOrderRequestSchema.safeParse({ ...base, overrideConflict: true }).success,
    ).toBe(false);
    expect(
      ScheduleWorkOrderRequestSchema.safeParse({
        ...base,
        overrideConflict: true,
        overrideReason: 'kısa',
      }).success,
    ).toBe(false);
    expect(
      ScheduleWorkOrderRequestSchema.safeParse({
        ...base,
        overrideConflict: true,
        overrideReason: 'Müşteri acil talebi üzerine',
      }).success,
    ).toBe(true);
  });
});

describe('CreateSkillRequestSchema / SetUserSkillRequestSchema', () => {
  it('anahtar normalize edilir: büyük harf → küçük harf; boşluk/alt çizgi reddi', () => {
    // 'Hvac' toLowerCase dönüşümüyle 'hvac' olarak kabul edilir (normalizasyon).
    const normalized = CreateSkillRequestSchema.parse({ key: 'Hvac', name: 'İklim' });
    expect(normalized.key).toBe('hvac');
    expect(CreateSkillRequestSchema.safeParse({ key: 'hvac 2', name: 'İklim' }).success).toBe(
      false,
    );
    expect(CreateSkillRequestSchema.safeParse({ key: 'hvac_2', name: 'İklim' }).success).toBe(
      false,
    );
    expect(CreateSkillRequestSchema.safeParse({ key: 'hvac-2', name: 'İklim' }).success).toBe(true);
  });

  it('seviye 1..5 dışı reddedilir', () => {
    expect(
      SetUserSkillRequestSchema.safeParse({
        skillId: '00000000-0000-4000-8000-000000000002',
        level: 0,
      }).success,
    ).toBe(false);
    expect(
      SetUserSkillRequestSchema.safeParse({
        skillId: '00000000-0000-4000-8000-000000000002',
        level: 6,
      }).success,
    ).toBe(false);
    expect(
      SetUserSkillRequestSchema.safeParse({
        skillId: '00000000-0000-4000-8000-000000000002',
        level: 5,
      }).success,
    ).toBe(true);
  });
});

describe('TechnicianProfileUpsertRequestSchema', () => {
  it('günlük kapasite 30..1440 dakika', () => {
    expect(
      TechnicianProfileUpsertRequestSchema.safeParse({ dailyCapacityMinutes: 10 }).success,
    ).toBe(false);
    expect(
      TechnicianProfileUpsertRequestSchema.safeParse({ dailyCapacityMinutes: 1440 }).success,
    ).toBe(true);
  });
});
