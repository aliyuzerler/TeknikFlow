import { describe, expect, it } from 'vitest';
import {
  ConsumePartRequestSchema,
  CreateMovementRequestSchema,
  CreateReservationRequestSchema,
  CreateStockCountRequestSchema,
  CreateStockItemRequestSchema,
  CreateWarehouseRequestSchema,
  PartConsumptionViewSchema,
  SubmitCountLineRequestSchema,
} from './inventory.js';
import { ExecutionReportViewSchema } from './execution.js';

/**
 * TEST-09 §2 — Faz 09 sözleşme doğrulama sınırları.
 *
 * Hareket yönü kuralları (RECEIVE/TRANSFER/ADJUSTMENT), çift hareket
 * engeli için movementKey zorunluluğu, miktar ondalık sınırı, araç deposu
 * sahiplik kuralı, sayım satırı 0-değeri kuralı ve rapor parça alanları.
 */

/** Sözleşme testleri için biçimi geçerli, tohumdan türeyen tekil UUID. */
function uid(seed: number): string {
  const hex = seed.toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
}

describe('CreateStockItemRequestSchema', () => {
  it('geçerli kalem kabul edilir; trackingMode varsayılan NONE', () => {
    const parsed = CreateStockItemRequestSchema.parse({
      sku: 'FLT-04-25',
      name: 'Hava filtresi',
      unit: 'ad',
      reorderPoint: 5,
    });
    expect(parsed.trackingMode).toBe('NONE');
    expect(parsed.reorderPoint).toBe(5);
  });

  it('4 ondalığı aşan eşik reddedilir', () => {
    expect(
      CreateStockItemRequestSchema.safeParse({
        sku: 'X-1',
        name: 'Parça',
        unit: 'ad',
        reorderPoint: 0.00001,
      }).success,
    ).toBe(false);
  });
});

describe('CreateWarehouseRequestSchema', () => {
  it('VEHICLE depo assignedToId olmadan reddedilir', () => {
    expect(
      CreateWarehouseRequestSchema.safeParse({ name: 'Teknisyen Aracı 34', type: 'VEHICLE' })
        .success,
    ).toBe(false);
    expect(
      CreateWarehouseRequestSchema.safeParse({
        name: 'Teknisyen Aracı 34',
        type: 'VEHICLE',
        assignedToId: uid(1),
      }).success,
    ).toBe(true);
  });

  it('CENTRAL depo sahiplik istemez', () => {
    expect(CreateWarehouseRequestSchema.safeParse({ name: 'Merkez Depo' }).success).toBe(true);
  });
});

describe('CreateMovementRequestSchema — yön kuralları', () => {
  const base = {
    itemId: uid(2),
    quantity: 10,
    movementKey: '0f1e2d3c-4b5a-4988-9900-aabbccddeeff',
  };

  it('RECEIVE: toWarehouse zorunlu; from varsa reddedilir', () => {
    expect(
      CreateMovementRequestSchema.safeParse({ ...base, type: 'RECEIVE', toWarehouseId: uid(3) })
        .success,
    ).toBe(true);
    expect(
      CreateMovementRequestSchema.safeParse({
        ...base,
        type: 'RECEIVE',
        toWarehouseId: uid(3),
        fromWarehouseId: uid(4),
      }).success,
    ).toBe(false);
    expect(CreateMovementRequestSchema.safeParse({ ...base, type: 'RECEIVE' }).success).toBe(
      false,
    );
  });

  it('TRANSFER: from + to zorunlu ve farklı olmalı', () => {
    expect(
      CreateMovementRequestSchema.safeParse({
        ...base,
        type: 'TRANSFER',
        fromWarehouseId: uid(3),
        toWarehouseId: uid(4),
      }).success,
    ).toBe(true);
    expect(
      CreateMovementRequestSchema.safeParse({
        ...base,
        type: 'TRANSFER',
        fromWarehouseId: uid(3),
        toWarehouseId: uid(3),
      }).success,
      'aynı depo transferi anlamsız → red',
    ).toBe(false);
  });

  it('ADJUSTMENT: tam bir depo tarafı istenir', () => {
    expect(
      CreateMovementRequestSchema.safeParse({ ...base, type: 'ADJUSTMENT', toWarehouseId: uid(3) })
        .success,
    ).toBe(true);
    expect(
      CreateMovementRequestSchema.safeParse({ ...base, type: 'ADJUSTMENT', fromWarehouseId: uid(3) })
        .success,
    ).toBe(true);
    expect(CreateMovementRequestSchema.safeParse({ ...base, type: 'ADJUSTMENT' }).success).toBe(
      false,
    );
    expect(
      CreateMovementRequestSchema.safeParse({
        ...base,
        type: 'ADJUSTMENT',
        fromWarehouseId: uid(3),
        toWarehouseId: uid(4),
      }).success,
    ).toBe(false);
  });

  it('movementKey UUID biçimi zorunludur (çift hareket engeli)', () => {
    expect(
      CreateMovementRequestSchema.safeParse({
        ...base,
        movementKey: 'cift-gonderim',
        type: 'RECEIVE',
        toWarehouseId: uid(3),
      }).success,
    ).toBe(false);
  });

  it('CONSUME genel harekette yasaktır (yalnız iş emri ucu)', () => {
    const parsed = CreateMovementRequestSchema.safeParse({
      ...base,
      type: 'CONSUME',
      fromWarehouseId: uid(3),
    });
    expect(parsed.success).toBe(false);
  });

  it('miktar pozitif ve 4 ondalıkla sınırlıdır', () => {
    expect(
      CreateMovementRequestSchema.safeParse({
        ...base,
        type: 'RECEIVE',
        toWarehouseId: uid(3),
        quantity: 0,
      }).success,
    ).toBe(false);
    expect(
      CreateMovementRequestSchema.safeParse({
        ...base,
        type: 'RECEIVE',
        toWarehouseId: uid(3),
        quantity: 1.00005,
      }).success,
    ).toBe(false);
    expect(
      CreateMovementRequestSchema.safeParse({
        ...base,
        type: 'RECEIVE',
        toWarehouseId: uid(3),
        quantity: 1.00005 - 0.00005,
      }).success,
    ).toBe(true);
  });
});

describe('CreateReservationRequestSchema', () => {
  it('rezervasyon iş emri + depo + miktar ister', () => {
    const ok = CreateReservationRequestSchema.safeParse({
      workOrderId: uid(5),
      itemId: uid(2),
      warehouseId: uid(3),
      quantity: 2.5,
    });
    expect(ok.success).toBe(true);
  });

  it('negatif veya sıfır rezervasyon reddedilir', () => {
    expect(
      CreateReservationRequestSchema.safeParse({
        workOrderId: uid(5),
        itemId: uid(2),
        warehouseId: uid(3),
        quantity: 0,
      }).success,
    ).toBe(false);
  });
});

describe('ConsumePartRequestSchema', () => {
  it('warehouseId / lotId / reservationId opsiyoneldir', () => {
    const parsed = ConsumePartRequestSchema.parse({ itemId: uid(2), quantity: 1 });
    expect(parsed.warehouseId).toBeUndefined();
    expect(parsed.lotId).toBeUndefined();
    expect(parsed.reservationId).toBeUndefined();
  });

  it('miktar sınırı uygulanır', () => {
    expect(
      ConsumePartRequestSchema.safeParse({ itemId: uid(2), quantity: -1 }).success,
    ).toBe(false);
  });
});

describe('SubmitCountLineRequestSchema', () => {
  it('sayılan miktar 0 olabilir (boş raf) — negatif olamaz', () => {
    expect(
      SubmitCountLineRequestSchema.safeParse({ itemId: uid(2), countedQty: 0 }).success,
    ).toBe(true);
    expect(
      SubmitCountLineRequestSchema.safeParse({ itemId: uid(2), countedQty: -2 }).success,
    ).toBe(false);
  });
});

describe('CreateStockCountRequestSchema', () => {
  it('depo zorunludur', () => {
    expect(CreateStockCountRequestSchema.safeParse({}).success).toBe(false);
    expect(CreateStockCountRequestSchema.safeParse({ warehouseId: uid(3) }).success).toBe(true);
  });
});

describe('ExecutionReportView — parça alanları (Faz 09 eklemesi)', () => {
  const report = {
    workOrderId: uid(6),
    workOrderNo: 'WO-2026-0001',
    subject: 'Pompa arızası',
    status: 'COMPLETED',
    priority: 'HIGH',
    customerName: 'Mega Endüstri',
    assetTag: null,
    locationName: null,
    assignedToName: null,
    scheduledStart: null,
    scheduledEnd: null,
    acceptedAt: null,
    startedAt: null,
    completedAt: null,
    closedAt: null,
    labor: { totalMinutes: 0, travelMinutes: 0, laborMinutes: 0, waitingMinutes: 0, openEntry: false },
    visits: [],
    checklist: [],
    timeEntries: [],
    media: [],
    signatures: [],
    parts: [
      {
        movementId: uid(7),
        workOrderId: uid(6),
        itemId: uid(2),
        sku: 'FLT-04-25',
        itemName: 'Hava filtresi',
        unit: 'ad',
        trackingMode: 'NONE',
        lotId: null,
        lotNo: null,
        warehouseId: uid(3),
        warehouseName: 'Teknisyen Aracı 34',
        quantity: 2,
        unitCostMinor: 1250,
        totalCostMinor: 2500,
        note: null,
        actorId: uid(1),
        actorName: 'Ali Teknisyen',
        occurredAt: '2026-11-10T10:00:00.000Z',
      },
    ],
    partsCostMinor: 2500,
    requiredChecklistRemaining: 0,
    generatedAt: '2026-11-10T11:00:00.000Z',
  };

  it('parts + partsCostMinor rapor şemasını geçer', () => {
    const parsed = ExecutionReportViewSchema.safeParse(report);
    expect(parsed.success).toBe(true);
  });

  it('parça görünümü tüketim maliyetini taşır', () => {
    const view = PartConsumptionViewSchema.parse(report.parts[0]);
    expect(view.totalCostMinor).toBe(2500);
    expect(view.trackingMode).toBe('NONE');
  });

  it('partsCostMinor negatif olamaz', () => {
    expect(
      ExecutionReportViewSchema.safeParse({ ...report, partsCostMinor: -1 }).success,
    ).toBe(false);
  });
});
