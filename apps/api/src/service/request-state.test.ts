import { describe, expect, it } from 'vitest';
import {
  REQUEST_STATES,
  REQUEST_TRANSITIONS,
  isConvertible,
  isRequestTerminal,
  isRequestTransitionAllowed,
} from './request-state.js';
import {
  computeSlaDueAt,
  DEFAULT_SLA_RESOLVE_MINUTES,
  defaultResolveMinutes,
  isSlaBreached,
} from './sla.js';

/**
 * Faz 05 — talep durum makinesi + SLA yardımcıları (saf birim testleri).
 */

describe('talep durum makinesi', () => {
  it('durumlar: NEW, IN_REVIEW, CONVERTED, CANCELLED', () => {
    expect(REQUEST_STATES.sort()).toEqual(['CANCELLED', 'CONVERTED', 'IN_REVIEW', 'NEW']);
  });

  it('NEW → IN_REVIEW izinli; NEW → CONVERTED doğrudan yok (dönüşüm ucu iş emri kurar)', () => {
    expect(isRequestTransitionAllowed('NEW', 'IN_REVIEW')).toBe(true);
    expect(isRequestTransitionAllowed('NEW', 'CONVERTED')).toBe(false);
  });

  it('her açık durumdan CANCELLED izinli; terminallerden hiçbir yer', () => {
    for (const from of REQUEST_STATES) {
      const open = from === 'NEW' || from === 'IN_REVIEW';
      expect(isRequestTransitionAllowed(from, 'CANCELLED')).toBe(open);
    }
    expect(REQUEST_TRANSITIONS.CONVERTED).toEqual([]);
    expect(REQUEST_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('kendine geçiş geçersiz', () => {
    for (const state of REQUEST_STATES) {
      expect(isRequestTransitionAllowed(state, state)).toBe(false);
    }
  });

  it('dönüşüme açıklık: yalnız NEW ve IN_REVIEW', () => {
    expect(isConvertible('NEW')).toBe(true);
    expect(isConvertible('IN_REVIEW')).toBe(true);
    expect(isConvertible('CONVERTED')).toBe(false);
    expect(isConvertible('CANCELLED')).toBe(false);
    expect(isRequestTerminal('CONVERTED')).toBe(true);
    expect(isRequestTerminal('CANCELLED')).toBe(true);
    expect(isRequestTerminal('NEW')).toBe(false);
  });
});

describe('SLA hesaplama', () => {
  it('varsayılan katalog: URGENT 4sa, HIGH 8sa, MEDIUM 24sa, LOW 72sa', () => {
    expect(DEFAULT_SLA_RESOLVE_MINUTES).toEqual({
      URGENT: 240,
      HIGH: 480,
      MEDIUM: 1440,
      LOW: 4320,
    });
    expect(defaultResolveMinutes('URGENT')).toBe(240);
  });

  it('slaDueAt = referans + süre (dakika)', () => {
    const base = new Date('2026-11-09T08:00:00.000Z');
    expect(computeSlaDueAt(base, 60).toISOString()).toBe('2026-11-09T09:00:00.000Z');
    expect(computeSlaDueAt(base, 1440).toISOString()).toBe('2026-11-10T08:00:00.000Z');
  });

  it('aşım: açık süreçte süre geçmişse true; terminal veya süresiz false', () => {
    const past = new Date('2026-11-08T00:00:00.000Z');
    const future = new Date('2030-01-01T00:00:00.000Z');
    const now = new Date('2026-11-09T12:00:00.000Z');
    expect(isSlaBreached(past, 'NEW', now)).toBe(true);
    expect(isSlaBreached(future, 'NEW', now)).toBe(false);
    expect(isSlaBreached(past, 'CONVERTED', now)).toBe(false);
    expect(isSlaBreached(past, 'CANCELLED', now)).toBe(false);
    expect(isSlaBreached(past, 'CLOSED', now)).toBe(false);
    expect(isSlaBreached(null, 'NEW', now)).toBe(false);
  });
});
