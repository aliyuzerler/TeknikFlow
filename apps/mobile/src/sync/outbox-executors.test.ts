import type { MobileApiClient } from '../api/client';
import type { OutboxOperation } from '../cache/outbox-repo';
import {
  arriveExecutor,
  checklistCompleteExecutor,
  executorFor,
  partsConsumeExecutor,
  signatureExecutor,
  timeEntryStartExecutor,
  transitionExecutor,
} from './outbox-executors';

/**
 * TEST-08 §7 — outbox yürütücüleri: idempotency anahtarı taşınır, ağ hatası
 * yeniden denenebilir, kalıcı 4xx reddi dondurulur (sahte API ile).
 */

type AnyRecord = Record<string, unknown>;

function fakeApi(overrides: AnyRecord): MobileApiClient {
  return {
    transitionWorkOrder: jest.fn(async () => ({ ok: true, data: {}, replayed: false })),
    arriveOnSite: jest.fn(async () => ({ ok: true, data: {}, replayed: false })),
    completeChecklistItem: jest.fn(async () => ({ ok: true, data: {}, replayed: false })),
    addChecklistItem: jest.fn(async () => ({ ok: true, data: {}, replayed: false })),
    createTimeEntry: jest.fn(async () => ({ ok: true, data: {}, replayed: false })),
    stopTimeEntry: jest.fn(async () => ({ ok: true, data: {}, replayed: false })),
    captureSignature: jest.fn(async () => ({ ok: true, data: {}, replayed: false })),
    consumePart: jest.fn(async () => ({ ok: true, data: {}, replayed: false })),
    ...overrides,
  } as unknown as MobileApiClient;
}

const BASE_OP: OutboxOperation = {
  createdAt: '2026-11-10T09:00:00.000Z',
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: '11111111-1111-4111-8111-000000000001',
  entityId: 'e1',
  baseVersion: 0,
  operation: 'work_order.transition',
  payload: { to: 'IN_PROGRESS' },
};

describe('executorFor', () => {
  it('katalogdaki işlemler yürütücü bulur; bilinmeyen undefined', () => {
    for (const operation of [
      'work_order.transition',
      'work_order.arrive',
      'checklist.complete',
      'checklist.add',
      'time_entry.start',
      'time_entry.stop',
      'signature.capture',
    ]) {
      expect(executorFor(operation)).toBeDefined();
    }
    expect(executorFor('work_order.note_append')).toBeUndefined();
  });
});

describe('transitionExecutor', () => {
  it('başarı: idempotency anahtarı API çağrısına geçer', async () => {
    const transitionWorkOrder = jest.fn(async () => ({ ok: true, data: {}, replayed: true }));
    const api = fakeApi({ transitionWorkOrder });
    const outcome = await transitionExecutor(api, BASE_OP);
    expect(outcome).toEqual({ ok: true, replayed: true });
    expect(transitionWorkOrder).toHaveBeenCalledWith(
      'e1',
      { to: 'IN_PROGRESS' },
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('ağ hatası → yeniden denenebilir', async () => {
    const api = fakeApi({
      transitionWorkOrder: jest.fn(async () => ({
        ok: false,
        error: { kind: 'network', message: 'Ağa ulaşılamadı' },
      })),
    });
    const outcome = await transitionExecutor(api, BASE_OP);
    expect(outcome).toMatchObject({ ok: false, retryable: true });
  });

  it('durum makinesi reddi (409) → kalıcı (yeniden deneme yok)', async () => {
    const api = fakeApi({
      transitionWorkOrder: jest.fn(async () => ({
        ok: false,
        error: { kind: 'http', statusCode: 409, message: 'INVALID_TRANSITION' },
      })),
    });
    const outcome = await transitionExecutor(api, BASE_OP);
    expect(outcome).toMatchObject({ ok: false, retryable: false });
  });

  it('5xx → yeniden denenebilir', async () => {
    const api = fakeApi({
      transitionWorkOrder: jest.fn(async () => ({
        ok: false,
        error: { kind: 'http', statusCode: 503, message: 'SERVICE_UNAVAILABLE' },
      })),
    });
    const outcome = await transitionExecutor(api, BASE_OP);
    expect(outcome).toMatchObject({ ok: false, retryable: true });
  });
});

describe('arriveExecutor', () => {
  it('konumla ON_SITE geçişi gönderilir', async () => {
    const arriveOnSite = jest.fn(async () => ({ ok: true, data: {}, replayed: false }));
    const api = fakeApi({ arriveOnSite });
    const outcome = await arriveExecutor(api, {
      ...BASE_OP,
      operation: 'work_order.arrive',
      payload: {
        location: {
          capturedAt: '2026-11-10T09:30:00.000Z',
          source: 'MANUAL',
          manualReason: 'Konum izni reddedildi',
        },
      },
    });
    expect(outcome).toEqual({ ok: true, replayed: false });
    expect(arriveOnSite).toHaveBeenCalledWith(
      'e1',
      {
        capturedAt: '2026-11-10T09:30:00.000Z',
        source: 'MANUAL',
        manualReason: 'Konum izni reddedildi',
      },
      '11111111-1111-4111-8111-111111111111',
    );
  });
});

describe('checklistCompleteExecutor', () => {
  it('madde kimliği + done bayrağı taşınır', async () => {
    const completeChecklistItem = jest.fn(async () => ({ ok: true, data: {}, replayed: false }));
    const api = fakeApi({ completeChecklistItem });
    await checklistCompleteExecutor(api, {
      ...BASE_OP,
      operation: 'checklist.complete',
      payload: { itemId: 'item-1', done: true, note: 'Ölçüm tamam' },
    });
    expect(completeChecklistItem).toHaveBeenCalledWith(
      'e1',
      'item-1',
      { done: true, note: 'Ölçüm tamam' },
      '11111111-1111-4111-8111-111111111111',
    );
  });
});

describe('timeEntryStartExecutor', () => {
  it('başlangıç kaydı tür ve zamanla gönderilir', async () => {
    const createTimeEntry = jest.fn(async () => ({ ok: true, data: {}, replayed: false }));
    const api = fakeApi({ createTimeEntry });
    await timeEntryStartExecutor(api, {
      ...BASE_OP,
      operation: 'time_entry.start',
      payload: { type: 'LABOR', startedAt: '2026-11-10T09:00:00.000Z' },
    });
    expect(createTimeEntry).toHaveBeenCalledWith(
      'e1',
      { type: 'LABOR', startedAt: '2026-11-10T09:00:00.000Z' },
      '11111111-1111-4111-8111-111111111111',
    );
  });
});

describe('signatureExecutor', () => {
  it('imza gövdesi tümüyle taşınır', async () => {
    const captureSignature = jest.fn(async () => ({ ok: true, data: {}, replayed: false }));
    const api = fakeApi({ captureSignature });
    const payload = {
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
    };
    await signatureExecutor(api, {
      ...BASE_OP,
      operation: 'signature.capture',
      payload,
    });
    expect(captureSignature).toHaveBeenCalledWith(
      'e1',
      payload,
      '11111111-1111-4111-8111-111111111111',
    );
  });
});

describe('partsConsumeExecutor (Faz 09)', () => {
  const OP: OutboxOperation = {
    ...BASE_OP,
    operation: 'parts.consume',
    payload: { itemId: 'item-1', quantity: 2, note: 'Filtre değişimi' },
  };

  it('idempotency anahtarını taşır ve tüketimi gönderir', async () => {
    const api = fakeApi({
      consumePart: jest.fn(async () => ({ ok: true, data: {}, replayed: false })),
    });
    const outcome = await partsConsumeExecutor(api, OP);
    expect(outcome.ok).toBe(true);
    expect(api.consumePart).toHaveBeenCalledWith('e1', OP.payload, OP.idempotencyKey);
  });

  it('stok aşımı (409 NEGATIVE_STOCK_FORBIDDEN) kalıcı reddedilir — yeniden denemez', async () => {
    const api = fakeApi({
      consumePart: jest.fn(async () => ({
        ok: false,
        error: {
          kind: 'http' as const,
          statusCode: 409,
          message: 'Stok yetersiz — negatif bakiye onaysız oluşturulamaz',
          code: 'NEGATIVE_STOCK_FORBIDDEN',
        },
      })),
    });
    const outcome = await partsConsumeExecutor(api, OP);
    expect(outcome.ok).toBe(false);
    expect(outcome.retryable).toBe(false);
    expect(outcome.message).toContain('Stok yetersiz');
  });

  it('sunucu oynatması (replay) bildirilir — çift tüketim yok', async () => {
    const api = fakeApi({
      consumePart: jest.fn(async () => ({ ok: true, data: {}, replayed: true })),
    });
    const outcome = await partsConsumeExecutor(api, OP);
    expect(outcome.ok).toBe(true);
    expect(outcome.replayed).toBe(true);
  });

  it('executorFor parts.consume yürütücüsünü bulur', () => {
    expect(executorFor('parts.consume')).toBe(partsConsumeExecutor);
  });
});
