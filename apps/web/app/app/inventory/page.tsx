import { getSession, apiCookieHeader } from '@/src/lib/session';
import { getWebEnv } from '@/src/load-env';
import {
  Alert,
  DataTable,
  MetricCard,
  PageHeader,
  Panel,
  StatusBadge,
  type DataTableColumn,
} from '@teknikflow/ui-web/server';

export const metadata = { title: 'Stok Genel Bakış — TeknikFlow' };

/**
 * Faz 09 — /app/inventory: stok genel bakışı. Düşük stok uyarıları ve
 * son hareketler tek bakışta; ayrıntılar items/warehouses/movements'ta.
 */

interface BalanceRow {
  itemId: string;
  sku: string;
  itemName: string;
  unit: string;
  warehouseName: string;
  warehouseType: 'CENTRAL' | 'BRANCH' | 'VEHICLE';
  lotNo: string | null;
  onHand: number;
  reservedQty: number;
  available: number;
  lowStock: boolean;
}

interface MovementRow {
  movementId: string;
  sku: string;
  itemName: string;
  movementType: 'RECEIVE' | 'ISSUE' | 'TRANSFER' | 'RETURN' | 'CONSUME' | 'ADJUSTMENT';
  quantity: number;
  quantityDelta: number;
  fromWarehouseName: string | null;
  toWarehouseName: string | null;
  actorName: string | null;
  occurredAt: string;
}

const MOVEMENT_LABELS: Record<MovementRow['movementType'], string> = {
  RECEIVE: 'Giriş',
  ISSUE: 'Araç çıkışı',
  TRANSFER: 'Transfer',
  RETURN: 'İade',
  CONSUME: 'Tüketim',
  ADJUSTMENT: 'Sayım düzeltmesi',
};

const MOVEMENT_TONES: Record<MovementRow['movementType'], 'green' | 'amber' | 'blue' | 'gray' | 'red' | 'info'> = {
  RECEIVE: 'green',
  ISSUE: 'blue',
  TRANSFER: 'blue',
  RETURN: 'amber',
  CONSUME: 'gray',
  ADJUSTMENT: 'amber',
};

const BALANCE_COLUMNS: Array<DataTableColumn<BalanceRow>> = [
  { key: 'sku', header: 'SKU' },
  {
    key: 'item',
    header: 'Kalem',
    render: (row) => (
      <span>
        {row.itemName}
        {row.lotNo ? <div className="tf-table__sub">Lot: {row.lotNo}</div> : null}
      </span>
    ),
  },
  { key: 'warehouse', header: 'Depo', render: (row) => row.warehouseName },
  {
    key: 'available',
    header: 'Kullanılabilir',
    render: (row) => (
      <span>
        {row.available} {row.unit}
        {row.reservedQty > 0 ? (
          <div className="tf-table__sub">{row.reservedQty} rezerve</div>
        ) : null}
      </span>
    ),
  },
  {
    key: 'lowStock',
    header: 'Uyarı',
    render: (row) =>
      row.lowStock ? (
        <StatusBadge tone="red">Düşük stok</StatusBadge>
      ) : (
        <StatusBadge tone="green">Yeterli</StatusBadge>
      ),
  },
];

const MOVEMENT_COLUMNS: Array<DataTableColumn<MovementRow>> = [
  {
    key: 'occurredAt',
    header: 'Zaman',
    render: (row) => new Date(row.occurredAt).toLocaleString('tr-TR'),
  },
  { key: 'sku', header: 'SKU' },
  {
    key: 'type',
    header: 'Hareket',
    render: (row) => (
      <StatusBadge tone={MOVEMENT_TONES[row.movementType]}>
        {MOVEMENT_LABELS[row.movementType]}
      </StatusBadge>
    ),
  },
  {
    key: 'quantity',
    header: 'Miktar',
    render: (row) => `${row.quantityDelta > 0 ? '+' : ''}${row.quantityDelta}`,
  },
  {
    key: 'route',
    header: 'Yön',
    render: (row) => `${row.fromWarehouseName ?? '—'} → ${row.toWarehouseName ?? '—'}`,
  },
  { key: 'actor', header: 'Operatör', render: (row) => row.actorName ?? '—' },
];

async function fetchJson<T>(url: string, cookieHeader: string | undefined): Promise<T | null> {
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json()) as T;
}

export default async function InventoryOverviewPage() {
  const session = await getSession();
  if (!session?.membership) return null;
  if (!session.permissions.includes('stock:view')) {
    return (
      <Alert variant="warning" title="Bu bölüm için yetkiniz yok">
        Stok görünümü yalnızca ilgili rollere açıktır.
      </Alert>
    );
  }

  const { apiBaseUrl } = getWebEnv();
  const cookieHeader = await apiCookieHeader();

  const [items, balances, movements] = await Promise.all([
    fetchJson<{ data: Array<{ itemId: string; active: boolean; lowStock: boolean }> }>(
      `${apiBaseUrl}/api/v1/inventory/items?pageSize=100`,
      cookieHeader,
    ),
    fetchJson<{ data: BalanceRow[] }>(
      `${apiBaseUrl}/api/v1/inventory/balances?lowStock=true`,
      cookieHeader,
    ),
    fetchJson<{ data: MovementRow[] }>(
      `${apiBaseUrl}/api/v1/inventory/movements?pageSize=10`,
      cookieHeader,
    ),
  ]);

  const itemCount = items?.data.length ?? 0;
  const lowStockRows = balances?.data ?? [];
  const movementRows = movements?.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Stok"
        title="Stok Genel Bakış"
        subtitle="Katalog, depolar, araç stokları ve hareket defteri — döngüsel sayım ve tüketim buradan yönetilir."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <MetricCard label="Stok kalemi" value={itemCount} tone="blue" note="Katalogda kayıtlı SKU" />
        <MetricCard
          label="Düşük stok satırı"
          value={lowStockRows.length}
          tone={lowStockRows.length > 0 ? 'amber' : 'green'}
          note="Eşik altındaki depo satırları"
        />
        <MetricCard
          label="Son hareket"
          value={movementRows.length}
          tone="violet"
          note="Son 10 defter kaydı"
        />
      </div>

      <Panel
        title="Düşük stok uyarıları"
        subtitle="Kullanılabilir miktarı yeniden sipariş eşiğinin altında olan satırlar"
      >
        {lowStockRows.length === 0 ? (
          <p className="tf-panel__subtitle" style={{ padding: '18px' }}>
            Eşik altında satır yok — tüm bakiyeler yeniden sipariş eşiğinin üzerinde.
          </p>
        ) : (
          <DataTable
            columns={BALANCE_COLUMNS}
            rows={lowStockRows}
            getKey={(row) => `${row.itemId}-${row.warehouseName}-${row.lotNo ?? ''}`}
            aria-label="Düşük stok satırları"
          />
        )}
      </Panel>

      <Panel title="Son hareketler" subtitle="Append-only stok defteri — son 10 kayıt">
        {movementRows.length === 0 ? (
          <p className="tf-panel__subtitle" style={{ padding: '18px' }}>
            Henüz stok hareketi yok — Hareketler sayfasından giriş kaydedebilirsiniz.
          </p>
        ) : (
          <DataTable
            columns={MOVEMENT_COLUMNS}
            rows={movementRows}
            getKey={(row) => row.movementId}
            aria-label="Son stok hareketleri"
          />
        )}
      </Panel>
    </>
  );
}
