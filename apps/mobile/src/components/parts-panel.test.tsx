import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import type { BalanceView, ExecutionReportView, WorkOrderView } from '@teknikflow/contracts';
import { PartsPanel } from './parts-panel';
import type { ExecutionActions } from '../screens/execution-actions';

/**
 * TEST-09 §7 — mobil parça paneli: araç stoğu cache'ten listelenir,
 * seçilen parça + miktar outbox'a girer; parti kaleminde lot zorunlu,
 * boş araç stoğunda bilgilendirici boş durum.
 */

const WORK_ORDER = {
  workOrderId: '22222222-2222-4222-8222-222222222222',
  workOrderNo: 'WO-2026-0042',
  subject: 'Pompa arızası',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  type: 'CORRECTIVE',
  customerId: 'c1',
  customerName: 'Mega Endüstri',
  assetTag: null,
  locationName: null,
  branchName: null,
  assignedToName: 'Ali Teknisyen',
  createdAt: '2026-11-10T08:00:00.000Z',
  updatedAt: '2026-11-10T08:00:00.000Z',
} as unknown as WorkOrderView;

const VAN_STOCK: BalanceView[] = [
  {
    itemId: '11111111-1111-4111-8111-0000000000a1',
    sku: 'FLT-04-25',
    itemName: 'Hava filtresi',
    unit: 'ad',
    trackingMode: 'NONE',
    warehouseId: 'w1',
    warehouseName: 'Teknisyen Aracı 34',
    warehouseType: 'VEHICLE',
    lotId: null,
    lotNo: null,
    expiresAt: null,
    onHand: 6,
    reservedQty: 0,
    available: 6,
    lowStock: false,
    updatedAt: '2026-11-10T08:00:00.000Z',
  },
  {
    itemId: '11111111-1111-4111-8111-0000000000a2',
    sku: 'GLY-5W-1L',
    itemName: 'Glikol 5W 1L',
    unit: 'lt',
    trackingMode: 'LOT',
    warehouseId: 'w1',
    warehouseName: 'Teknisyen Aracı 34',
    warehouseType: 'VEHICLE',
    lotId: 'lot-1',
    lotNo: 'LOT-2026-11-A',
    expiresAt: null,
    onHand: 4,
    reservedQty: 0,
    available: 4,
    lowStock: false,
    updatedAt: '2026-11-10T08:00:00.000Z',
  },
];

function makeActions(consume: () => Promise<unknown>): ExecutionActions {
  return {
    transition: jest.fn(),
    arrive: jest.fn(),
    toggleChecklistItem: jest.fn(),
    startLabor: jest.fn(),
    stopLabor: jest.fn(),
    captureSignature: jest.fn(),
    consumePart: jest.fn(async () => consume()) as unknown as ExecutionActions['consumePart'],
  } as unknown as ExecutionActions;
}

describe('PartsPanel (Faz 09)', () => {
  it('araç stoğu kalemleri listelenir; NONE kalemde lot paneli yok', () => {
    render(
      <PartsPanel
        order={WORK_ORDER}
        actions={makeActions(async () => ({ ok: true, queued: true, sent: true }))}
        vanStock={VAN_STOCK}
        online
      />,
    );
    expect(screen.getByTestId('parts-item-FLT-04-25')).toBeTruthy();
    expect(screen.getByTestId('parts-item-GLY-5W-1L')).toBeTruthy();
    expect(screen.queryByTestId('parts-lots')).toBeNull();
  });

  it("parti kalemi seçilince lot seçimi zorunludur; lot seçilince tüketim gönderilir", async () => {
    const actions = makeActions(async () => ({ ok: true, queued: true, sent: true }));
    render(<PartsPanel order={WORK_ORDER} actions={actions} vanStock={VAN_STOCK} online />);

    // Parti kalemini seç
    fireEvent.press(screen.getByTestId('parts-item-GLY-5W-1L'));
    expect(screen.getByTestId('parts-lots')).toBeTruthy();

    // Lot seçmeden miktar yaz → lot zorunlu hatası
    fireEvent.changeText(screen.getByTestId('parts-qty'), '2');
    fireEvent.press(screen.getByTestId('parts-consume'));
    await waitFor(() => {
      expect(screen.getByTestId('parts-error').props.children).toContain('lot seçin');
    });
    expect(actions.consumePart).not.toHaveBeenCalled();

    // Lot seç ve gönder
    fireEvent.press(screen.getByText('LOT-2026-11-A (4 lt)'));
    fireEvent.press(screen.getByTestId('parts-consume'));
    await waitFor(() => {
      expect(screen.getByTestId('parts-info').props.children).toContain('gönderildi');
    });
    expect(actions.consumePart).toHaveBeenCalledWith(WORK_ORDER.workOrderId, {
      itemId: '11111111-1111-4111-8111-0000000000a2',
      quantity: 2,
      lotId: 'lot-1',
    });
  });

  it("NONE kalemden tüketim lot'suz gönderilir (çevrimdışı → kuyruğa)", async () => {
    const actions = makeActions(async () => ({ ok: true, queued: true, sent: false }));
    render(
      <PartsPanel order={WORK_ORDER} actions={actions} vanStock={VAN_STOCK} online={false} />,
    );
    fireEvent.press(screen.getByTestId('parts-item-FLT-04-25'));
    fireEvent.changeText(screen.getByTestId('parts-qty'), '1.5');
    fireEvent.press(screen.getByTestId('parts-consume'));
    await waitFor(() => {
      expect(screen.getByTestId('parts-info').props.children).toContain('Kuyruğa alındı');
    });
    expect(actions.consumePart).toHaveBeenCalledWith(WORK_ORDER.workOrderId, {
      itemId: '11111111-1111-4111-8111-0000000000a1',
      quantity: 1.5,
    });
  });

  it('rapor parçaları ve toplam maliyet görünür', () => {
    const report = {
      parts: [
        {
          movementId: 'm1',
          workOrderId: WORK_ORDER.workOrderId,
          itemId: 'x',
          sku: 'FLT-04-25',
          itemName: 'Hava filtresi',
          unit: 'ad',
          trackingMode: 'NONE',
          lotId: null,
          lotNo: null,
          warehouseId: 'w1',
          warehouseName: 'Teknisyen Aracı 34',
          quantity: 2,
          unitCostMinor: 1250,
          totalCostMinor: 2500,
          note: null,
          actorId: 'u1',
          actorName: 'Ali Teknisyen',
          occurredAt: '2026-11-10T10:00:00.000Z',
        },
      ],
      partsCostMinor: 2500,
    } as unknown as ExecutionReportView;
    render(
      <PartsPanel
        order={WORK_ORDER}
        actions={makeActions(async () => ({ ok: true, queued: true, sent: true }))}
        vanStock={VAN_STOCK}
        report={report}
        online
      />,
    );
    expect(screen.getByText('FLT-04-25 · 2 ad')).toBeTruthy();
    expect(screen.getByText('25,00 ₺')).toBeTruthy();
    expect(screen.getByText('Toplam malzeme: 25,00 ₺')).toBeTruthy();
  });

  it('boş araç stoğunda boş durum gösterilir', () => {
    render(
      <PartsPanel
        order={WORK_ORDER}
        actions={makeActions(async () => ({ ok: true, queued: true, sent: true }))}
        vanStock={[]}
        online
      />,
    );
    expect(screen.getByText('Araç stoğunda kullanılabilir parça yok.')).toBeTruthy();
  });

  it('kapalı iş emrinde panel hiç görünmez', () => {
    const closed = { ...WORK_ORDER, status: 'CLOSED' } as WorkOrderView;
    const { toJSON } = render(
      <PartsPanel
        order={closed}
        actions={makeActions(async () => ({ ok: true, queued: true, sent: true }))}
        vanStock={VAN_STOCK}
        online
      />,
    );
    expect(toJSON()).toBeNull();
  });
});
