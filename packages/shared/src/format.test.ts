import { describe, expect, it } from 'vitest';
import { formatAge, formatLatency } from './format.js';

describe('formatLatency', () => {
  it('milisaniyeyi yuvarlar', () => {
    expect(formatLatency(12.4)).toBe('12 ms');
  });
  it('saniyeye çevirir', () => {
    expect(formatLatency(1530)).toBe('1.5 sn');
  });
  it('geçersiz değerlerde tire gösterir', () => {
    expect(formatLatency(Number.NaN)).toBe('—');
    expect(formatLatency(-5)).toBe('—');
  });
});

describe('formatAge', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  it('saniye', () => {
    expect(formatAge('2026-11-09T11:59:58Z', now)).toBe('2 sn önce');
  });
  it('dakika', () => {
    expect(formatAge('2026-11-09T11:58:00Z', now)).toBe('2 dk önce');
  });
  it('saat', () => {
    expect(formatAge('2026-11-09T09:00:00Z', now)).toBe('3 sa önce');
  });
  it('gün', () => {
    expect(formatAge('2026-11-07T12:00:00Z', now)).toBe('2 gün önce');
  });
  it('geçersiz ISO → tire', () => {
    expect(formatAge('not-a-date', now)).toBe('—');
  });
  it("gelecek zaman 0'a sabitlenir", () => {
    expect(formatAge('2026-11-09T12:00:10Z', now)).toBe('0 sn önce');
  });
});
