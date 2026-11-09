import { describe, expect, it } from 'vitest';
import { WORK_ORDER_STATUSES, WORK_ORDER_TRANSITION_TARGETS } from '@teknikflow/contracts';
import {
  WORK_ORDER_TRANSITIONS,
  allowedTargets,
  findTransitionRule,
  isTransitionAllowed,
  requireTransitionRule,
  transitionEffects,
  type TransitionRule,
} from './work-order-state.js';

/**
 * Faz 05 — iş emri durum makinesi birim testleri.
 *
 * TEST-05 kabul kriteri: "All allowed transitions tested; invalid
 * transitions denied" → 12×12 TAM matris (kendine geçiş dahil) kanıtlanır.
 */

/** Beklenen izinli geçişler (from → to kümesi) — PRD §5 yaşam döngüsü. */
const EXPECTED_ALLOWED: Record<string, string[]> = {
  DRAFT: ['PLANNED', 'CANCELLED'],
  PLANNED: ['ASSIGNED', 'DRAFT', 'CANCELLED'],
  ASSIGNED: ['ACCEPTED', 'PLANNED', 'CANCELLED'],
  ACCEPTED: ['EN_ROUTE', 'CANCELLED'],
  EN_ROUTE: ['ON_SITE', 'CANCELLED'],
  ON_SITE: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_PARTS', 'WAITING_CUSTOMER', 'COMPLETED', 'CANCELLED'],
  WAITING_PARTS: ['IN_PROGRESS', 'CANCELLED'],
  WAITING_CUSTOMER: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

describe('iş emri durum makinesi', () => {
  it('sözleşmedeki tüm durumlar makinede tanımlı', () => {
    expect(Object.keys(WORK_ORDER_TRANSITIONS).sort()).toEqual([...WORK_ORDER_STATUSES].sort());
  });

  it('sözleşmenin görünür geçiş tablosu (UI) API makinesiyle birebir (ADR-0007)', () => {
    for (const status of WORK_ORDER_STATUSES) {
      const machineTargets = allowedTargets(status).sort();
      const contractTargets = [...WORK_ORDER_TRANSITION_TARGETS[status]].sort();
      expect(machineTargets, `sözleşme ↔ makine: ${status}`).toEqual(contractTargets);
    }
  });

  it('TAM 12×12 matris: izinli geçişler birebir kabul listesiyle örtüşür', () => {
    for (const from of WORK_ORDER_STATUSES) {
      const actual = allowedTargets(from).sort();
      expect(actual, `${from} hedefleri`).toEqual([...(EXPECTED_ALLOWED[from] ?? [])].sort());
    }
  });

  it('TAM 12×12 matris: izinli olmayan TÜM geçişler reddedilir (144 kombinasyon)', () => {
    let denied = 0;
    let allowed = 0;
    for (const from of WORK_ORDER_STATUSES) {
      for (const to of WORK_ORDER_STATUSES) {
        if (isTransitionAllowed(from, to)) {
          allowed += 1;
        } else {
          denied += 1;
        }
      }
    }
    // 24 izinli (haritada tanımlı) + 120 reddedilen (144 - 24, kendine geçişler dahil).
    const expectedAllowed = Object.values(EXPECTED_ALLOWED).reduce((n, list) => n + list.length, 0);
    expect(allowed).toBe(expectedAllowed);
    expect(denied).toBe(WORK_ORDER_STATUSES.length * WORK_ORDER_STATUSES.length - expectedAllowed);
  });

  it('terminal durumdan hiçbir geçiş yok (CLOSED, CANCELLED)', () => {
    expect(allowedTargets('CLOSED')).toEqual([]);
    expect(allowedTargets('CANCELLED')).toEqual([]);
  });

  it('kendine geçiş (A→A) her durumda geçersizdir', () => {
    for (const state of WORK_ORDER_STATUSES) {
      expect(isTransitionAllowed(state, state), `${state}→${state}`).toBe(false);
      expect(findTransitionRule(state, state)).toBeUndefined();
    }
  });

  it('izinli geçiş sayısı 24; her kural from/to/action/authority taşır', () => {
    const allRules = WORK_ORDER_STATUSES.flatMap((from) => WORK_ORDER_TRANSITIONS[from]);
    expect(allRules.length).toBe(24);
    for (const rule of allRules as TransitionRule[]) {
      expect(rule.from).toBeTruthy();
      expect(rule.to).toBeTruthy();
      expect(rule.action).toBeTruthy();
      expect(['PLANNING', 'DISPATCH', 'EXECUTION', 'CLOSE', 'CANCEL']).toContain(rule.authority);
      expect(rule.from).not.toBe(rule.to);
    }
  });

  it('requireTransitionRule izinli kuralı döndürür, geçersizde 409 INVALID_TRANSITION', () => {
    const rule = requireTransitionRule('ASSIGNED', 'ACCEPTED');
    expect(rule.action).toBe('ACCEPT');
    expect(rule.authority).toBe('EXECUTION');

    expect(() => requireTransitionRule('CLOSED', 'IN_PROGRESS')).toThrowError(
      expect.objectContaining({ status: 409 }),
    );
    try {
      requireTransitionRule('CLOSED', 'IN_PROGRESS');
      expect.unreachable('fırlatmalıydı');
    } catch (error) {
      const body = (error as { getResponse: () => Record<string, unknown> }).getResponse();
      expect(body.code).toBe('INVALID_TRANSITION');
      expect(body.allowed).toEqual([]);
    }
  });

  it("hatalı yanıt zarfı izinli hedefleri taşır (istemci UI'yi günceller)", () => {
    try {
      requireTransitionRule('ACCEPTED', 'PLANNED');
      expect.unreachable('fırlatmalıydı');
    } catch (error) {
      const body = (error as { getResponse: () => Record<string, unknown> }).getResponse();
      expect(body.allowed).toEqual(['EN_ROUTE', 'CANCELLED']);
    }
  });

  it('yetki sınıfları senaryola uygun: yürütme=atanan, atama=dispatch, kapatma=yönetici', () => {
    // Teknisyenin kendi akışı (kabul→yol→yerinde→iş) EXECUTION sınıfındadır.
    for (const [from, to] of [
      ['ASSIGNED', 'ACCEPTED'],
      ['ACCEPTED', 'EN_ROUTE'],
      ['EN_ROUTE', 'ON_SITE'],
      ['ON_SITE', 'IN_PROGRESS'],
      ['IN_PROGRESS', 'COMPLETED'],
    ] as const) {
      expect(findTransitionRule(from, to)?.authority).toBe('EXECUTION');
    }
    // Atama/planlama ofis tarafı: DISPATCH/PLANNING.
    expect(findTransitionRule('PLANNED', 'ASSIGNED')?.authority).toBe('DISPATCH');
    expect(findTransitionRule('ASSIGNED', 'PLANNED')?.authority).toBe('DISPATCH');
    expect(findTransitionRule('DRAFT', 'PLANNED')?.authority).toBe('PLANNING');
    // Kapatma ayrıcalıklı: CLOSE.
    expect(findTransitionRule('COMPLETED', 'CLOSED')?.authority).toBe('CLOSE');
    // İptal ofis yetkisiyle her açık durumdan.
    expect(findTransitionRule('IN_PROGRESS', 'CANCELLED')?.authority).toBe('CANCEL');
  });
});

describe('transitionEffects (taraf değişken etkileri)', () => {
  it('kabul zamanı ACCEPTED geçişinde yazılır', () => {
    expect(transitionEffects('ACCEPTED').acceptedAt).toBeInstanceOf(Date);
  });

  it('başlangıç zamanı IN_PROGRESS geçişinde yazılır; yeniden açma tamamlanmayı temizler', () => {
    const start = transitionEffects('IN_PROGRESS');
    expect(start.startedAt).toBeInstanceOf(Date);
    expect(start.completedAt).toBeNull();
  });

  it('atama kaldırma (→PLANNED) atananı temizler ve kabul zamanını sıfırlar', () => {
    const effects = transitionEffects('PLANNED');
    expect(effects.clearAssignee).toBe(true);
    expect(effects.acceptedAt).toBeNull();
  });

  it('terminal zaman damgaları: CLOSED/CANCELLED/COMPLETED', () => {
    expect(transitionEffects('CLOSED').closedAt).toBeInstanceOf(Date);
    expect(transitionEffects('CANCELLED').cancelledAt).toBeInstanceOf(Date);
    expect(transitionEffects('COMPLETED').completedAt).toBeInstanceOf(Date);
  });

  it('yol/yerinde/bekleme geçişleri taraf değişkeni değiştirmez', () => {
    for (const state of ['EN_ROUTE', 'ON_SITE', 'WAITING_PARTS', 'WAITING_CUSTOMER'] as const) {
      expect(transitionEffects(state)).toEqual({});
    }
  });
});
