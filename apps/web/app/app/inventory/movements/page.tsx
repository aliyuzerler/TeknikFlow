import { getSession, apiCookieHeader } from '@/src/lib/session';
import { getWebEnv } from '@/src/load-env';
import {
  Alert,
  DataTable,
  PageHeader,
  Pager,
  Panel,
  StatusBadge,
  type DataTableColumn,
} from '@teknikflow/ui-web/server';
import { STOCK_MOVEMENT_TYPE_LABELS } from '@teknikflow/contracts';
import { NewMovementForm } from './new-movement';

export const metadata = { title: 'Stok Hareketleri — TeknikFlow' };

/**
 * Faz 09 — /app/inventory/movements: append-only hareket defteri + genel
 * hareket formu (giriş/transfer/araç çıkışı/iade). Tüketim YALNIZ iş emri
 * parça ucundan (atomik) — burada bilinçli olarak sunulmaz.
 */

interface MovementRow {
  movementId: string;
  itemId: string;
  sku: string;
  itemName: string;
  unit: string;
  lotNo: string | null;
  movementType: 'RECEIVE' | 'ISSUE' | 'TRANSFER' | 'RETURN' | 'CONSUME' | 'ADJUSTMENT';
  quantity: number;
  quantityDelta: number;
  fromWarehouseName: string | null;
  toWarehouseName: string | null;
  referenceType: string | null;
  actorName: string | null;
  occurredAt: string;
  note: string | null;
}

const TONES: Record<
  MovementRow['movementType'],
  'green' | 'amber' | 'blue' | 'gray' | 'red' | 'info'
> = {
  RECEIVE: 'green',
  ISSUE: 'blue',
  TRANSFER: 'blue',
  RETURN: 'amber',
  CONSUME: 'gray',
  ADJUSTMENT: 'amber',
};

const COLUMNS: Array<DataTableColumn<MovementRow>> = [
  {
    key: 'occurredAt',
    header: 'Zaman',
    render: (row) => new Date(row.occurredAt).toLocaleString('tr-TR'),
  },
  {
    key: 'item',
    header: 'Kalem',
    render: (row) => (
      <span>
        <span className="tf-table__wo">{row.sku}</span> · {row.itemName}
        {row.lotNo ? <div className="tf-table__sub">Lot: {row.lotNo}</div> : null}
      </span>
    ),
  },
  {
    key: 'type',
    header: 'Tür',
    render: (row) => (
      <StatusBadge tone={TONES[row.movementType]}>
        {STOCK_MOVEMENT_TYPE_LABELS[row.movementType]}
      </StatusBadge>
    ),
  },
  {
    key: 'qty',
    header: 'Δ Miktar',
    render: (row) => `${row.quantityDelta > 0 ? '+' : ''}${row.quantityDelta} ${row.unit}`,
  },
  {
    key: 'route',
    header: 'Yön',
    render: (row) => `${row.fromWarehouseName ?? '—'} → ${row.toWarehouseName ?? '—'}`,
  },
  { key: 'actor', header: 'Operatör', render: (row) => row.actorName ?? '—' },
  {
    key: 'ref',
    header: 'Referans',
    render: (row) =>
      row.referenceType === 'work_order'
        ? 'İş emri'
        : row.referenceType === 'stock_count'
          ? 'Sayım'
          : '—',
  },
];

export default async function InventoryMovementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session?.membership) return null;
  if (!session.permissions.includes('stock:view')) {
    return (
      <Alert variant="warning" title="Bu bölüm için yetkiniz yok">
        Hareket defteri yalnızca ilgili rollere açıktır.
      </Alert>
    );
  }

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const type = typeof params.type === 'string' ? params.type : '';

  const { apiBaseUrl } = getWebEnv();
  const cookieHeader = await apiCookieHeader();
  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (type) query.set('type', type);

  const response = await fetch(`${apiBaseUrl}/api/v1/inventory/movements?${query}`, {
    headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);

  if (!response?.ok) {
    return (
      <Alert variant="danger" title="Hareket defteri alınamadı">
        API'ye ulaşılamadı — bir süre sonra tekrar deneyin.
      </Alert>
    );
  }
  const body = (await response.json()) as {
    data: MovementRow[];
    total: number;
    page: number;
    pageSize: number;
  };

  const canMove =
    session.permissions.includes('stock:manage') ||
    session.permissions.includes('stock:manage_limited');

  const templateParams = new URLSearchParams({ page: '{page}' });
  if (type) templateParams.set('type', type);

  return (
    <>
      <PageHeader
        eyebrow="Stok"
        title="Hareket Defteri"
        subtitle="Append-only stok defteri — her satır kiracı geneli denetimli; parça tüketimi iş emri referansıyla burada izlenir."
      />

      <Panel title="Hareketler" subtitle={`${body.total} kayıt`}>
        <form
          method="get"
          action="/app/inventory/movements"
          style={{ padding: '14px 18px 0', display: 'flex', gap: 8 }}
        >
          <select
            name="type"
            defaultValue={type}
            aria-label="Hareket türü"
            style={{ maxWidth: 240 }}
          >
            <option value="">Tüm türler</option>
            {Object.entries(STOCK_MOVEMENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="submit" className="tf-btn tf-btn--secondary">
            Filtrele
          </button>
        </form>
        {body.data.length === 0 ? (
          <p className="tf-panel__subtitle" style={{ padding: '18px' }}>
            Filtreyle eşleşen hareket yok.
          </p>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={body.data}
            getKey={(row) => row.movementId}
            aria-label="Stok hareketleri"
          />
        )}
        <div style={{ padding: '0 18px 14px' }}>
          <Pager
            page={body.page}
            pageSize={body.pageSize}
            total={body.total}
            label="Stok hareketleri"
            hrefTemplate={`/app/inventory/movements?${templateParams}`}
          />
        </div>
        {canMove ? <NewMovementForm /> : null}
      </Panel>
    </>
  );
}
