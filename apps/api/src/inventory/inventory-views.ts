import type {
  BalanceView,
  BinView,
  CountLineView,
  MovementView,
  PartConsumptionView,
  ReservationView,
  StockCountView,
  StockItemView,
  WarehouseView,
} from '@teknikflow/contracts';
import {
  availableOf,
  consumeCostMinor,
  isLowStock,
  qtyToView,
  reservationStatusFor,
  type StockMovementType,
} from './inventory-engine.js';

/**
 * Faz 09 — görünüm eşlemeleri (SAF). Prisma satırlarını sözleşme
 * görünümlerine çevirir; Decimal alanlar 4 ondalık görünüme temizlenir.
 * inventory.service, work-order-parts.service ve execution raporu aynı
 * eşleyicileri kullanır (rapor ↔ uçlar görünüm bütünlüğü).
 */

// ------------------------- Satır tipleri (yapısal) -------------------------

export interface StockItemRow {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  description: string | null;
  unit: string;
  trackingMode: 'NONE' | 'LOT' | 'SERIAL';
  reorderPoint: { toNumber(): number } | number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WarehouseRow {
  id: string;
  name: string;
  type: 'CENTRAL' | 'BRANCH' | 'VEHICLE';
  branchId: string | null;
  assignedToId: string | null;
  active: boolean;
  createdAt: Date;
  branch?: { name: string } | null;
  assignedTo?: { displayName: string } | null;
}

export interface BinRow {
  id: string;
  warehouseId: string;
  code: string;
  note: string | null;
}

export interface MovementRow {
  id: string;
  tenantId: string;
  stockItemId: string;
  lotId: string | null;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  movementType: StockMovementType;
  quantity: { toNumber(): number } | number;
  quantityDelta: { toNumber(): number } | number;
  referenceType: string | null;
  referenceId: string | null;
  movementKey: string | null;
  unitCostMinor: number | null;
  note: string | null;
  actorId: string;
  occurredAt: Date;
  stockItem: { sku: string; name: string; unit: string; trackingMode: 'NONE' | 'LOT' | 'SERIAL' };
  lot?: { lotNo: string; expiresAt: Date | null } | null;
  fromWarehouse?: { name: string } | null;
  toWarehouse?: { name: string } | null;
  actor?: { displayName: string } | null;
}

export interface BalanceRow {
  id: string;
  warehouseId: string;
  stockItemId: string;
  lotId: string | null;
  onHand: { toNumber(): number } | number;
  reservedQty: { toNumber(): number } | number;
  updatedAt: Date;
  stockItem: {
    sku: string;
    name: string;
    unit: string;
    trackingMode: 'NONE' | 'LOT' | 'SERIAL';
    reorderPoint: { toNumber(): number } | number;
    active: boolean;
  };
  warehouse: { name: string; type: 'CENTRAL' | 'BRANCH' | 'VEHICLE' };
  lot?: { lotNo: string; expiresAt: Date | null } | null;
}

export interface ReservationRow {
  id: string;
  workOrderId: string;
  stockItemId: string;
  warehouseId: string;
  lotId: string | null;
  reservedQty: { toNumber(): number } | number;
  consumedQty: { toNumber(): number } | number;
  status: 'ACTIVE' | 'PARTIALLY_CONSUMED' | 'CONSUMED' | 'RELEASED';
  note: string | null;
  createdById: string | null;
  createdAt: Date;
  stockItem: { sku: string; name: string; unit: string };
  workOrder: { workOrderNo: string };
  warehouse: { name: string };
  lot?: { lotNo: string } | null;
  createdBy?: { displayName: string } | null;
}

/** CONSUME hareket satırı — iş emri parçası (referans work_order). */
export interface PartConsumptionRow {
  id: string;
  stockItemId: string;
  lotId: string | null;
  fromWarehouseId: string | null;
  quantity: { toNumber(): number } | number;
  unitCostMinor: number | null;
  note: string | null;
  actorId: string;
  occurredAt: Date;
  referenceId: string | null;
  stockItem: { sku: string; name: string; unit: string; trackingMode: 'NONE' | 'LOT' | 'SERIAL' };
  lot?: { lotNo: string } | null;
  fromWarehouse?: { name: string } | null;
  actor?: { displayName: string } | null;
}

export interface StockCountRow {
  id: string;
  warehouseId: string;
  status: 'OPEN' | 'CLOSED';
  note: string | null;
  createdById: string | null;
  closedAt: Date | null;
  createdAt: Date;
  warehouse: { name: string };
  createdBy?: { displayName: string } | null;
  lines?: Array<{
    countedQty: { toNumber(): number } | number | null;
    deltaQty: { toNumber(): number } | number | null;
  }>;
}

export interface CountLineRow {
  id: string;
  countId: string;
  stockItemId: string;
  lotId: string | null;
  expectedQty: { toNumber(): number } | number;
  countedQty: { toNumber(): number } | number | null;
  deltaQty: { toNumber(): number } | number | null;
  note: string | null;
  countedAt: Date | null;
  stockItem: { sku: string; name: string; unit: string };
  lot?: { lotNo: string } | null;
  countedBy?: { displayName: string } | null;
}

const dec = (value: { toNumber(): number } | number): number =>
  typeof value === 'number' ? value : value.toNumber();

// ------------------------- Eşleyiciler -------------------------

export function toStockItemView(item: StockItemRow, totalOnHand: number): StockItemView {
  return {
    itemId: item.id,
    sku: item.sku,
    name: item.name,
    description: item.description,
    unit: item.unit,
    trackingMode: item.trackingMode,
    reorderPoint: qtyToView(dec(item.reorderPoint)),
    active: item.active,
    totalOnHand: qtyToView(totalOnHand),
    lowStock: isLowStock(item.active, totalOnHand, dec(item.reorderPoint)),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toWarehouseView(warehouse: WarehouseRow): WarehouseView {
  return {
    warehouseId: warehouse.id,
    name: warehouse.name,
    type: warehouse.type,
    branchId: warehouse.branchId,
    branchName: warehouse.branch?.name ?? null,
    assignedToId: warehouse.assignedToId,
    assignedToName: warehouse.assignedTo?.displayName ?? null,
    active: warehouse.active,
    createdAt: warehouse.createdAt.toISOString(),
  };
}

export function toBinView(bin: BinRow): BinView {
  return {
    binId: bin.id,
    warehouseId: bin.warehouseId,
    code: bin.code,
    note: bin.note,
  };
}

export function toMovementView(row: MovementRow): MovementView {
  return {
    movementId: row.id,
    itemId: row.stockItemId,
    sku: row.stockItem.sku,
    itemName: row.stockItem.name,
    unit: row.stockItem.unit,
    trackingMode: row.stockItem.trackingMode,
    lotId: row.lotId,
    lotNo: row.lot?.lotNo ?? null,
    movementType: row.movementType,
    quantity: qtyToView(dec(row.quantity)),
    quantityDelta: qtyToView(dec(row.quantityDelta)),
    fromWarehouseId: row.fromWarehouseId,
    fromWarehouseName: row.fromWarehouse?.name ?? null,
    toWarehouseId: row.toWarehouseId,
    toWarehouseName: row.toWarehouse?.name ?? null,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    unitCostMinor: row.unitCostMinor,
    note: row.note,
    actorId: row.actorId,
    actorName: row.actor?.displayName ?? null,
    movementKey: row.movementKey,
    occurredAt: row.occurredAt.toISOString(),
  };
}

export function toBalanceView(row: BalanceRow): BalanceView {
  const onHand = dec(row.onHand);
  const reserved = dec(row.reservedQty);
  return {
    itemId: row.stockItemId,
    sku: row.stockItem.sku,
    itemName: row.stockItem.name,
    unit: row.stockItem.unit,
    trackingMode: row.stockItem.trackingMode,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    warehouseType: row.warehouse.type,
    lotId: row.lotId,
    lotNo: row.lot?.lotNo ?? null,
    expiresAt: row.lot?.expiresAt?.toISOString() ?? null,
    onHand: qtyToView(onHand),
    reservedQty: qtyToView(reserved),
    available: qtyToView(availableOf(onHand, reserved)),
    lowStock: isLowStock(row.stockItem.active, onHand, dec(row.stockItem.reorderPoint)),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toReservationView(row: ReservationRow): ReservationView {
  const reserved = dec(row.reservedQty);
  const consumed = dec(row.consumedQty);
  return {
    reservationId: row.id,
    workOrderId: row.workOrderId,
    workOrderNo: row.workOrder.workOrderNo,
    itemId: row.stockItemId,
    sku: row.stockItem.sku,
    itemName: row.stockItem.name,
    unit: row.stockItem.unit,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    lotId: row.lotId,
    lotNo: row.lot?.lotNo ?? null,
    reservedQty: qtyToView(reserved),
    consumedQty: qtyToView(consumed),
    status: row.status === 'RELEASED' ? 'RELEASED' : reservationStatusFor(reserved, consumed),
    note: row.note,
    createdById: row.createdById,
    createdByName: row.createdBy?.displayName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Parça tüketimi görünümü — iş emri ucu, rapor ve mobil aynı şekli alır. */
export function toPartConsumptionView(row: PartConsumptionRow): PartConsumptionView {
  const quantity = dec(row.quantity);
  return {
    movementId: row.id,
    workOrderId: row.referenceId ?? '',
    itemId: row.stockItemId,
    sku: row.stockItem.sku,
    itemName: row.stockItem.name,
    unit: row.stockItem.unit,
    trackingMode: row.stockItem.trackingMode,
    lotId: row.lotId,
    lotNo: row.lot?.lotNo ?? null,
    warehouseId: row.fromWarehouseId ?? '',
    warehouseName: row.fromWarehouse?.name ?? null,
    quantity: qtyToView(quantity),
    unitCostMinor: row.unitCostMinor,
    totalCostMinor: consumeCostMinor(quantity, row.unitCostMinor),
    note: row.note,
    actorId: row.actorId,
    actorName: row.actor?.displayName ?? null,
    occurredAt: row.occurredAt.toISOString(),
  };
}

export function toStockCountView(row: StockCountRow): StockCountView {
  const lines = row.lines ?? [];
  return {
    countId: row.id,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    status: row.status,
    note: row.note,
    lineCount: lines.length,
    countedLineCount: lines.filter((line) => line.countedQty !== null).length,
    adjustmentCount:
      row.status === 'CLOSED'
        ? lines.filter((line) => line.deltaQty !== null && Number(line.deltaQty) !== 0).length
        : null,
    createdByName: row.createdBy?.displayName ?? null,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

export function toCountLineView(row: CountLineRow): CountLineView {
  return {
    lineId: row.id,
    countId: row.countId,
    itemId: row.stockItemId,
    sku: row.stockItem.sku,
    itemName: row.stockItem.name,
    unit: row.stockItem.unit,
    lotId: row.lotId,
    lotNo: row.lot?.lotNo ?? null,
    expectedQty: qtyToView(dec(row.expectedQty)),
    countedQty: row.countedQty === null ? null : qtyToView(dec(row.countedQty)),
    deltaQty: row.deltaQty === null ? null : qtyToView(dec(row.deltaQty)),
    note: row.note,
    countedByName: row.countedBy?.displayName ?? null,
    countedAt: row.countedAt?.toISOString() ?? null,
  };
}
