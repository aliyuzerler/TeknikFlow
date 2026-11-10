import { createMemoryCacheDriver } from '../cache/driver';
import { createOutboxRepo } from '../cache/outbox-repo';
import type { MobileApiClient } from '../api/client';
import { createExecutionActions, newIdempotencyKey } from './execution-actions';

/**
 * TEST-08 §7 — saha eylemleri: her mutasyon outbox'a girer (offline-first),
 * idempotency anahtarı üretilir, izin redli GPS'te manuel onay istenir.
 */

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = '11111111-1111-4111-8111-000000000001';
const WORK_ORDER = '22222222-2222-4222-8222-222222222222';

function makeDeps(online: boolean) {
  const driver = createMemoryCacheDriver();
  const outbox = createOutboxRepo(driver);
  const deps = {
    api: {} as MobileApiClient,
    outbox,
    identity: async () => ({ userId: USER, tenantId: TENANT }),
    isOnline: () => online,
    drain: jest.fn(async () => ({ sent: online ? 1 : 0, failed: 0 })),
    captureLocation: jest.fn(async () => ({
      granted: true as const,
      fix: {
        latitude: 41.0082,
        longitude: 28.9784,
        accuracyMeters: 12.5,
        timestampMs: Date.parse('2026-11-10T09:30:00.000Z'),
      },
    })),
    now: () => new Date('2026-11-10T09:00:00.000Z'),
  };
  return deps;
}

describe('newIdempotencyKey', () => {
  it('UUID v4 biçimi üretir ve tektir', () => {
    const first = newIdempotencyKey();
    const second = newIdempotencyKey();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first).not.toBe(second);
  });
});

describe('createExecutionActions', () => {
  it('çevrimiçi transition: kuyruğa girer + boşaltma tetiklenir', async () => {
    const deps = makeDeps(true);
    const actions = createExecutionActions(deps);
    const outcome = await actions.transition(WORK_ORDER, 'IN_PROGRESS');
    expect(outcome).toEqual({ ok: true, queued: true, sent: true });
    expect(deps.drain).toHaveBeenCalledTimes(1);
    const pending = await deps.outbox.pending(USER);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.operation).toBe('work_order.transition');
    expect(pending[0]!.entityId).toBe(WORK_ORDER);
    expect(pending[0]!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(pending[0]!.payload).toEqual({ to: 'IN_PROGRESS' });
  });

  it('çevrimdışı transition: kuyruğa girer, boşaltma YOK', async () => {
    const deps = makeDeps(false);
    const actions = createExecutionActions(deps);
    const outcome = await actions.transition(WORK_ORDER, 'ACCEPTED');
    expect(outcome).toEqual({ ok: true, queued: true, sent: false });
    expect(deps.drain).not.toHaveBeenCalled();
    expect(await deps.outbox.countPending(USER)).toBe(1);
  });

  it('GPS varışı: konumla kuyruğa girer (kaynak GPS + doğruluk)', async () => {
    const deps = makeDeps(true);
    const actions = createExecutionActions(deps);
    const outcome = await actions.arrive(WORK_ORDER);
    expect(outcome).toEqual({ ok: true, queued: true, sent: true });
    const pending = await deps.outbox.pending(USER);
    expect(pending[0]!.operation).toBe('work_order.arrive');
    expect(pending[0]!.payload).toEqual({
      location: {
        latitude: 41.0082,
        longitude: 28.9784,
        accuracyMeters: 12.5,
        capturedAt: '2026-11-10T09:30:00.000Z',
        source: 'GPS',
      },
    });
  });

  it('izin reddi: manuel onay istenir (needsManualArrival)', async () => {
    const deps = makeDeps(true);
    deps.captureLocation = jest.fn(async () => ({
      granted: false,
    })) as unknown as typeof deps.captureLocation;
    const actions = createExecutionActions(deps);
    const outcome = await actions.arrive(WORK_ORDER);
    expect(outcome).toEqual({
      ok: false,
      needsManualArrival: true,
      message: 'Konum izni reddedildi — manuel onayla devam edin',
    });
    expect(await deps.outbox.countPending(USER)).toBe(0);
  });

  it('manuel onaylı varış: nedenle kuyruğa girer (koordinatsız)', async () => {
    const deps = makeDeps(false);
    const actions = createExecutionActions(deps);
    const outcome = await actions.arrive(WORK_ORDER, 'Konum izni reddedildi');
    expect(outcome).toEqual({ ok: true, queued: true, sent: false });
    const pending = await deps.outbox.pending(USER);
    expect(pending[0]!.payload).toEqual({
      location: {
        capturedAt: '2026-11-10T09:00:00.000Z', // now() enjeksiyonu
        source: 'MANUAL',
        manualReason: 'Konum izni reddedildi',
      },
    });
  });

  it('checklist tamamlama ve imza yakalama kuyruğa girer', async () => {
    const deps = makeDeps(false);
    const actions = createExecutionActions(deps);
    await actions.toggleChecklistItem(WORK_ORDER, {
      itemId: 'item-9',
      workOrderId: WORK_ORDER,
      label: 'Test',
      detail: null,
      required: true,
      position: 0,
      done: false,
      doneAt: null,
      doneById: null,
      doneByName: null,
      note: null,
      createdAt: '2026-11-10T08:00:00.000Z',
      updatedAt: '2026-11-10T08:00:00.000Z',
    });
    await actions.captureSignature(WORK_ORDER, {
      role: 'CUSTOMER',
      signerName: 'Ayşe Yılmaz',
      signedAt: '2026-11-10T12:00:00.000Z',
      strokes: [
        [
          { x: 0.1, y: 0.2, t: 0 },
          { x: 0.2, y: 0.25, t: 40 },
          { x: 0.3, y: 0.3, t: 80 },
          { x: 0.4, y: 0.32, t: 120 },
        ],
      ],
    });
    const pending = await deps.outbox.pending(USER);
    // Aynı createdAt (sabit now) → sıra garanti değil; küme karşılaştır.
    expect(pending.map((row) => row.operation).sort()).toEqual([
      'checklist.complete',
      'signature.capture',
    ]);
  });

  it('oturum yoksa eylem reddedilir (kuyruğa hiçbir şey girmez)', async () => {
    const deps = makeDeps(true);
    deps.identity = (async (): Promise<{ userId: string; tenantId: string } | null> =>
      null) as unknown as typeof deps.identity;
    const actions = createExecutionActions(deps);
    const outcome = await actions.transition(WORK_ORDER, 'ACCEPTED');
    expect(outcome).toEqual({ ok: false, message: 'Oturum kapalı — eylem kaydedilemedi' });
    expect(await deps.outbox.countPending(USER)).toBe(0);
  });

  it('süre başlat/durdur kuyruğa girer', async () => {
    const deps = makeDeps(false);
    const actions = createExecutionActions(deps);
    await actions.startLabor(WORK_ORDER);
    await actions.stopLabor(WORK_ORDER, 'te-1');
    const pending = await deps.outbox.pending(USER);
    // Aynı createdAt (sabit now) → sıra garanti değil; küme karşılaştır.
    expect(pending.map((row) => row.operation).sort()).toEqual([
      'time_entry.start',
      'time_entry.stop',
    ]);
    const startRow = pending.find((row) => row.operation === 'time_entry.start');
    const stopRow = pending.find((row) => row.operation === 'time_entry.stop');
    expect(startRow!.payload).toEqual({
      type: 'LABOR',
      startedAt: '2026-11-10T09:00:00.000Z',
    });
    expect(stopRow!.payload).toEqual({
      timeEntryId: 'te-1',
      endedAt: '2026-11-10T09:00:00.000Z',
    });
  });
});
