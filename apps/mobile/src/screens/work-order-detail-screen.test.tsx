import { render, waitFor } from '@testing-library/react-native';
import type { WorkOrderView } from '@teknikflow/contracts';
import { WorkOrderDetailScreen } from './work-order-detail-screen';

/**
 * Faz 07 — detay ekranı RNTL testleri: snapshot alanları, eksik iş emri
 * dürüst "yok" durumu; geri dönüş.
 */

function order(): WorkOrderView {
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
    locationName: 'Çatı ünitesi',
    branchId: null,
    branchName: 'Merkez',
    type: 'CORRECTIVE',
    priority: 'HIGH',
    status: 'ASSIGNED',
    subject: 'Klima arıza — çatı ünitesi',
    description: 'Fan motoru gürültülü çalışıyor.',
    scheduledStart: '2026-11-09T06:00:00.000Z',
    scheduledEnd: '2026-11-09T09:00:00.000Z',
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
  };
}

describe('WorkOrderDetailScreen', () => {
  it('snapshot alanları gösterilir (müşteri/varlık/planlama/açıklama)', async () => {
    const utils = render(
      <WorkOrderDetailScreen
        getOrder={async () => order()}
        workOrderId="11111111-1111-4111-8111-000000000001"
        onBack={jest.fn()}
      />,
    );
    await waitFor(() => expect(utils.getByText('Klima arıza — çatı ünitesi')).toBeTruthy());
    expect(utils.getByText('WO-2026-0001')).toBeTruthy();
    expect(utils.getByText('Mega Otel')).toBeTruthy();
    expect(utils.getByText('AST-000001')).toBeTruthy();
    expect(utils.getByText('Çatı ünitesi')).toBeTruthy();
    expect(utils.getByText('Fan motoru gürültülü çalışıyor.')).toBeTruthy();
    expect(utils.getByText('Merkez')).toBeTruthy();
  });

  it('önbellekte yok → dürüst "yok" durumu (sahte veri yok)', async () => {
    const utils = render(
      <WorkOrderDetailScreen
        getOrder={async () => null}
        workOrderId="11111111-1111-4111-8111-000000000042"
        onBack={jest.fn()}
      />,
    );
    await waitFor(() => expect(utils.getByTestId('wo-detail-missing')).toBeTruthy());
    expect(utils.getByText('İş emri önbellekte yok')).toBeTruthy();
  });

  it('açıklama girilmemişse dürüst etiket', async () => {
    const utils = render(
      <WorkOrderDetailScreen
        getOrder={async () => ({ ...order(), description: null })}
        workOrderId="11111111-1111-4111-8111-000000000001"
        onBack={jest.fn()}
      />,
    );
    await waitFor(() => expect(utils.getByText('Açıklama girilmemiş.')).toBeTruthy());
  });
});
