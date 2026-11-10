import { z } from 'zod';

/**
 * Faz 09 — stok sözleşmeleri: SKU kataloğu, depolar/raflar, parti/seri
 * izleme, append-only stok hareketleri, iş emri rezervasyonları, sayım
 * (cycle count) ve iş emri parça tüketimi.
 *
 * Değişmezler (docs/DATA_MODEL.md + AGENTS.md):
 * - Hareketler APPEND-ONLY'dir; bakiye asla üzerine yazılmaz — hareketle
 *   AYNI transaction'da transactional bakılır.
 * - movementKey (istemci üretimi UUID) kiracı başına benzersizdir: çift
 *   gönderim/tekrar oynatma TEK hareket satırı üretir.
 * - Negatif stok onaysız olamaz: hareket bakiyeyi 0 altına indiremez
 *   (409 NEGATIVE_STOCK_FORBIDDEN); sayım kapanışı onaylı düzeltmedir.
 * - Miktarlar 4 ondalıkla sınırlı sabit kesirli sayıdır (binary float
 *   depolanmaz — DECIMAL(18,4)); para tam sayı küsur birimidir (kuruş).
 *
 * İş emri parça tüketimi (consume) yalnız /work-orders/:id/parts üzerinden
 * yapılır: hareket + bakiye + rezervasyon + iş emri olayı TEK
 * transaction'da; yürütme raporuna (execution.ts) maliyetle akar.
 */

// ------------------------- Sabitler -------------------------

/** İzleme derinliği: NONE (toplu), LOT (parti), SERIAL (seri — 1 lot = 1 adet). */
export const STOCK_TRACKING_MODES = ['NONE', 'LOT', 'SERIAL'] as const;
export const StockTrackingModeSchema = z.enum(STOCK_TRACKING_MODES);
export type StockTrackingMode = z.infer<typeof StockTrackingModeSchema>;

export const STOCK_TRACKING_MODE_LABELS: Readonly<Record<StockTrackingMode, string>> = {
  NONE: 'İzlemsiz',
  LOT: 'Parti',
  SERIAL: 'Seri',
};

/** Depo türü: merkez, şube ya da teknisyen aracı (van stoğu). */
export const WAREHOUSE_TYPES = ['CENTRAL', 'BRANCH', 'VEHICLE'] as const;
export const WarehouseTypeSchema = z.enum(WAREHOUSE_TYPES);
export type WarehouseType = z.infer<typeof WarehouseTypeSchema>;

export const WAREHOUSE_TYPE_LABELS: Readonly<Record<WarehouseType, string>> = {
  CENTRAL: 'Merkez depo',
  BRANCH: 'Şube deposu',
  VEHICLE: 'Araç (van) stoğu',
};

/** Hareket türleri — CONSUME yalnız iş emri parça ucundan üretilir. */
export const STOCK_MOVEMENT_TYPES = [
  'RECEIVE',
  'ISSUE',
  'TRANSFER',
  'RETURN',
  'CONSUME',
  'ADJUSTMENT',
] as const;
export const StockMovementTypeSchema = z.enum(STOCK_MOVEMENT_TYPES);
export type StockMovementType = z.infer<typeof StockMovementTypeSchema>;

export const STOCK_MOVEMENT_TYPE_LABELS: Readonly<Record<StockMovementType, string>> = {
  RECEIVE: 'Giriş (alım)',
  ISSUE: 'Araç çıkışı',
  TRANSFER: 'Depolar arası transfer',
  RETURN: 'Araca iade',
  CONSUME: 'Tüketim (iş emri)',
  ADJUSTMENT: 'Sayım düzeltmesi',
};

/** Rezervasyon durumları — tüketim ilerledikçe durum makinesi ilerler. */
export const STOCK_RESERVATION_STATUSES = [
  'ACTIVE',
  'PARTIALLY_CONSUMED',
  'CONSUMED',
  'RELEASED',
] as const;
export const StockReservationStatusSchema = z.enum(STOCK_RESERVATION_STATUSES);
export type StockReservationStatus = z.infer<typeof StockReservationStatusSchema>;

export const STOCK_RESERVATION_STATUS_LABELS: Readonly<Record<StockReservationStatus, string>> = {
  ACTIVE: 'Aktif',
  PARTIALLY_CONSUMED: 'Kısmen tüketildi',
  CONSUMED: 'Tüketildi',
  RELEASED: 'Serbest bırakıldı',
};

export const STOCK_COUNT_STATUSES = ['OPEN', 'CLOSED'] as const;
export const StockCountStatusSchema = z.enum(STOCK_COUNT_STATUSES);
export type StockCountStatus = z.infer<typeof StockCountStatusSchema>;

export const STOCK_COUNT_STATUS_LABELS: Readonly<Record<StockCountStatus, string>> = {
  OPEN: 'Açık sayım',
  CLOSED: 'Kapandı',
};

/**
 * Miktar sözleşmesi: pozitif, ≤1.000.000, en çok 4 ondalık (sabit kesir;
 * 0.0001 adım — binary float kirli değerleri reddeder).
 */
const QuantityInput = z
  .number()
  .positive('Miktar sıfırdan büyük olmalı')
  .max(1_000_000)
  .refine((value) => Math.round(value * 10_000) === value * 10_000, {
    message: 'Miktar en çok 4 ondalık içerebilir',
  });

/** Sayım/duzeltme girişlerinde 0 da geçerli olabilir (sayım = boş raf). */
const QuantityNonNegative = z
  .number()
  .nonnegative()
  .max(1_000_000)
  .refine((value) => Math.round(value * 10_000) === value * 10_000, {
    message: 'Miktar en çok 4 ondalık içerebilir',
  });

/** movementKey / idempotency anahtarı için UUID desen (kanıt Faz 08 ile aynı). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** İdempotency başlığı — Faz 08 yürütme uçlarıyla aynı başlık yeniden kullanılır. */
export const INVENTORY_IDEMPOTENCY_HEADER = 'x-idempotency-key';

// ------------------------- Katalog (SKU) -------------------------

export const CreateStockItemRequestSchema = z.object({
  sku: z.string().trim().min(2).max(64),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).optional(),
  unit: z.string().trim().min(1).max(24),
  trackingMode: StockTrackingModeSchema.default('NONE'),
  reorderPoint: QuantityNonNegative.default(0),
});
export type CreateStockItemRequest = z.infer<typeof CreateStockItemRequestSchema>;

export const UpdateStockItemRequestSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  unit: z.string().trim().min(1).max(24).optional(),
  reorderPoint: QuantityNonNegative.optional(),
  active: z.boolean().optional(),
});
export type UpdateStockItemRequest = z.infer<typeof UpdateStockItemRequestSchema>;

export const StockItemViewSchema = z.object({
  itemId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  unit: z.string(),
  trackingMode: StockTrackingModeSchema,
  reorderPoint: z.number().nonnegative(),
  active: z.boolean(),
  /** Tüm depoların toplam eldeki miktarı (rezervasyon düşülmez). */
  totalOnHand: z.number().nonnegative(),
  /** totalOnHand ≤ reorderPoint (kalem aktifse) — liste uyarısı. */
  lowStock: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StockItemView = z.infer<typeof StockItemViewSchema>;

export const StockItemListResponseSchema = z.object({
  data: z.array(StockItemViewSchema),
});
export type StockItemListResponse = z.infer<typeof StockItemListResponseSchema>;

// ------------------------- Depo / raf -------------------------

export const CreateWarehouseRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    type: WarehouseTypeSchema.default('CENTRAL'),
    branchId: z.string().uuid().optional(),
    /** VEHICLE depo zorunlu sahibi: teknisyen (kendi araç stoğu). */
    assignedToId: z.string().uuid().optional(),
  })
  .refine((value) => value.type !== 'VEHICLE' || value.assignedToId !== undefined, {
    message: 'Araç deposu bir teknisyene bağlanmalı (assignedToId)',
    path: ['assignedToId'],
  });
export type CreateWarehouseRequest = z.infer<typeof CreateWarehouseRequestSchema>;

export const WarehouseViewSchema = z.object({
  warehouseId: z.string().uuid(),
  name: z.string(),
  type: WarehouseTypeSchema,
  branchId: z.string().uuid().nullable(),
  branchName: z.string().nullable(),
  assignedToId: z.string().uuid().nullable(),
  assignedToName: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
});
export type WarehouseView = z.infer<typeof WarehouseViewSchema>;

export const WarehouseListResponseSchema = z.object({
  data: z.array(WarehouseViewSchema),
});
export type WarehouseListResponse = z.infer<typeof WarehouseListResponseSchema>;

export const CreateBinRequestSchema = z.object({
  code: z.string().trim().min(1).max(32),
  note: z.string().trim().max(200).optional(),
});
export type CreateBinRequest = z.infer<typeof CreateBinRequestSchema>;

export const BinViewSchema = z.object({
  binId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  code: z.string(),
  note: z.string().nullable(),
});
export type BinView = z.infer<typeof BinViewSchema>;

export const BinListResponseSchema = z.object({
  data: z.array(BinViewSchema),
});
export type BinListResponse = z.infer<typeof BinListResponseSchema>;

// ------------------------- Hareketler -------------------------

/**
 * Genel stok hareketi (katalog/depo operasyonu). CONSUME burada YASAK:
 * tüketim yalnız /work-orders/:id/parts üzerinden atomik üretilir.
 *
 * Tür başlığı zorunlu yönler (refine ile):
 * - RECEIVE: toWarehouseId zorunlu, from Yasak.
 * - TRANSFER / ISSUE / RETURN: from + to zorunlu ve farklı.
 * - ADJUSTMENT: from (negatif düzeltme) YA DA to (pozitif) — tam birisi.
 */
export const CreateMovementRequestSchema = z
  .object({
    type: z.enum(['RECEIVE', 'ISSUE', 'TRANSFER', 'RETURN', 'ADJUSTMENT']),
    itemId: z.string().uuid(),
    quantity: QuantityInput,
    lotId: z.string().uuid().optional(),
    fromWarehouseId: z.string().uuid().optional(),
    toWarehouseId: z.string().uuid().optional(),
    /** Çift hareket engeli — kiracı başına benzersiz istemci UUID'si. */
    movementKey: z.string().refine((v) => UUID_RE.test(v), {
      message: 'movementKey UUID v4 biçiminde olmalı',
    }),
    note: z.string().trim().max(500).optional(),
    occurredAt: z.string().datetime().optional(),
  })
  .refine(
    (value) => {
      switch (value.type) {
        case 'RECEIVE':
          return value.toWarehouseId !== undefined && value.fromWarehouseId === undefined;
        case 'TRANSFER':
        case 'ISSUE':
        case 'RETURN':
          return (
            value.fromWarehouseId !== undefined &&
            value.toWarehouseId !== undefined &&
            value.fromWarehouseId !== value.toWarehouseId
          );
        case 'ADJUSTMENT':
          return (
            (value.fromWarehouseId !== undefined) !== (value.toWarehouseId !== undefined)
          );
      }
    },
    {
      message:
        'RECEIVE yalnız toWarehouse; TRANSFER/ISSUE/RETURN from+to; ADJUSTMENT tam bir depo ile yapılır',
    },
  );
export type CreateMovementRequest = z.infer<typeof CreateMovementRequestSchema>;

export const MovementViewSchema = z.object({
  movementId: z.string().uuid(),
  itemId: z.string().uuid(),
  sku: z.string(),
  itemName: z.string(),
  unit: z.string(),
  trackingMode: StockTrackingModeSchema,
  lotId: z.string().uuid().nullable(),
  lotNo: z.string().nullable(),
  movementType: StockMovementTypeSchema,
  quantity: z.number().nonnegative(),
  /** Kiracı geneli işaretli delta (TRANSFER/ISSUE/RETURN → 0). */
  quantityDelta: z.number(),
  fromWarehouseId: z.string().uuid().nullable(),
  fromWarehouseName: z.string().nullable(),
  toWarehouseId: z.string().uuid().nullable(),
  toWarehouseName: z.string().nullable(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  unitCostMinor: z.number().int().nullable(),
  note: z.string().nullable(),
  actorId: z.string().uuid(),
  actorName: z.string().nullable(),
  movementKey: z.string().nullable(),
  occurredAt: z.string().datetime(),
});
export type MovementView = z.infer<typeof MovementViewSchema>;

export const MovementListResponseSchema = z.object({
  data: z.array(MovementViewSchema),
});
export type MovementListResponse = z.infer<typeof MovementListResponseSchema>;

// ------------------------- Bakiye -------------------------

export const BalanceViewSchema = z.object({
  itemId: z.string().uuid(),
  sku: z.string(),
  itemName: z.string(),
  unit: z.string(),
  trackingMode: StockTrackingModeSchema,
  warehouseId: z.string().uuid(),
  warehouseName: z.string(),
  warehouseType: WarehouseTypeSchema,
  lotId: z.string().uuid().nullable(),
  lotNo: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
  onHand: z.number(),
  reservedQty: z.number(),
  available: z.number(),
  /** Aktif kalemde onHand ≤ reorderPoint. */
  lowStock: z.boolean(),
  updatedAt: z.string().datetime(),
});
export type BalanceView = z.infer<typeof BalanceViewSchema>;

export const BalanceListResponseSchema = z.object({
  data: z.array(BalanceViewSchema),
});
export type BalanceListResponse = z.infer<typeof BalanceListResponseSchema>;

// ------------------------- Rezervasyon -------------------------

/** İş emri için stok kilidi — available = onHand − reserved azalır. */
export const CreateReservationRequestSchema = z.object({
  workOrderId: z.string().uuid(),
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  lotId: z.string().uuid().optional(),
  quantity: QuantityInput,
  note: z.string().trim().max(500).optional(),
});
export type CreateReservationRequest = z.infer<typeof CreateReservationRequestSchema>;

export const ReservationViewSchema = z.object({
  reservationId: z.string().uuid(),
  workOrderId: z.string().uuid(),
  workOrderNo: z.string(),
  itemId: z.string().uuid(),
  sku: z.string(),
  itemName: z.string(),
  unit: z.string(),
  warehouseId: z.string().uuid(),
  warehouseName: z.string(),
  lotId: z.string().uuid().nullable(),
  lotNo: z.string().nullable(),
  reservedQty: z.number(),
  consumedQty: z.number(),
  status: StockReservationStatusSchema,
  note: z.string().nullable(),
  createdById: z.string().uuid().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ReservationView = z.infer<typeof ReservationViewSchema>;

export const ReservationListResponseSchema = z.object({
  data: z.array(ReservationViewSchema),
});
export type ReservationListResponse = z.infer<typeof ReservationListResponseSchema>;

/** Rezervasyon serbest bırakma — gövdesiz eylem ucu. */
export const ReleaseReservationRequestSchema = z.object({});
export type ReleaseReservationRequest = z.infer<typeof ReleaseReservationRequestSchema>;

// ------------------------- İş emri parça tüketimi -------------------------

/**
 * İş emri parça tüketimi — ATOMİK: CONSUME hareketi + bakiye + (varsa)
 * rezervasyon tüketimi + iş emri olayı TEK transaction'da. warehouseId
 * verilmezse teknisyenin KENDİ aracı deposu kullanılır (stock:issue_own);
 * başka deponun tüketimi stock:manage ister.
 *
 * LOT/SERIAL kalemlerde lotId ZORUNLU (servis doğrular); SERIAL'de miktar
 * tam sayıdır (1 lot = 1 adet). Süresi geçmiş lot reddedilir (LOT_EXPIRED).
 */
export const ConsumePartRequestSchema = z.object({
  itemId: z.string().uuid(),
  quantity: QuantityInput,
  lotId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  /** Rezervasyondan tüketim — kilidin sahibi iş emriyle aynı olmalı. */
  reservationId: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
});
export type ConsumePartRequest = z.infer<typeof ConsumePartRequestSchema>;

export const PartConsumptionViewSchema = z.object({
  movementId: z.string().uuid(),
  workOrderId: z.string().uuid(),
  itemId: z.string().uuid(),
  sku: z.string(),
  itemName: z.string(),
  unit: z.string(),
  trackingMode: StockTrackingModeSchema,
  lotId: z.string().uuid().nullable(),
  lotNo: z.string().nullable(),
  warehouseId: z.string().uuid(),
  warehouseName: z.string().nullable(),
  quantity: z.number(),
  unitCostMinor: z.number().int().nullable(),
  /** quantity × unitCost (kuruş) — maliyet lot maliyetinden donar. */
  totalCostMinor: z.number().int().nullable(),
  note: z.string().nullable(),
  actorId: z.string().uuid(),
  actorName: z.string().nullable(),
  occurredAt: z.string().datetime(),
});
export type PartConsumptionView = z.infer<typeof PartConsumptionViewSchema>;

export const PartConsumptionListResponseSchema = z.object({
  data: z.array(PartConsumptionViewSchema),
});
export type PartConsumptionListResponse = z.infer<typeof PartConsumptionListResponseSchema>;

// ------------------------- Sayım (cycle count) -------------------------

export const CreateStockCountRequestSchema = z.object({
  warehouseId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});
export type CreateStockCountRequest = z.infer<typeof CreateStockCountRequestSchema>;

export const CountLineViewSchema = z.object({
  lineId: z.string().uuid(),
  countId: z.string().uuid(),
  itemId: z.string().uuid(),
  sku: z.string(),
  itemName: z.string(),
  unit: z.string(),
  lotId: z.string().uuid().nullable(),
  lotNo: z.string().nullable(),
  expectedQty: z.number(),
  countedQty: z.number().nullable(),
  deltaQty: z.number().nullable(),
  note: z.string().nullable(),
  countedByName: z.string().nullable(),
  countedAt: z.string().datetime().nullable(),
});
export type CountLineView = z.infer<typeof CountLineViewSchema>;

export const StockCountViewSchema = z.object({
  countId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  warehouseName: z.string(),
  status: StockCountStatusSchema,
  note: z.string().nullable(),
  lineCount: z.number().int().nonnegative(),
  countedLineCount: z.number().int().nonnegative(),
  /** CLOSE sonrası: üretilen ADJUSTMENT hareket sayısı. */
  adjustmentCount: z.number().int().nonnegative().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
});
export type StockCountView = z.infer<typeof StockCountViewSchema>;

export const StockCountListResponseSchema = z.object({
  data: z.array(StockCountViewSchema),
});
export type StockCountListResponse = z.infer<typeof StockCountListResponseSchema>;

export const CountLineListResponseSchema = z.object({
  data: z.array(CountLineViewSchema),
});
export type CountLineListResponse = z.infer<typeof CountLineListResponseSchema>;

/**
 * Sayım satırı gönderimi — countedQty 0+ (boş raf = 0). expectedQty
 * SUNUCUDA satır anındaki bakiyeden dondurulur (istemci güvenilmez).
 * Aynı (kalem, lot) ikinci gönderim son değeri GÜNCELLER (append yok —
 * sayım anlık gözlemdir; kapanışta tek düzeltme üretilir).
 */
export const SubmitCountLineRequestSchema = z.object({
  itemId: z.string().uuid(),
  lotId: z.string().uuid().optional(),
  countedQty: QuantityNonNegative,
  note: z.string().trim().max(500).optional(),
});
export type SubmitCountLineRequest = z.infer<typeof SubmitCountLineRequestSchema>;

/** Sayım kapanışı — gövdesiz; farklar için ADJUSTMENT hareketleri üretir. */
export const CloseStockCountRequestSchema = z.object({});
export type CloseStockCountRequest = z.infer<typeof CloseStockCountRequestSchema>;

// ------------------------- Liste sorguları -------------------------

export const StockItemListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  active: z.enum(['true', 'false']).optional(),
  trackingMode: StockTrackingModeSchema.optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type StockItemListQuery = z.infer<typeof StockItemListQuerySchema>;

export const BalanceListQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  warehouseType: WarehouseTypeSchema.optional(),
  /** Yalnız kendi araç stoğu (mobil van ekranı; VEHICLE + assignedTo=ben). */
  mine: z.enum(['true', 'false']).optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
});
export type BalanceListQuery = z.infer<typeof BalanceListQuerySchema>;

export const MovementListQuerySchema = z.object({
  itemId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  type: z.enum(['RECEIVE', 'ISSUE', 'TRANSFER', 'RETURN', 'CONSUME', 'ADJUSTMENT']).optional(),
  referenceId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
});
export type MovementListQuery = z.infer<typeof MovementListQuerySchema>;

/** Hareket/parça listesi zarfı — toplam sayılı (pano sayfalama uyumlu). */
export const MovementPageResponseSchema = z.object({
  data: z.array(MovementViewSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type MovementPageResponse = z.infer<typeof MovementPageResponseSchema>;

export const StockItemPageResponseSchema = z.object({
  data: z.array(StockItemViewSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type StockItemPageResponse = z.infer<typeof StockItemPageResponseSchema>;
