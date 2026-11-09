import { describe, expect, it } from 'vitest';
import {
  minutesOfDay,
  shiftDate,
  startOfWeek,
  tenantWallClockToUtc,
  utcToTenantWallClock,
} from './dispatch-time';

/**
 * TEST-06 — dispatch zaman yardımcıları: saat dilimi doğruluğu.
 * İstanbul sabit UTC+3; Berlin DST sınırları ayrıca doğrulanır.
 */

describe('tenantWallClockToUtc', () => {
  it('Istanbul duvar saati 09:30 → 06:30 UTC', () => {
    expect(tenantWallClockToUtc('2026-11-09', '09:30', 'Europe/Istanbul')).toBe(
      '2026-11-09T06:30:00.000Z',
    );
  });

  it('Berlin yaz saati ileri alması günü SONRASI doğru ofletle çözülür', () => {
    // 2026-03-30 (Pazartesi, CEST): 09:00 yerel = 07:00 UTC.
    expect(tenantWallClockToUtc('2026-03-30', '09:00', 'Europe/Berlin')).toBe(
      '2026-03-30T07:00:00.000Z',
    );
    // 2026-03-27 (Cuma, CET): 09:00 yerel = 08:00 UTC.
    expect(tenantWallClockToUtc('2026-03-27', '09:00', 'Europe/Berlin')).toBe(
      '2026-03-27T08:00:00.000Z',
    );
  });

  it('geçersiz girdi null döner (boş form alanı)', () => {
    expect(tenantWallClockToUtc('', '09:00', 'Europe/Istanbul')).toBeNull();
    expect(tenantWallClockToUtc('2026-11-09', '', 'Europe/Istanbul')).toBeNull();
    expect(tenantWallClockToUtc('09-11-2026', '09:00', 'Europe/Istanbul')).toBeNull();
  });
});

describe('utcToTenantWallClock', () => {
  it('UTC 06:30 → İstanbul 09:30 (form ön doldurma)', () => {
    expect(utcToTenantWallClock('2026-11-09T06:30:00.000Z', 'Europe/Istanbul')).toEqual({
      date: '2026-11-09',
      time: '09:30',
    });
  });

  it('UTC 22:00 → İstanbul ertesi gün 01:00', () => {
    expect(utcToTenantWallClock('2026-11-09T22:00:00.000Z', 'Europe/Istanbul')).toEqual({
      date: '2026-11-10',
      time: '01:00',
    });
  });

  it('geçersiz ISO null', () => {
    expect(utcToTenantWallClock('not-a-date', 'Europe/Istanbul')).toBeNull();
  });
});

describe('shiftDate / startOfWeek', () => {
  it('gün kaydırma ay sonu doğru', () => {
    expect(shiftDate('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('haftanın başı Pazartesi', () => {
    // 2026-11-11 Çarşamba → 2026-11-09 Pazartesi.
    expect(startOfWeek('2026-11-11')).toBe('2026-11-09');
    // 2026-11-15 Pazar → aynı haftanın Pazartesisi.
    expect(startOfWeek('2026-11-15')).toBe('2026-11-09');
  });
});

describe('minutesOfDay', () => {
  it('saat:dakika → dakika', () => {
    expect(minutesOfDay('09:30')).toBe(570);
    expect(minutesOfDay('00:00')).toBe(0);
  });
});
