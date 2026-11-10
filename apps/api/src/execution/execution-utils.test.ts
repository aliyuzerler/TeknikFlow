import { describe, expect, it } from 'vitest';
import {
  computeLaborSummary,
  detectMime,
  entryDurationMinutes,
  mimeMatches,
} from './execution-utils.js';

/**
 * TEST-08 §2 — Faz 08 saha yürütme saf çekirdekleri: magic-byte koklama
 * ve işgücü özeti hesabı (dosya sistemi/S3/DB olmadan).
 */

describe('detectMime', () => {
  it('JPEG magic byte tanınır', () => {
    const head = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectMime(head)).toBe('image/jpeg');
  });

  it('PNG magic byte tanınır', () => {
    const head = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(detectMime(head)).toBe('image/png');
  });

  it('PDF magic byte tanınır', () => {
    const head = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    expect(detectMime(head)).toBe('application/pdf');
  });

  it('MP4 ftyp kutusu tanınır (4. bayttan itibaren)', () => {
    const head = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73]);
    //                                            f     t     y     p
    expect(detectMime(head)).toBe('video/mp4');
  });

  it('SVG/metin/yürütülebilir içerik tanınmaz (null)', () => {
    const svg = new TextEncoder().encode('<?xml version="1.0"?><svg onload="x">');
    expect(detectMime(new Uint8Array(svg))).toBeNull();
    expect(detectMime(Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // EXE
    expect(detectMime(Uint8Array.from([0x7f, 0x45, 0x4c, 0x46]))).toBeNull(); // ELF
  });

  it('çok kısa başlıkta tanıma yapılmaz', () => {
    expect(detectMime(Uint8Array.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('mimeMatches', () => {
  it('bildirilen MIME tespitle aynıysa doğru', () => {
    expect(mimeMatches('image/jpeg', 'image/jpeg')).toBe(true);
    expect(mimeMatches('image/jpeg', 'image/png')).toBe(false);
    expect(mimeMatches('image/jpeg', null)).toBe(false);
  });
});

describe('computeLaborSummary', () => {
  const base = (over: Partial<Parameters<typeof computeLaborSummary>[0][number]>) => ({
    type: 'LABOR' as const,
    startedAt: new Date('2026-11-10T09:00:00.000Z'),
    endedAt: new Date('2026-11-10T10:00:00.000Z'),
    status: 'CLOSED',
    ...over,
  });

  it('tür bazında toplar; açık kayıt işaretlenir ve toplama girmez', () => {
    const summary = computeLaborSummary([
      base({
        type: 'TRAVEL',
        startedAt: new Date('2026-11-10T08:00:00.000Z'),
        endedAt: new Date('2026-11-10T09:00:00.000Z'),
      }),
      base({}), // 60 dk LABOR
      base({ type: 'WAITING', endedAt: new Date('2026-11-10T09:30:00.000Z') }), // 30 dk
      base({ status: 'OPEN', endedAt: null }), // açık — toplama yok
    ]);
    expect(summary).toEqual({
      travelMinutes: 60,
      laborMinutes: 60,
      waitingMinutes: 30,
      totalMinutes: 150,
      openEntry: true,
    });
  });

  it('yuvarlama yukarı: 61 saniye → 2 dakika', () => {
    const summary = computeLaborSummary([base({ endedAt: new Date('2026-11-10T09:01:01.000Z') })]);
    expect(summary.laborMinutes).toBe(2);
  });

  it('negatif/geçersiz aralık yok sayılır', () => {
    const summary = computeLaborSummary([base({ endedAt: new Date('2026-11-10T08:00:00.000Z') })]);
    expect(summary.totalMinutes).toBe(0);
  });

  it('boş liste: hepsi sıfır, açık kayıt yok', () => {
    expect(computeLaborSummary([])).toEqual({
      travelMinutes: 0,
      laborMinutes: 0,
      waitingMinutes: 0,
      totalMinutes: 0,
      openEntry: false,
    });
  });
});

describe('entryDurationMinutes', () => {
  it('kapalı kayıt dakikası ceil ile hesaplanır', () => {
    expect(
      entryDurationMinutes(
        new Date('2026-11-10T09:00:00.000Z'),
        new Date('2026-11-10T09:59:30.000Z'),
      ),
    ).toBe(60);
    expect(
      entryDurationMinutes(
        new Date('2026-11-10T09:00:00.000Z'),
        new Date('2026-11-10T09:59:59.999Z'),
      ),
    ).toBe(60);
  });

  it('açık kayıt null; sıfır-uzunluk 0', () => {
    const start = new Date('2026-11-10T09:00:00.000Z');
    expect(entryDurationMinutes(start, null)).toBeNull();
    expect(entryDurationMinutes(start, new Date('2026-11-10T09:00:00.000Z'))).toBe(0);
  });
});
