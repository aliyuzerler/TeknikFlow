import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { createMemoryCacheDriver } from '../cache/driver';
import { createWorkOrderCache, type WorkOrderCache } from '../cache/work-order-cache';
import type { SyncContextValue } from '../sync/sync-context';
import type { WorkOrderView } from '@teknikflow/contracts';
import { InboxScreen, filterRows } from './inbox-screen';

/**
 * Faz 07 — gelen kutusu RNTL testleri: önbellek kaynaklı liste, filtreler,
 * boş/hata durumları, çevrimdışı şerit, filtre mantığı saf test.
 */

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDENTITY = { userId: '11111111-1111-4111-8111-000000000001', tenantId: TENANT };

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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const syncIdle: SyncContextValue = {
  status: 'idle',
  lastSyncAt: null,
  pendingCount: 0,
  error: null,
  isOnline: true,
  refresh: async () => ({ ok: true, pulled: 0 }),
};

describe('filterRows', () => {
  const rows = [
    order({ status: 'ASSIGNED' }),
    order({ workOrderId: '11111111-1111-4111-8111-000000000002', status: 'PLANNED' }),
    order({ workOrderId: '11111111-1111-4111-8111-000000000003', status: 'CLOSED' }),
  ];
  it('aktif yalnız yürütme durumlarını taşır', () => {
    expect(filterRows(rows, 'active')).toHaveLength(1);
  });
  it('planlı taslak+planned', () => {
    expect(filterRows(rows, 'planned')).toHaveLength(1);
  });
  it('tamamlanan terminal durumlar', () => {
    expect(filterRows(rows, 'done')).toHaveLength(1);
  });
  it('tümü hepsi', () => {
    expect(filterRows(rows, 'all')).toHaveLength(3);
  });
});

describe('InboxScreen', () => {
  async function seed(cache: WorkOrderCache, rows: WorkOrderView[]): Promise<void> {
    await cache.replaceAllForTenant(IDENTITY.userId, IDENTITY.tenantId, rows);
  }

  it('önbellekten kartları listeler; kart basınca detay açılır', async () => {
    const cache = createWorkOrderCache(createMemoryCacheDriver());
    await seed(cache, [
      order(),
      order({
        workOrderId: '11111111-1111-4111-8111-000000000009',
        workOrderNo: 'WO-2026-0009',
        subject: 'Asansör bakım',
      }),
    ]);
    const onOpen = jest.fn();
    const utils = render(
      <InboxScreen cache={cache} identity={IDENTITY} sync={syncIdle} onOpenWorkOrder={onOpen} />,
    );
    await waitFor(() => expect(utils.getByText('Klima arıza')).toBeTruthy());
    expect(utils.getByText('Asansör bakım')).toBeTruthy();
    fireEvent.press(utils.getByLabelText('İş emri WO-2026-0009: Asansör bakım, durum ASSIGNED'));
    expect(onOpen).toHaveBeenCalledWith('11111111-1111-4111-8111-000000000009');
  });

  it('boş önbellek → dürüst boş durumu', async () => {
    const cache = createWorkOrderCache(createMemoryCacheDriver());
    const utils = render(
      <InboxScreen cache={cache} identity={IDENTITY} sync={syncIdle} onOpenWorkOrder={jest.fn()} />,
    );
    await waitFor(() => expect(utils.getByTestId('inbox-empty')).toBeTruthy());
    expect(utils.getByText('Henüz iş yok')).toBeTruthy();
  });

  it('çevrimdışı şerit görünür (netinfo durumu)', async () => {
    const cache = createWorkOrderCache(createMemoryCacheDriver());
    const utils = render(
      <InboxScreen
        cache={cache}
        identity={IDENTITY}
        sync={{ ...syncIdle, status: 'offline', isOnline: false }}
        onOpenWorkOrder={jest.fn()}
      />,
    );
    await waitFor(() => expect(utils.getByTestId('inbox-sync-banner')).toBeTruthy());
    expect(utils.getByText('Çevrimdışı — önbellek gösteriliyor')).toBeTruthy();
  });

  it('senkron hata mesajı şeritte gösterilir (dürüst hata)', async () => {
    const cache = createWorkOrderCache(createMemoryCacheDriver());
    const utils = render(
      <InboxScreen
        cache={cache}
        identity={IDENTITY}
        sync={{ ...syncIdle, status: 'error', error: 'Sunucuya ulaşılamadı' }}
        onOpenWorkOrder={jest.fn()}
      />,
    );
    await waitFor(() => expect(utils.getByTestId('inbox-sync-banner')).toBeTruthy());
    expect(utils.getByText(/Senkron hatası/)).toBeTruthy();
    expect(utils.getByText(/Sunucuya ulaşılamadı/)).toBeTruthy();
  });

  it('filtre çipleri listeyi daraltır', async () => {
    const cache = createWorkOrderCache(createMemoryCacheDriver());
    await seed(cache, [
      order(),
      order({
        workOrderId: '11111111-1111-4111-8111-000000000005',
        workOrderNo: 'WO-2026-0005',
        status: 'PLANNED',
        subject: 'Planlı iş',
      }),
    ]);
    const utils = render(
      <InboxScreen cache={cache} identity={IDENTITY} sync={syncIdle} onOpenWorkOrder={jest.fn()} />,
    );
    await waitFor(() => expect(utils.getByText('Klima arıza')).toBeTruthy());
    expect(utils.getByText('Planlı iş')).toBeTruthy();

    fireEvent.press(utils.getByTestId('inbox-filter-active'));
    await waitFor(() => expect(utils.queryByText('Planlı iş')).toBeNull());
    expect(utils.getByText('Klima arıza')).toBeTruthy();

    fireEvent.press(utils.getByTestId('inbox-filter-planned'));
    await waitFor(() => expect(utils.queryByText('Klima arıza')).toBeNull());
    expect(utils.getByText('Planlı iş')).toBeTruthy();
  });
});
