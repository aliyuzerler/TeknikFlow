import { createMemoryCacheDriver } from './driver';
import { createWorkOrderCache } from './work-order-cache';
import { createOutboxRepo, type OutboxOperation } from './outbox-repo';
import { nextBackoffMs } from '../sync/sync-service';
import type { WorkOrderView } from '@teknikflow/contracts';

/**
 * Faz 07 — önbellek mantığı testleri (bellek-içi sürücü ile; SQL değil,
 * DAVRANIŞ kanıtlanır — replaceAll/list/get temizliği, outbox durum makinesi,
 * backoff üsteli).
 */

function order(overrides: Partial<WorkOrderView> = {}): WorkOrderView {
  const now = new Date().toISOString();
  return {
    workOrderId: '11111111-1111-4111-8111-000000000001',
    workOrderNo: 'WO-2026-0001',
    requestId: null,
    customerId: '22222222-2222-4222-8222-222222222222',
    customerName: 'Mega Otel',
    assetId: null,
    assetTag: 'AST-000001',
    serviceLocationId: null,
    locationName: null,
    branchId: null,
    branchName: null,
    type: 'CORRECTIVE',
    priority: 'HIGH',
    status: 'ASSIGNED',
    subject: 'Klima arıza',
    description: null,
    scheduledStart: null,
    scheduledEnd: null,
    assignedToId: 'u1',
    assignedToName: 'Ahmet',
    acceptedAt: null,
    startedAt: null,
    completedAt: null,
    closedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    slaDueAt: null,
    slaBreached: false,
    slaAtRisk: false,
    scheduleOverrideReason: null,
    version: 1,
    createdById: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('work-order-cache', () => {
  it('replaceAll liste kurar; farklı kiracı satırları temizlenir (kiracı değişimi)', async () => {
    const driver = createMemoryCacheDriver();
    const cache = createWorkOrderCache(driver);
    const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await cache.replaceAllForTenant('u1', tenantA, [order()]);
    await cache.replaceAllForTenant('u1', tenantB, [
      order({ workOrderId: '11111111-1111-4111-8111-000000000002', workOrderNo: 'WO-2026-0002' }),
    ]);
    const rows = await cache.list('u1', tenantB);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(tenantB);
    expect(rows[0]?.payload.workOrderNo).toBe('WO-2026-0002');
    // lastSyncAt tenant bazlı yazılır.
    expect(await cache.lastSyncAt('u1', tenantB)).not.toBeNull();
    expect(await cache.lastSyncAt('u1', tenantA)).toBeNull();
  });

  it('get bulur; olmayan kimlik null döner (sızıntı yok)', async () => {
    const driver = createMemoryCacheDriver();
    const cache = createWorkOrderCache(driver);
    const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await cache.replaceAllForTenant('u1', tenant, [order()]);
    expect(await cache.get('u1', '11111111-1111-4111-8111-000000000001')).not.toBeNull();
    expect(await cache.get('u1', '99999999-9999-4999-8999-999999999999')).toBeNull();
    expect(await cache.get('u2', '11111111-1111-4111-8111-000000000001')).toBeNull();
  });

  it('clear kullanıcı bazlı siler; başkası etkilenmez', async () => {
    const driver = createMemoryCacheDriver();
    const cache = createWorkOrderCache(driver);
    const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await cache.replaceAllForTenant('u1', tenant, [order()]);
    await cache.replaceAllForTenant('u2', tenant, [
      order({ workOrderId: '11111111-1111-4111-8111-000000000003' }),
    ]);
    await cache.clear('u1');
    expect(await cache.list('u1', tenant)).toHaveLength(0);
    expect(await cache.list('u2', tenant)).toHaveLength(1);
  });
});

describe('outbox-repo', () => {
  const op = (userId = 'u1', at = '2026-11-09T10:00:00.000Z'): OutboxOperation => ({
    createdAt: at,
    idempotencyKey: 'key-1',
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId,
    entityId: '11111111-1111-4111-8111-000000000001',
    baseVersion: 3,
    operation: 'work_order.note_append',
    payload: { note: 'kontrol edildi' },
  });

  it('enqueue → pending → markDone yaşam döngüsü', async () => {
    const repo = createOutboxRepo(createMemoryCacheDriver());
    const row = await repo.enqueue(op());
    expect(row.state).toBe('queued');
    expect(await repo.pending('u1')).toHaveLength(1);
    await repo.markSyncing(row.id);
    expect(await repo.pending('u1')).toHaveLength(0); // syncing gönderilemez
    await repo.markDone(row.id);
    expect(await repo.countPending('u1')).toBe(0);
  });

  it('markFailed attempts artırır ve backoff zamanlar; süre geçince tekrar pending', async () => {
    const driver = createMemoryCacheDriver();
    const repo = createOutboxRepo(driver);
    const row = await repo.enqueue(op());
    const next = new Date(Date.now() + 10_000).toISOString();
    await repo.markFailed(row.id, 'ağ yok', next);
    // Backoff sürüyor: hemen pending DEĞİL.
    expect(await repo.pending('u1')).toHaveLength(0);
    // Satır durumu dürüst: failed + attempts=1 + hata kaydı.
    const stored = await driver
      .collection<{ attempts: number; state: string; lastError: string }>('sync_outbox')
      .get(row.id);
    expect(stored).toMatchObject({ attempts: 1, state: 'failed', lastError: 'ağ yok' });
    // Süre geçince tekrar gönderilebilir:
    const later = await repo.pending('u1', new Date(Date.now() + 20_000));
    expect(later).toHaveLength(1);
    expect(later[0]?.attempts).toBe(1);
  });

  it('pending sıralama oluşturma zamanına göre (FIFO)', async () => {
    const repo = createOutboxRepo(createMemoryCacheDriver());
    await repo.enqueue(op('u1', '2026-11-09T10:01:00.000Z'));
    await repo.enqueue({ ...op('u1', '2026-11-09T10:00:00.000Z'), idempotencyKey: 'key-0' });
    const rows = await repo.pending('u1');
    expect(rows.map((row) => row.idempotencyKey)).toEqual(['key-0', 'key-1']);
  });

  it('clear kullanıcı bazlı; diğer kullanıcı satırları kalır', async () => {
    const repo = createOutboxRepo(createMemoryCacheDriver());
    await repo.enqueue(op('u1'));
    await repo.enqueue(op('u2', '2026-11-09T11:00:00.000Z'));
    await repo.clear('u1');
    expect(await repo.countPending('u1')).toBe(0);
    expect(await repo.countPending('u2')).toBe(1);
  });
});

describe('nextBackoffMs', () => {
  it('üstel artar ve 5 dakikada tavanlar', () => {
    expect(nextBackoffMs(0)).toBe(5_000);
    expect(nextBackoffMs(1)).toBe(10_000);
    expect(nextBackoffMs(2)).toBe(20_000);
    expect(nextBackoffMs(4)).toBe(80_000);
    expect(nextBackoffMs(10)).toBe(5 * 60_000);
    expect(nextBackoffMs(20)).toBe(5 * 60_000);
  });
});
