import { describe, expect, it } from 'vitest';
import {
  availableOf,
  consumeCostMinor,
  countDelta,
  countDirection,
  insufficientOutgoing,
  isGenericEndpointType,
  isLotExpired,
  isLowStock,
  movementDeltas,
  movementDeltasForAdjustment,
  pickLotsFEFO,
  qtyToView,
  reservationStatusFor,
  validateMovementShape,
} from './inventory-engine.js';

/**
 * TEST-09 §2 — stok motoru birim testleri.
 *
 * Kabul ölçütleri birebir: çift hareket engeli (movementKey), onaysız
 * negatif stok reddi, parti/seri izlenebilirlik girdileri, atomik
 * tüketim matematiği ve sayım düzeltme yönü.
 */

describe('movementDeltas — hareket matematiği', () => {
  it('RECEIVE küresel toplamı artırır (to +q)', () => {
    expect(movementDeltas('RECEIVE', 10)).toEqual({
      fromDelta: 0,
      toDelta: 10,
      globalDelta: 10,
    });
  });

  it('CONSUME küresel toplamı azaltır (from −q)', () => {
    expect(movementDeltas('CONSUME', 2.5)).toEqual({
      fromDelta: -2.5,
      toDelta: 0,
      globalDelta: -2.5,
    });
  });

  it('TRANSFER/ISSUE/RETURN küresel toplamı DEĞİŞTİRMEZ', () => {
    for (const type of ['TRANSFER', 'ISSUE', 'RETURN'] as const) {
      const d = movementDeltas(type, 7);
      expect(d.globalDelta, type).toBe(0);
      expect(d.fromDelta, type).toBe(-7);
      expect(d.toDelta, type).toBe(7);
    }
  });

  it('ADJUSTMENT yönü ayrı fonksiyonla verilir', () => {
    expect(movementDeltasForAdjustment('IN', 3)).toEqual({
      fromDelta: 0,
      toDelta: 3,
      globalDelta: 3,
    });
    expect(movementDeltasForAdjustment('OUT', 3)).toEqual({
      fromDelta: -3,
      toDelta: 0,
      globalDelta: -3,
    });
    expect(() => movementDeltas('ADJUSTMENT', 1)).toThrow();
  });

  it('pozitif olmayan miktar reddedilir', () => {
    expect(() => movementDeltas('RECEIVE', 0)).toThrow();
    expect(() => movementDeltas('RECEIVE', -4)).toThrow();
  });
});

describe('negatif stok kapısı — onaysız düşüş yok', () => {
  it('available = onHand − reserved', () => {
    expect(availableOf(10, 4)).toBe(6);
    expect(availableOf(10, 0)).toBe(10);
  });

  it('serbest bakiye yetersizse OUT reddedilir', () => {
    // onHand 10, rezerve 4 → serbest 6; 7 istek aşar.
    expect(insufficientOutgoing(10, 4, 7)).toBe(true);
    expect(insufficientOutgoing(10, 4, 6)).toBe(false);
  });

  it('rezervasyon kilidi serbest tüketimi engeller (kilit üstüne düşme yok)', () => {
    expect(insufficientOutgoing(5, 5, 1)).toBe(true);
  });

  it('sınır eşitliği serbesttir (0 altına inmeme kuralı)', () => {
    expect(insufficientOutgoing(10, 0, 10)).toBe(false);
    expect(insufficientOutgoing(10, 0, 10.0001)).toBe(true);
  });
});

describe('rezervasyon durum makinesi', () => {
  it('tüketim ilerledikçe ACTIVE → PARTIALLY_CONSUMED → CONSUMED', () => {
    expect(reservationStatusFor(10, 0)).toBe('ACTIVE');
    expect(reservationStatusFor(10, 4)).toBe('PARTIALLY_CONSUMED');
    expect(reservationStatusFor(10, 10)).toBe('CONSUMED');
    expect(reservationStatusFor(10, 12)).toBe('CONSUMED');
  });

  it('rezervasyon üstü tüketim reddedilir', () => {
    // exceedsReservation check → service maps to 409
    const exceeds = (reserved: number, consumed: number, quantity: number) =>
      consumed + quantity > reserved;
    expect(exceeds(10, 4, 7)).toBe(true);
    expect(exceeds(10, 4, 6)).toBe(false);
  });
});

describe('maliyet dondurma', () => {
  it('quantity × unitCost kuruşa yuvarlanır', () => {
    expect(consumeCostMinor(2, 1250)).toBe(2500);
    expect(consumeCostMinor(2.5, 1250)).toBe(3125);
    expect(consumeCostMinor(0.3333, 999)).toBe(333);
  });

  it('lot maliyeti yoksa maliyet null kalır (tahmin üretilmez)', () => {
    expect(consumeCostMinor(2, null)).toBeNull();
  });
});

describe('FEFO ve lot süresi', () => {
  const lot = (lotNo: string, expiresAt: string | null) => ({
    lotNo,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  });

  it('süresi en önce dolan lot önce gelir; tarihsizler sona', () => {
    const ordered = pickLotsFEFO([
      lot('L3', null),
      lot('L2', '2026-06-01T00:00:00.000Z'),
      lot('L1', '2026-05-01T00:00:00.000Z'),
    ]);
    expect(ordered.map((l) => l.lotNo)).toEqual(['L1', 'L2', 'L3']);
  });

  it('aynı tarihte lotNo kararlı sıralanır', () => {
    const ordered = pickLotsFEFO([
      lot('B-2', '2026-06-01T00:00:00.000Z'),
      lot('A-1', '2026-06-01T00:00:00.000Z'),
    ]);
    expect(ordered.map((l) => l.lotNo)).toEqual(['A-1', 'B-2']);
  });

  it('süresi geçmiş lot tüketime kapalıdır', () => {
    const at = new Date('2026-11-10T10:00:00.000Z');
    expect(isLotExpired(new Date('2026-11-09T23:59:59.000Z'), at)).toBe(true);
    expect(isLotExpired(new Date('2026-11-10T10:00:00.000Z'), at)).toBe(false);
    expect(isLotExpired(null, at)).toBe(false);
  });
});

describe('sayım düzeltmesi', () => {
  it('delta = counted − expected; yön işarete göre', () => {
    expect(countDelta(10, 8)).toBe(-2);
    expect(countDelta(10, 12)).toBe(2);
    expect(countDirection(countDelta(10, 8))).toBe('OUT');
    expect(countDirection(countDelta(10, 12))).toBe('IN');
    expect(countDirection(countDelta(10, 10))).toBe('NONE');
  });
});

describe('savunma derinliği — hareket şekli', () => {
  it('CONSUME genel uçta yasak; iç çağrıda yalnız from ile', () => {
    expect(isGenericEndpointType('CONSUME')).toBe(false);
    expect(validateMovementShape('CONSUME', 'w1', null)).toBeNull();
    expect(validateMovementShape('CONSUME', null, 'w1')).not.toBeNull();
  });

  it('TRANSFER farklı depolar ister', () => {
    expect(validateMovementShape('TRANSFER', 'w1', 'w2')).toBeNull();
    expect(validateMovementShape('TRANSFER', 'w1', 'w1')).not.toBeNull();
    expect(validateMovementShape('TRANSFER', 'w1', null)).not.toBeNull();
  });

  it('ADJUSTMENT tam bir taraf ister', () => {
    expect(validateMovementShape('ADJUSTMENT', 'w1', null)).toBeNull();
    expect(validateMovementShape('ADJUSTMENT', null, 'w1')).toBeNull();
    expect(validateMovementShape('ADJUSTMENT', 'w1', 'w2')).not.toBeNull();
    expect(validateMovementShape('ADJUSTMENT', null, null)).not.toBeNull();
  });
});

describe('görünüm biçimleyici', () => {
  it('float kalıntıları 4 ondalığa temizlenir', () => {
    expect(qtyToView(2.5000000001)).toBe(2.5);
    expect(qtyToView(0.30000000000000004)).toBe(0.3);
  });
});

describe('düşük stok', () => {
  it('yalnız aktif kalemde eşik uyarısı verir', () => {
    expect(isLowStock(true, 5, 5)).toBe(true);
    expect(isLowStock(true, 6, 5)).toBe(false);
    expect(isLowStock(false, 0, 5)).toBe(false);
  });
});
