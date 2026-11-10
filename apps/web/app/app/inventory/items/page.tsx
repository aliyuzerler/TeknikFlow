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
import { NewItemForm } from './new-item';

export const metadata = { title: 'Stok Kalemleri — TeknikFlow' };

/**
 * Faz 09 — /app/inventory/items: SKU kataloğu. Yazma stock:manage
 * (form yalnız o izne görünür); denetim API'de.
 */

interface ItemRow {
  itemId: string;
  sku: string;
  name: string;
  unit: string;
  trackingMode: 'NONE' | 'LOT' | 'SERIAL';
  reorderPoint: number;
  active: boolean;
  totalOnHand: number;
  lowStock: boolean;
}

const TRACKING_LABELS: Record<ItemRow['trackingMode'], string> = {
  NONE: 'İzlemsiz',
  LOT: 'Parti',
  SERIAL: 'Seri',
};

const COLUMNS: Array<DataTableColumn<ItemRow>> = [
  {
    key: 'sku',
    header: 'SKU',
    render: (row) => <span className="tf-table__wo">{row.sku}</span>,
  },
  { key: 'name', header: 'Kalem adı' },
  {
    key: 'tracking',
    header: 'İzleme',
    render: (row) => (
      <StatusBadge tone={row.trackingMode === 'NONE' ? 'gray' : 'blue'}>
        {TRACKING_LABELS[row.trackingMode]}
      </StatusBadge>
    ),
  },
  { key: 'onHand', header: 'Toplam stok', render: (row) => `${row.totalOnHand} ${row.unit}` },
  {
    key: 'reorder',
    header: 'Eşik',
    render: (row) => (
      <span>
        {row.reorderPoint}
        {row.lowStock ? (
          <div className="tf-table__sub">
            <StatusBadge tone="red">Düşük stok</StatusBadge>
          </div>
        ) : null}
      </span>
    ),
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

export default async function InventoryItemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session?.membership) return null;
  if (!session.permissions.includes('stock:view')) {
    return (
      <Alert variant="warning" title="Bu bölüm için yetkiniz yok">
        Stok kataloğu yalnızca ilgili rollere açıktır.
      </Alert>
    );
  }

  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : '';
  const page = Math.max(1, Number(params.page) || 1);

  const { apiBaseUrl } = getWebEnv();
  const cookieHeader = await apiCookieHeader();
  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (q) query.set('q', q);

  const response = await fetch(`${apiBaseUrl}/api/v1/inventory/items?${query}`, {
    headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);

  if (!response?.ok) {
    return (
      <Alert variant="danger" title="Stok kalemleri alınamadı">
        API'ye ulaşılamadı — bir süre sonra tekrar deneyin.
      </Alert>
    );
  }
  const body = (await response.json()) as {
    data: ItemRow[];
    total: number;
    page: number;
    pageSize: number;
  };

  const canManage = session.permissions.includes('stock:manage');

  return (
    <>
      <PageHeader
        eyebrow="Stok"
        title="Stok Kalemleri"
        subtitle="SKU kataloğu — izleme derinliği (toplu/parti/seri) ve yeniden sipariş eşikleri."
      />

      <Panel title="Katalog" subtitle={`${body.total} kalem`}>
        <form
          method="get"
          action="/app/inventory/items"
          style={{ padding: '14px 18px 0', display: 'flex', gap: 8 }}
        >
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="SKU veya ad ara"
            aria-label="Stok kalemi ara"
            style={{ flex: 1, maxWidth: 320 }}
          />
          <button type="submit" className="tf-btn tf-btn--secondary">
            Ara
          </button>
        </form>
        {body.data.length === 0 ? (
          <p className="tf-panel__subtitle" style={{ padding: '18px' }}>
            {q ? `"${q}" aramasıyla eşleşen kalem yok.` : 'Henüz stok kalemi yok.'}
          </p>
        ) : (
          <DataTable columns={COLUMNS} rows={body.data} getKey={(row) => row.itemId} aria-label="Stok kataloğu" />
        )}
        {canManage ? <NewItemForm /> : null}
      </Panel>
    </>
  );
}
