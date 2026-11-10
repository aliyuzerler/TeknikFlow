import { createSyncService, type SyncServiceDeps } from './sync-service';
import { createMemoryCacheDriver } from '../cache/driver';
import { createWorkOrderCache } from '../cache/work-order-cache';
import { createOutboxRepo } from '../cache/outbox-repo';
import { createMemoryTokenStore } from '../session/token-store';
import { createMobileApiClient, type MobileApiClient } from '../api/client';
import type { WorkOrderListResponse } from '@teknikflow/contracts';

/**
 * Faz 07 — senkron servisi testleri: çevrimdışı çekmez, çekme önbelleği
 * kurar, hata durumunu dürüst bildirir; outbox boşaltması boş sette no-op.
 */

function stubApi(handler: (url: string) => { status: number; body?: unknown }): MobileApiClient {
  global.fetch = jest.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const response = handler(url);
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return createMobileApiClient({ baseUrl: 'http://api.test', tokens: createMemoryTokenStore() });
}

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = '11111111-1111-4111-8111-000000000001';

function makeDeps(api: MobileApiClient, online = true): SyncServiceDeps {
  const driver = createMemoryCacheDriver();
  const identity = { userId: USER, tenantId: TENANT };
  return {
    api,
    workOrderCache: createWorkOrderCache(driver),
    outbox: createOutboxRepo(driver),
    isOnline: () => online,
    getIdentity: async () => identity,
  };
}

function listPage(count: number, total = count): { status: number; body: WorkOrderListResponse } {
  return {
    status: 200,
    body: {
      data: Array.from({ length: count }, (_, index) => ({
        workOrderId: `11111111-1111-4111-8111-00000000000${index}`,
        workOrderNo: `WO-2026-000${index + 1}`,
        requestId: null,
        customerId: '22222222-2222-4222-8222-222222222222',
        customerName: `Müşteri ${index}`,
        assetId: null,
        assetTag: null,
        serviceLocationId: null,
        locationName: null,
        branchId: null,
        branchName: null,
        type: 'CORRECTIVE' as const,
        priority: 'MEDIUM' as const,
        status: 'ASSIGNED' as const,
        subject: `İş ${index}`,
        description: null,
        scheduledStart: null,
        scheduledEnd: null,
        assignedToId: '11111111-1111-4111-8111-000000000001',
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      pageInfo: { total, page: 1, pageSize: 50 },
    },
  };
}

describe('sync-service.pullWorkOrders', () => {
  it('çevrimdışıysa istek hiç açılmaz (offline outcome)', async () => {
    let requests = 0;
    const api = stubApi(() => {
      requests += 1;
      return listPage(0);
    });
    const service = createSyncService(makeDeps(api, false));
    const outcome = await service.pullWorkOrders();
    expect(outcome).toMatchObject({ ok: false, reason: 'offline' });
    expect(requests).toBe(0);
  });

  it('çekme önbelleği kurar; liste okunur', async () => {
    const api = stubApi((url) => {
      if (url.includes('/work-orders')) return listPage(2);
      return { status: 404 };
    });
    const deps = makeDeps(api);
    const service = createSyncService(deps);
    const outcome = await service.pullWorkOrders();
    expect(outcome).toMatchObject({ ok: true, pulled: 2 });
    const rows = await deps.workOrderCache.list(USER, TENANT);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.payload.workOrderNo).toBe('WO-2026-0001');
    expect(await deps.workOrderCache.lastSyncAt(USER, TENANT)).not.toBeNull();
  });

  it("HTTP hatası cache'i bozmadan error döner (önceki veri korunur)", async () => {
    let failing = false;
    const api = stubApi((url) => {
      if (!url.includes('/work-orders')) return { status: 404 };
      if (failing)
        return {
          status: 500,
          body: { code: 'X', message: 'sunucu hatası', requestId: 'r', statusCode: 500 },
        };
      return listPage(1);
    });
    const deps = makeDeps(api);
    const service = createSyncService(deps);
    // İlk çekme başarılı → cache'te 1 satır.
    expect(await service.pullWorkOrders()).toMatchObject({ ok: true, pulled: 1 });
    // Sunucu 500'e döner → hata dürüst, cache BOZULMAZ.
    failing = true;
    const outcome = await service.pullWorkOrders();
    expect(outcome).toMatchObject({ ok: false, reason: 'http' });
    const rows = await deps.workOrderCache.list(USER, TENANT);
    expect(rows).toHaveLength(1);
  });

  it('oturum yoksa http/401 outcome döner', async () => {
    const api = stubApi(() => listPage(0));
    const deps: SyncServiceDeps = { ...makeDeps(api), getIdentity: async () => null };
    const outcome = await createSyncService(deps).pullWorkOrders();
    expect(outcome).toMatchObject({ ok: false, reason: 'http' });
  });
});

describe('sync-service.drainOutbox', () => {
  it('bilinmeyen işlem kalıcı reddi: failed=1, satır 24 saat donar', async () => {
    const api = stubApi(() => ({ status: 200 }));
    const deps = makeDeps(api);
    const service = createSyncService(deps);
    await deps.outbox.enqueue({
      createdAt: new Date().toISOString(),
      idempotencyKey: 'k1',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: USER,
      entityId: 'e1',
      baseVersion: 1,
      operation: 'work_order.note_append', // Faz 08 kataloğunda yok
      payload: {},
    });
    const result = await service.drainOutbox();
    expect(result).toEqual({ sent: 0, failed: 1 });
    // Satır kuyrukta kalır ama nextAttemptAt 24 saat ileri — yeniden denenmez.
    const pending = await deps.outbox.pending(USER, new Date(Date.now() + 23 * 3600_000));
    expect(pending).toHaveLength(0);
    expect(await deps.outbox.countPending(USER)).toBe(1);
  });
});
