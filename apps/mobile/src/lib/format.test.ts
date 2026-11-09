import { formatDateTime, formatScheduleWindow, formatTime, slaLabel } from './format';

/**
 * Faz 07 — biçimlendirme testleri: kiracı saat dilimi (Europe/Istanbul,
 * kalıcı UTC+3) doğru yorumlanır; SLA durumları dürüst.
 */

describe('formatDateTime / formatTime', () => {
  it('UTC anı İstanbul duvar saatiyle yazılır (+3)', () => {
    // 2026-11-09T06:00:00Z → İstanbul 09:00
    expect(formatTime('2026-11-09T06:00:00.000Z')).toBe('09:00');
    expect(formatDateTime('2026-11-09T06:00:00.000Z')).toContain('09:00');
    expect(formatDateTime('2026-11-09T06:00:00.000Z')).toContain('09.11.2026');
  });

  it('null/boş değer emin biçimde —', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatTime(undefined)).toBe('—');
  });
});

describe('formatScheduleWindow', () => {
  it('aynı gün: tek gün + aralık', () => {
    expect(formatScheduleWindow('2026-11-09T06:00:00.000Z', '2026-11-09T09:30:00.000Z')).toBe(
      '09 Kasım Pazartesi 09:00 – 12:30',
    );
  });

  it('gün aşarsa iki uç yazılır', () => {
    expect(formatScheduleWindow('2026-11-09T18:00:00.000Z', '2026-11-10T10:00:00.000Z')).toBe(
      '09.11.2026 21:00 – 10.11.2026 13:00',
    );
  });

  it('planlanmamış — dürüst etiket', () => {
    expect(formatScheduleWindow(null, null)).toBe('Planlanmadı');
  });
});

describe('slaLabel', () => {
  const base = {
    slaDueAt: null as string | null,
    status: 'IN_PROGRESS' as const,
    slaBreached: false,
  };

  it('terminal durumlarda SLA söner', () => {
    expect(slaLabel({ ...base, status: 'CLOSED' })).toMatchObject({ tone: 'none' });
    expect(slaLabel({ ...base, status: 'COMPLETED' })).toMatchObject({ tone: 'none' });
  });

  it('slaDueAt yok — none', () => {
    expect(slaLabel(base)).toMatchObject({ tone: 'none' });
  });

  it('geçmiş son tarih — danger/aşım', () => {
    const due = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(slaLabel({ ...base, slaDueAt: due })).toMatchObject({ tone: 'danger' });
  });

  it('kalan ≤ 4 saat — warning/risk', () => {
    const due = new Date(Date.now() + 120 * 60_000).toISOString();
    const result = slaLabel({ ...base, slaDueAt: due });
    expect(result.tone).toBe('warning');
    expect(result.text).toContain('dk kaldı');
  });

  it('uzak son tarih — success', () => {
    const due = new Date(Date.now() + 30 * 3600_000).toISOString();
    expect(slaLabel({ ...base, slaDueAt: due }).tone).toBe('success');
  });
});
