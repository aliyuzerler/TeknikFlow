import { describe, expect, it } from 'vitest';
import {
  SLA_AT_RISK_MINUTES,
  capacitySummary,
  findScheduleConflicts,
  freeSlotsForDay,
  isoWeekdayOf,
  localDateOf,
  localDayBoundsUtc,
  localDatesTouched,
  matchSkills,
  slaState,
  subtractWindows,
  tzOffsetMs,
  wallClockToUtc,
  windowsOverlap,
  workingWindowsForLocalDate,
  type UtcWindow,
} from './dispatch-engine.js';

/**
 * TEST-06 — dispatch motoru birim testleri.
 *
 * Kabul ölçütleri: çift rezervasyon tespiti (uçtan-uca bitişiklik hariç),
 * saat dilimi doğruluğu (Europe/Istanbul sabit UTC+3; Europe/Berlin DST
 * ileri/geri alma sınırları), kapasite, SLA ve yetenek eşleştirme.
 */

const ist = 'Europe/Istanbul';
const berlin = 'Europe/Berlin';

function windowOf(startIso: string, endIso: string): UtcWindow {
  return { start: new Date(startIso), end: new Date(endIso) };
}

// ------------------------- Saat dilimi çekirdeği -------------------------

describe('tzOffsetMs', () => {
  it('Istanbul kalıcı UTC+3 (DST yok)', () => {
    expect(tzOffsetMs(new Date('2026-01-15T12:00:00Z'), ist)).toBe(3 * 3600_000);
    expect(tzOffsetMs(new Date('2026-07-15T12:00:00Z'), ist)).toBe(3 * 3600_000);
  });

  it('Berlin kış CET (+1) / yaz CEST (+2)', () => {
    expect(tzOffsetMs(new Date('2026-01-15T12:00:00Z'), berlin)).toBe(3600_000);
    expect(tzOffsetMs(new Date('2026-07-15T12:00:00Z'), berlin)).toBe(2 * 3600_000);
  });
});

describe('wallClockToUtc', () => {
  it('Istanbul duvar saati 09:00 → 06:00 UTC', () => {
    const utc = wallClockToUtc({ year: 2026, month: 11, day: 9 }, 9 * 60, ist);
    expect(utc.toISOString()).toBe('2026-11-09T06:00:00.000Z');
  });

  it('Berlin yaz saati ileri alması (2026-03-29 02:00→03:00) SONRASI geçerli duvar saati doğru çözülür', () => {
    // 29 Mart 2026: 03:00'dan itibaren CEST. 09:00 yerel = 07:00 UTC.
    const utc = wallClockToUtc({ year: 2026, month: 3, day: 29 }, 9 * 60, berlin);
    expect(utc.toISOString()).toBe('2026-03-29T07:00:00.000Z');
    // ÖNCESI: 28 Mart 09:00 yerel = 08:00 UTC (CET).
    const before = wallClockToUtc({ year: 2026, month: 3, day: 28 }, 9 * 60, berlin);
    expect(before.toISOString()).toBe('2026-03-28T08:00:00.000Z');
  });

  it('Berlin geri alması (2026-10-25 03:00→02:00) gününde 09:00 yerel yalnız BİR kez çözülür (CET)', () => {
    // 25 Ekim 2026: 02:00'den itibaren CET. 09:00 yerel = 08:00 UTC.
    const utc = wallClockToUtc({ year: 2026, month: 10, day: 25 }, 9 * 60, berlin);
    expect(utc.toISOString()).toBe('2026-10-25T08:00:00.000Z');
  });
});

describe('localDayBoundsUtc', () => {
  it('Istanbul günü tam 24 saat', () => {
    const { start, end } = localDayBoundsUtc({ year: 2026, month: 11, day: 9 }, ist);
    expect(start.toISOString()).toBe('2026-11-08T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-09T21:00:00.000Z');
  });

  it('Berlin geri alma günü 25 saat (2026-10-25)', () => {
    const { start, end } = localDayBoundsUtc({ year: 2026, month: 10, day: 25 }, berlin);
    expect(start.toISOString()).toBe('2026-10-24T22:00:00.000Z'); // 00:00 CET
    expect(end.toISOString()).toBe('2026-10-25T23:00:00.000Z'); // sonraki 00:00 CET
    expect(end.getTime() - start.getTime()).toBe(25 * 3600_000);
  });

  it('Berlin ileri alma günü 23 saat (2026-03-29)', () => {
    const { start, end } = localDayBoundsUtc({ year: 2026, month: 3, day: 29 }, berlin);
    expect(end.getTime() - start.getTime()).toBe(23 * 3600_000);
  });
});

describe('isoWeekdayOf / localDateOf', () => {
  it('2026-11-09 Pazartesi (ISO 1)', () => {
    expect(isoWeekdayOf({ year: 2026, month: 11, day: 9 })).toBe(1);
    expect(isoWeekdayOf({ year: 2026, month: 11, day: 15 })).toBe(7); // Pazar
  });

  it('UTC anından yerel tarih türetimi', () => {
    // 2026-11-08T22:30Z İstanbul'da 2026-11-09 01:30.
    expect(localDateOf(new Date('2026-11-08T22:30:00Z'), ist)).toEqual({
      year: 2026,
      month: 11,
      day: 9,
    });
  });
});

describe('localDatesTouched', () => {
  it('Tek günlük pencere tek gün', () => {
    const dates = localDatesTouched(windowOf('2026-11-09T06:00:00Z', '2026-11-09T12:00:00Z'), ist);
    expect(dates).toEqual([{ year: 2026, month: 11, day: 9 }]);
  });

  it('Gece aşan pencere iki gün', () => {
    const dates = localDatesTouched(windowOf('2026-11-09T18:00:00Z', '2026-11-10T03:00:00Z'), ist);
    expect(dates.map((d) => d.day)).toEqual([9, 10]);
  });
});

describe('workingWindowsForLocalDate', () => {
  const rules = [{ weekday: 1, startMinute: 540, endMinute: 1080 }]; // Pzt 09:00-18:00

  it('Pazartesi kuralı İstanbul saat diliminde 06:00-15:00 UTC', () => {
    const windows = workingWindowsForLocalDate(rules, { year: 2026, month: 11, day: 9 }, ist);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.start.toISOString()).toBe('2026-11-09T06:00:00.000Z');
    expect(windows[0]!.end.toISOString()).toBe('2026-11-09T15:00:00.000Z');
  });

  it('Kural olmayan gün boş pencere', () => {
    expect(workingWindowsForLocalDate(rules, { year: 2026, month: 11, day: 10 }, ist)).toHaveLength(
      0,
    ); // Salı
  });

  it('Berlin DST gününde pencereler geçerli ofsetle üretilir', () => {
    // 2026-03-30 Pazartesi (CEST): 09:00-18:00 yerel → 07:00-16:00 UTC.
    const windows = workingWindowsForLocalDate(rules, { year: 2026, month: 3, day: 30 }, berlin);
    expect(windows[0]!.start.toISOString()).toBe('2026-03-30T07:00:00.000Z');
    expect(windows[0]!.end.toISOString()).toBe('2026-03-30T16:00:00.000Z');
  });
});

// ------------------------- Aralık işlemleri -------------------------

describe('windowsOverlap', () => {
  it('uçtan-uca bitişiklik çakışma DEĞİL', () => {
    expect(
      windowsOverlap(
        windowOf('2026-11-09T09:00:00Z', '2026-11-09T13:00:00Z'),
        windowOf('2026-11-09T13:00:00Z', '2026-11-09T17:00:00Z'),
      ),
    ).toBe(false);
  });

  it('gerçek örtüşme çakışma', () => {
    expect(
      windowsOverlap(
        windowOf('2026-11-09T09:00:00Z', '2026-11-09T13:00:00Z'),
        windowOf('2026-11-09T12:00:00Z', '2026-11-09T17:00:00Z'),
      ),
    ).toBe(true);
  });
});

describe('subtractWindows', () => {
  it('blok ortadaysa iki parça kalır', () => {
    const rest = subtractWindows(
      [windowOf('2026-11-09T06:00:00Z', '2026-11-09T15:00:00Z')],
      [windowOf('2026-11-09T09:00:00Z', '2026-11-09T11:00:00Z')],
    );
    expect(rest).toHaveLength(2);
    expect(rest[0]!.end.toISOString()).toBe('2026-11-09T09:00:00.000Z');
    expect(rest[1]!.start.toISOString()).toBe('2026-11-09T11:00:00.000Z');
  });

  it('tam kapsayan blok her şeyi götürür', () => {
    expect(
      subtractWindows(
        [windowOf('2026-11-09T06:00:00Z', '2026-11-09T10:00:00Z')],
        [windowOf('2026-11-09T05:00:00Z', '2026-11-09T11:00:00Z')],
      ),
    ).toHaveLength(0);
  });
});

// ------------------------- Çakışma tespiti -------------------------

describe('findScheduleConflicts', () => {
  const base = {
    window: windowOf('2026-11-09T06:00:00Z', '2026-11-09T10:00:00Z'),
    otherOrders: [],
    workingWindows: [],
    hasWorkingHours: false,
    timeOffs: [],
  };

  it('temiz pencere çakışma üretmez', () => {
    expect(findScheduleConflicts(base)).toEqual([]);
  });

  it('örtüşen başka iş → OVERLAP (çift rezervasyon)', () => {
    const conflicts = findScheduleConflicts({
      ...base,
      otherOrders: [
        {
          workOrderId: 'wo-1',
          workOrderNo: 'WO-2026-0001',
          start: new Date('2026-11-09T09:00:00Z'),
          end: new Date('2026-11-09T12:00:00Z'),
        },
      ],
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.type).toBe('OVERLAP');
    expect(conflicts[0]!.workOrderNo).toBe('WO-2026-0001');
  });

  it('bitişik başka iş OVERLAP üretmez (arka arkaya işler serbest)', () => {
    const conflicts = findScheduleConflicts({
      ...base,
      otherOrders: [
        {
          workOrderId: 'wo-1',
          workOrderNo: 'WO-2026-0001',
          start: new Date('2026-11-09T10:00:00Z'),
          end: new Date('2026-11-09T13:00:00Z'),
        },
      ],
    });
    expect(conflicts).toHaveLength(0);
  });

  it('izin örtüşmesi → TIME_OFF', () => {
    const conflicts = findScheduleConflicts({
      ...base,
      timeOffs: [
        {
          timeOffId: 'to-1',
          start: new Date('2026-11-09T00:00:00Z'),
          end: new Date('2026-11-09T23:59:00Z'),
          reason: 'Yıllık izin',
        },
      ],
    });
    expect(conflicts.map((c) => c.type)).toContain('TIME_OFF');
  });

  it('şablon VAR ve pencere dışarı taşıyor → OUTSIDE_WORKING_HOURS; kalan dakika raporlanır', () => {
    const conflicts = findScheduleConflicts({
      ...base,
      hasWorkingHours: true,
      workingWindows: [windowOf('2026-11-09T06:00:00Z', '2026-11-09T09:00:00Z')],
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.type).toBe('OUTSIDE_WORKING_HOURS');
    expect(conflicts[0]!.message).toContain('60 dakika');
  });

  it('şablon YOKSA saat kısıtı uygulanmaz (veri yoksa kısıt yok)', () => {
    const conflicts = findScheduleConflicts({
      ...base,
      hasWorkingHours: false,
      workingWindows: [],
    });
    expect(conflicts).toHaveLength(0);
  });

  it('gece aşan pencere + iki gün kuralları: kaplanmayan gün OUTSIDE üretir', () => {
    // Pazar günü kuralı yok; Cumartesi 08:00-12:00 yerel kuralı var.
    const conflicts = findScheduleConflicts({
      window: windowOf('2026-11-14T18:00:00Z', '2026-11-15T06:00:00Z'), // Cmt 21:00 → Pazar 09:00 İstanbul
      otherOrders: [],
      hasWorkingHours: true,
      workingWindows: [
        // Cumartesi 2026-11-14 kuralı 08:00-12:00 yerel = 05:00-09:00 UTC
        windowOf('2026-11-14T05:00:00Z', '2026-11-14T09:00:00Z'),
      ],
      timeOffs: [],
    });
    expect(conflicts.map((c) => c.type)).toEqual(['OUTSIDE_WORKING_HOURS']);
  });
});

// ------------------------- Kapasite -------------------------

describe('capacitySummary', () => {
  const dayBounds = windowOf('2026-11-09T06:00:00Z', '2026-11-09T21:00:00Z'); // İstanbul günü

  it('şablon yoksa üst sınır kapasite olur', () => {
    const result = capacitySummary({
      workingWindows: [],
      dailyCapacityMinutes: 480,
      scheduledWindows: [windowOf('2026-11-09T06:00:00Z', '2026-11-09T12:00:00Z')],
      dayBounds,
    });
    expect(result.capacityMinutes).toBe(480);
    expect(result.scheduledMinutes).toBe(360);
    expect(result.utilizationPct).toBe(75);
  });

  it('şablon dakikaları üst sınırı aşarsa kırpılır', () => {
    const result = capacitySummary({
      workingWindows: [windowOf('2026-11-09T06:00:00Z', '2026-11-09T15:00:00Z')], // 9 saat
      dailyCapacityMinutes: 480,
      scheduledWindows: [],
      dayBounds,
    });
    expect(result.capacityMinutes).toBe(480);
    expect(result.utilizationPct).toBe(0);
  });

  it('gün dışına taşan plan gün içi kesişimle sayılır', () => {
    const result = capacitySummary({
      workingWindows: [windowOf('2026-11-09T06:00:00Z', '2026-11-09T15:00:00Z')],
      dailyCapacityMinutes: 540,
      scheduledWindows: [
        windowOf('2026-11-09T13:00:00Z', '2026-11-10T03:00:00Z'), // 14 saatin 8'i gün içinde
      ],
      dayBounds,
    });
    expect(result.scheduledMinutes).toBe(480); // 13:00→21:00
    expect(result.utilizationPct).toBe(89); // 480/540
  });
});

// ------------------------- SLA -------------------------

describe('slaState', () => {
  const now = new Date('2026-11-09T12:00:00Z');

  it('terminal durumlarda SLA söner', () => {
    expect(slaState(new Date('2026-11-09T10:00:00Z'), 'COMPLETED', now)).toEqual({
      breached: false,
      atRisk: false,
    });
    expect(slaState(new Date('2026-11-09T10:00:00Z'), 'CLOSED', now)).toEqual({
      breached: false,
      atRisk: false,
    });
  });

  it('aşım breached; kalan ≤ eşik ise atRisk', () => {
    expect(slaState(new Date('2026-11-09T11:00:00Z'), 'ASSIGNED', now).breached).toBe(true);
    const riskWindow = new Date(now.getTime() + (SLA_AT_RISK_MINUTES - 30) * 60_000);
    expect(slaState(riskWindow, 'PLANNED', now).atRisk).toBe(true);
    const safe = new Date(now.getTime() + (SLA_AT_RISK_MINUTES + 60) * 60_000);
    expect(slaState(safe, 'PLANNED', now).atRisk).toBe(false);
  });

  it('slaDueAt yok → ikisi de false', () => {
    expect(slaState(null, 'DRAFT', now)).toEqual({ breached: false, atRisk: false });
  });
});

// ------------------------- Yetenek eşleştirme -------------------------

describe('matchSkills', () => {
  it('tam eşleşme skoru 1', () => {
    const result = matchSkills(
      ['hvac', 'elektrik'],
      [
        { key: 'hvac', level: 4 },
        { key: 'elektrik', level: 3 },
      ],
    );
    expect(result.score).toBe(1);
    expect(result.missing).toEqual([]);
  });

  it('eksik yetenek missing listesinde', () => {
    const result = matchSkills(['hvac', 'sogutma'], [{ key: 'hvac', level: 4 }]);
    expect(result.score).toBe(0.5);
    expect(result.missing).toEqual(['sogutma']);
  });

  it('gerekli yok → nötr skor 1', () => {
    expect(matchSkills([], [{ key: 'hvac', level: 4 }]).score).toBe(1);
  });
});

// ------------------------- Serbest slotlar -------------------------

describe('freeSlotsForDay', () => {
  it('iş ve izin düşülür', () => {
    const slots = freeSlotsForDay({
      workingWindows: [windowOf('2026-11-09T06:00:00Z', '2026-11-09T15:00:00Z')],
      booked: [windowOf('2026-11-09T06:00:00Z', '2026-11-09T09:00:00Z')],
      timeOffs: [windowOf('2026-11-09T13:00:00Z', '2026-11-09T15:00:00Z')],
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]!.start.toISOString()).toBe('2026-11-09T09:00:00.000Z');
    expect(slots[0]!.end.toISOString()).toBe('2026-11-09T13:00:00.000Z');
  });
});
