import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listServiceRequests,
  transitionWorkOrder,
  fetchWorkOrder,
  PRIORITY_LABELS,
} from './service-client.js';

/**
 * Faz 05 — servis akışı istemcisi birim testleri (fetch alaylanır).
 * Gerçek akışlar API entegrasyon testlerinde uçtan uca doğrulanır.
 */

const requestView = {
  requestId: 'a41dffca-ec44-4da4-a56f-5b585018c071',
  customerId: 'b41dffca-ec44-4da4-a56f-5b585018c072',
  customerName: 'Atlas Test',
  assetId: null,
  assetTag: null,
  serviceLocationId: null,
  categoryId: null,
  categoryKey: null,
  categoryName: null,
  source: 'OFFICE',
  subject: 'Klima arızası',
  description: null,
  priority: 'HIGH',
  status: 'NEW',
  slaDueAt: '2026-11-10T08:00:00.000Z',
  slaBreached: false,
  convertedWorkOrderId: null,
  convertedWorkOrderNo: null,
  cancellationReason: null,
  createdById: null,
  createdAt: '2026-11-09T08:00:00.000Z',
  updatedAt: '2026-11-09T08:00:00.000Z',
};

const workOrderView = {
  workOrderId: 'c41dffca-ec44-4da4-a56f-5b585018c073',
  workOrderNo: 'WO-2026-0042',
  requestId: null,
  customerId: 'b41dffca-ec44-4da4-a56f-5b585018c072',
  customerName: 'Atlas Test',
  assetId: null,
  assetTag: null,
  serviceLocationId: null,
  locationName: null,
  branchId: null,
  branchName: null,
  type: 'CORRECTIVE',
  priority: 'HIGH',
  status: 'PLANNED',
  subject: 'Klima arızası',
  description: null,
  scheduledStart: null,
  scheduledEnd: null,
  assignedToId: null,
  assignedToName: null,
  acceptedAt: null,
  startedAt: null,
  completedAt: null,
  closedAt: null,
  cancelledAt: null,
  cancellationReason: null,
  version: 1,
  createdById: null,
  createdAt: '2026-11-09T08:00:00.000Z',
  updatedAt: '2026-11-09T08:00:00.000Z',
};

function mockFetch(body: unknown, status = 200) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

const CTX = { baseUrl: 'http://api.test', cookieHeader: 'tf_session=x', csrfToken: 'c' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listServiceRequests', () => {
  it('liste zarfını çözer ve sorgu parametrelerini iletir', async () => {
    const fetchMock = mockFetch({
      data: [requestView],
      pageInfo: { total: 1, page: 1, pageSize: 20 },
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listServiceRequests(CTX, { status: 'NEW', q: 'klima' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.data[0]?.subject).toBe('Klima arızası');
      expect(result.data.pageInfo.total).toBe(1);
    }
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toContain('/api/v1/service-requests?status=NEW&q=klima');
  });

  it("boş sayfa parametreleri URL'e taşınmaz", async () => {
    const fetchMock = mockFetch({ data: [], pageInfo: { total: 0, page: 1, pageSize: 20 } });
    vi.stubGlobal('fetch', fetchMock);
    await listServiceRequests(CTX, {});
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).not.toContain('?');
  });
});

describe('transitionWorkOrder', () => {
  it('geçiş gövdesini doğrular ve POST + CSRF gönderir', async () => {
    const fetchMock = mockFetch(workOrderView);
    vi.stubGlobal('fetch', fetchMock);

    const result = await transitionWorkOrder(CTX, 'w1', {
      to: 'ASSIGNED',
      assigneeUserId: 'f41dffca-ec44-4da4-a56f-5b585018c076',
      expectedVersion: 1,
    });
    expect(result.ok).toBe(true);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toContain('/api/v1/work-orders/w1/transition');
    expect(call[1]?.method).toBe('POST');
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers['x-csrf-token']).toBe('c');
    expect(JSON.parse(String(call[1]?.body)).to).toBe('ASSIGNED');
  });

  it('şema dışı geçiş gövdesi önceden hata verir (to eksik)', async () => {
    const fetchMock = mockFetch(workOrderView);
    vi.stubGlobal('fetch', fetchMock);
    const result = await transitionWorkOrder(CTX, 'w1', {} as never);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchWorkOrder', () => {
  it('detay zarfı olay/not/atamalarıyla çözümlenir', async () => {
    const detail = {
      ...workOrderView,
      events: [
        {
          eventId: 'd41dffca-ec44-4da4-a56f-5b585018c074',
          eventType: 'work_order.state_changed',
          fromState: 'DRAFT',
          toState: 'PLANNED',
          actorId: 'f41dffca-ec44-4da4-a56f-5b585018c076',
          actorName: 'Sahip',
          metadata: {},
          occurredAt: '2026-11-09T08:05:00.000Z',
        },
      ],
      notes: [
        {
          noteId: 'e41dffca-ec44-4da4-a56f-5b585018c075',
          authorId: 'f41dffca-ec44-4da4-a56f-5b585018c076',
          authorName: 'Sahip',
          body: 'Yedek parça sipariş edildi',
          visibility: 'INTERNAL',
          createdAt: '2026-11-09T08:10:00.000Z',
        },
      ],
      assignments: [],
    };
    vi.stubGlobal('fetch', mockFetch(detail));
    const result = await fetchWorkOrder(CTX, 'w1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.events[0]?.toState).toBe('PLANNED');
      expect(result.data.notes[0]?.visibility).toBe('INTERNAL');
    }
  });

  it('hata zarfı kodu iletilir (INVALID_TRANSITION)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        {
          code: 'INVALID_TRANSITION',
          message: 'geçiş izinli değil',
          requestId: 'req-1',
          statusCode: 409,
        },
        409,
      ),
    );
    const result = await fetchWorkOrder(CTX, 'w1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TRANSITION');
      expect(result.error.httpStatus).toBe(409);
    }
  });
});

describe('öncelik etiketleri', () => {
  it('dört öncelik Türkçe etiketlenir', () => {
    expect(PRIORITY_LABELS).toEqual({
      LOW: 'Düşük',
      MEDIUM: 'Orta',
      HIGH: 'Yüksek',
      URGENT: 'Acil',
    });
  });
});
