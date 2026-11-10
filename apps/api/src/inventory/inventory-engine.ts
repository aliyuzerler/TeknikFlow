/**
 * Faz 09 — stok motoru (SAF fonksiyonlar; ADR-0011).
 *
 * TEK GERÇEKLİK: hareket yön/delta matematiği, kullanılabilirlik,
 * negatif stok kapısı, rezervasyon durum makinesi, maliyet dondurma,
 * FEFO lot seçimi ve sayım farkı kuralları burada tanımlıdır; API
 * servisleri ve testler aynı motoru kullanır. Veritabanı erişimi YOKTUR.
 *
 * Miktarlar sayı olarak gelir (sözleşme: ≤4 ondalık); Decimal'e çevrim
 * servis katındadır. Bakiye kuralları:
 *   available = onHand − reservedQty
 *   OUT hareketleri (CONSUME/TRANSFER/ISSUE/RETURN/negatif ADJUSTMENT)
 *   onHand − reservedQty ≥ quantity ister — aksi 409 NEGATIVE_STOCK_FORBIDDEN.
 */

export type StockMovementType =
  | 'RECEIVE'
  | 'ISSUE'
  | 'TRANSFER'
  | 'RETURN'
  | 'CONSUME'
  | 'ADJUSTMENT';

export interface MovementDeltas {
  /** Kaynak depo değişimi (negatif ya da 0). */
  fromDelta: number;
  /** Hedef depo değişimi (pozitif ya da 0). */
  toDelta: number;
  /** Kiracı geneli toplam değişimi — defterin quantityDelta alanı. */
  globalDelta: number;
}

/**
 * Hareket matematiği — hareket türü + pozitif miktar → üç delta.
 * CONSUME yalnız iş emri parça ucunda üretilir (genel uç reddeder).
 */
export function movementDeltas(type: StockMovementType, quantity: number): MovementDeltas {
  if (!(quantity > 0)) throw new Error('miktar pozitif olmalı');
  switch (type) {
    case 'RECEIVE':
      return { fromDelta: 0, toDelta: quantity, globalDelta: quantity };
    case 'CONSUME':
      return { fromDelta: -quantity, toDelta: 0, globalDelta: -quantity };
    case 'ISSUE':
    case 'TRANSFER':
    case 'RETURN':
      // Depolar arası: küresel toplam değişmez.
      return { fromDelta: -quantity, toDelta: quantity, globalDelta: 0 };
    case 'ADJUSTMENT':
      // Yön çağrı yerinde belirler: to → pozitif, from → negatif.
      throw new Error('ADJUSTMENT yönü çağrı yerinde movementDeltasForAdjustment ile verilir');
  }
}

/** ADJUSTMENT yönü — pozitif düzeltme to (giriş), negatif from (çıkış). */
export function movementDeltasForAdjustment(
  direction: 'IN' | 'OUT',
  quantity: number,
): MovementDeltas {
  if (!(quantity > 0)) throw new Error('miktar pozitif olmalı');
  return direction === 'IN'
    ? { fromDelta: 0, toDelta: quantity, globalDelta: quantity }
    : { fromDelta: -quantity, toDelta: 0, globalDelta: -quantity };
}

/** Hareket türünün genel /inventory/movements ucunda geçerliliği. */
export function isGenericEndpointType(type: StockMovementType): boolean {
  return type !== 'CONSUME';
}

/** available = onHand − reserved (rezervasyon kilidi düşülür). */
export function availableOf(onHand: number, reservedQty: number): number {
  return onHand - reservedQty;
}

/**
 * Negatif stok kapısı — OUT hareketi bakiyeyi 0 altına indiremez.
 * Onaylı tek yol sayım kapanışıdır (ADJUSTMENT, stock:manage + denetim).
 */
export function insufficientOutgoing(
  onHand: number,
  reservedQty: number,
  quantity: number,
): boolean {
  return availableOf(onHand, reservedQty) < quantity;
}

/** Düşük stok uyarısı — yalnız aktif kalemde eşik anlamlıdır. */
export function isLowStock(active: boolean, onHand: number, reorderPoint: number): boolean {
  if (!active) return false;
  return onHand <= reorderPoint;
}

/**
 * Rezervasyon durum makinesi — tüketim ilerledikçe:
 *   consumed == 0            → ACTIVE
 *   0 < consumed < reserved  → PARTIALLY_CONSUMED
 *   consumed ≥ reserved      → CONSUMED
 * RELEASED yalnız serbest bırakma eylemiyle (ayrı uç) gelir.
 */
export type ReservationStatus = 'ACTIVE' | 'PARTIALLY_CONSUMED' | 'CONSUMED' | 'RELEASED';

export function reservationStatusFor(
  reservedQty: number,
  consumedQty: number,
): Exclude<ReservationStatus, 'RELEASED'> {
  if (consumedQty <= 0) return 'ACTIVE';
  if (consumedQty >= reservedQty) return 'CONSUMED';
  return 'PARTIALLY_CONSUMED';
}

/** Rezervasyon içi tüketim sınırı — kilidin üstünde tüketim reddedilir. */
export function exceedsReservation(
  reservedQty: number,
  consumedQty: number,
  quantity: number,
): boolean {
  return consumedQty + quantity > reservedQty;
}

/**
 * Maliyet dondurma — tüketim anındaki lot birim maliyeti ile toplam
 * kuruş hesabı. Miktar ≤4 ondalık; sonuç en yakın kuruşa yuvarlanır.
 */
export function consumeCostMinor(
  quantity: number,
  unitCostMinor: number | null,
): number | null {
  if (unitCostMinor === null) return null;
  return Math.round(quantity * unitCostMinor);
}

/** Lot süresi dolmuş mu? (expiresAt < at → tüketime kapalı) */
export function isLotExpired(expiresAt: Date | null, at: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() < at.getTime();
}

/** FEFO sıralaması — süresi en önce dolan lot önce tüketilir; tarihsizler sona. */
export function pickLotsFEFO<T extends { expiresAt: Date | null; lotNo?: string }>(
  lots: readonly T[],
): T[] {
  return [...lots].sort((a, b) => {
    if (a.expiresAt && b.expiresAt) {
      const diff = a.expiresAt.getTime() - b.expiresAt.getTime();
      if (diff !== 0) return diff;
    }
    if (a.expiresAt && !b.expiresAt) return -1;
    if (!a.expiresAt && b.expiresAt) return 1;
    // Kararlılık: lotNo sözlükbilimsel.
    return (a.lotNo ?? '').localeCompare(b.lotNo ?? '');
  });
}

/** Sayım farkı — counted − expected; kapanışta ADJUSTMENT büyüklüğü. */
export function countDelta(expected: number, counted: number): number {
  return counted - expected;
}

/** Sayım satırı düzeltmesinin üreteceği ADJUSTMENT yönü. */
export function countDirection(delta: number): 'IN' | 'OUT' | 'NONE' {
  if (delta > 0) return 'IN';
  if (delta < 0) return 'OUT';
  return 'NONE';
}

/**
 * Hareket şekil doğrulaması (sözleşmenin ÖTESİNDE savunma derinliği —
 * iç çağrılar/rezervasyon tüketimi için).
 */
export function validateMovementShape(
  type: StockMovementType,
  fromWarehouseId: string | null | undefined,
  toWarehouseId: string | null | undefined,
): string | null {
  switch (type) {
    case 'RECEIVE':
      return toWarehouseId && !fromWarehouseId
        ? null
        : 'RECEIVE yalnız toWarehouse ile yapılır';
    case 'CONSUME':
      return fromWarehouseId && !toWarehouseId
        ? null
        : 'CONSUME yalnız fromWarehouse ile yapılır';
    case 'ISSUE':
    case 'TRANSFER':
    case 'RETURN':
      return fromWarehouseId && toWarehouseId && fromWarehouseId !== toWarehouseId
        ? null
        : 'Transfer türleri from+to ile yapılır ve depolar farklı olmalı';
    case 'ADJUSTMENT': {
      const sides = (fromWarehouseId ? 1 : 0) + (toWarehouseId ? 1 : 0);
      return sides === 1 ? null : 'ADJUSTMENT tam bir depo tarafı ister';
    }
  }
}

/** Görünüm miktar biçimleyici — Decimal toNumber sonrası float kalıntılarını temizler. */
export function qtyToView(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
