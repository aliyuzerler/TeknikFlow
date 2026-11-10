import { getSession, apiCookieHeader } from '@/src/lib/session';
import { getWebEnv } from '@/src/load-env';
import {
  Alert,
  DataTable,
  PageHeader,
  Panel,
  StatusBadge,
  type DataTableColumn,
} from '@teknikflow/ui-web/server';
import { WAREHOUSE_TYPE_LABELS } from '@teknikflow/contracts';
import { NewWarehouseForm } from './new-warehouse';

export const metadata = { title: 'Depolar — TeknikFlow' };

/**
 * Faz 09 — /app/inventory/warehouses: merkez/şube/araç depoları.
 * Araç (VEHICLE) depolar teknisyene bağlanır — kendi aracı stoku.
 */

interface WarehouseRow {
  warehouseId: string;
  name: string;
  type: 'CENTRAL' | 'BRANCH' | 'VEHICLE';
  branchName: string | null;
  assignedToName: string | null;
  active: boolean;
}

const COLUMNS: Array<DataTableColumn<WarehouseRow>> = [
  { key: 'name', header: 'Depo', render: (row) => <span className="tf-table__wo">{row.name}</span> },
  {
    key: 'type',
    header: 'Tür',
    render: (row) => (
      <StatusBadge tone={row.type === 'VEHICLE' ? 'info' : row.type === 'BRANCH' ? 'blue' : 'green'}>
        {WAREHOUSE_TYPE_LABELS[row.type]}
      </StatusBadge>
    ),
  },
  { key: 'branch', header: 'Şube', render: (row) => row.branchName ?? '—' },
  {
    key: 'owner',
    header: 'Sorumlu',
    render: (row) => row.assignedToName ?? '—',
  },
  {
    key: 'active',
    header: 'Durum',
    render: (row) =>
      row.active ? (
        <StatusBadge tone="green">Aktif</StatusBadge>
      ) : (
        <StatusBadge tone="gray">Pasif</StatusBadge>
      ),
  },
];

export default async function InventoryWarehousesPage() {
  const session = await getSession();
  if (!session?.membership) return null;
  if (!session.permissions.includes('stock:view')) {
    return (
      <Alert variant="warning" title="Bu bölüm için yetkiniz yok">
        Depo listesi yalnızca ilgili rollere açıktır.
      </Alert>
    );
  }

  const { apiBaseUrl } = getWebEnv();
  const cookieHeader = await apiCookieHeader();
  const response = await fetch(`${apiBaseUrl}/api/v1/inventory/warehouses`, {
    headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);

  if (!response?.ok) {
    return (
      <Alert variant="danger" title="Depolar alınamadı">
        API'ye ulaşılamadı — bir süre sonra tekrar deneyin.
      </Alert>
    );
  }
  const body = (await response.json()) as { data: WarehouseRow[] };
  const canManage = session.permissions.includes('stock:manage');

  return (
    <>
      <PageHeader
        eyebrow="Stok"
        title="Depolar"
        subtitle="Merkez, şube ve araç depoları — araç stokları teknisyenin kendi aracına bağlıdır."
      />

      <Panel title="Depo listesi" subtitle={`${body.data.length} depo`}>
        {body.data.length === 0 ? (
          <p className="tf-panel__subtitle" style={{ padding: '18px' }}>
            Henüz depo yok — aşağıdan merkez depo veya araç stoğu tanımlayın.
          </p>
        ) : (
          <DataTable columns={COLUMNS} rows={body.data} getKey={(row) => row.warehouseId} aria-label="Depo listesi" />
        )}
        {canManage ? <NewWarehouseForm /> : null}
      </Panel>
    </>
  );
}
