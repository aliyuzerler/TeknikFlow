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
import { AssetSearch } from './search';

export const metadata = { title: 'Ekipmanlar — TeknikFlow' };

/**
 * Faz 04 — /app/assets: kiracı genelinde ekipman envanteri.
 * Arama (etiket/seri/marka/model/müşteri) + durum/kritiklik filtreleri.
 */

interface AssetRow {
  assetId: string;
  assetTag: string;
  customerName: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'RETIRED';
  criticality: 'LOW' | 'MEDIUM' | 'HIGH';
}

const COLUMNS: Array<DataTableColumn<AssetRow>> = [
  {
    key: 'assetTag',
    header: 'Etiket',
    render: (row) => (
      <a className="tf-table__wo" href={`/app/assets/${row.assetId}`}>
        {row.assetTag}
      </a>
    ),
  },
  {
    key: 'customer',
    header: 'Müşteri',
    render: (row) => <span className="tf-table__customer">{row.customerName}</span>,
  },
  {
    key: 'equipment',
    header: 'Ekipman',
    render: (row) => (
      <span>
        {row.manufacturer ?? '—'}
        <div className="tf-table__sub">
          {row.model ?? '—'}
          {row.serialNumber ? ` · ${row.serialNumber}` : ''}
        </div>
      </span>
    ),
  },
  {
    key: 'criticality',
    header: 'Kritiklik',
    render: (row) => {
      if (row.criticality === 'HIGH') return <StatusBadge tone="red">Yüksek</StatusBadge>;
      if (row.criticality === 'MEDIUM') return <StatusBadge tone="amber">Orta</StatusBadge>;
      return <StatusBadge tone="gray">Düşük</StatusBadge>;
    },
  },
  {
    key: 'status',
    header: 'Durum',
    render: (row) => {
      if (row.status === 'ACTIVE') return <StatusBadge tone="green">Aktif</StatusBadge>;
      if (row.status === 'INACTIVE') return <StatusBadge tone="amber">Pasif</StatusBadge>;
      return <StatusBadge tone="gray">Emekli</StatusBadge>;
    },
  },
];

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session?.membership) return null;
  const canView =
    session.permissions.includes('customers:view_all') ||
    session.permissions.includes('customers:view_limited');
  if (!canView) {
    return (
      <Alert variant="warning" title="Bu bölüm için yetkiniz yok">
        Ekipman envanteri yalnızca ilgili rollere açıktır.
      </Alert>
    );
  }

  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : '';
  const status = typeof params.status === 'string' ? params.status : '';
  const criticality = typeof params.criticality === 'string' ? params.criticality : '';
  const page = Math.max(1, Number(params.page) || 1);

  const { apiBaseUrl } = getWebEnv();
  const cookieHeader = await apiCookieHeader();
  const query = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (q) query.set('q', q);
  if (['ACTIVE', 'INACTIVE', 'RETIRED'].includes(status)) query.set('status', status);
  if (['LOW', 'MEDIUM', 'HIGH'].includes(criticality)) query.set('criticality', criticality);

  const response = await fetch(`${apiBaseUrl}/api/v1/assets?${query}`, {
    headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);

  if (!response?.ok) {
    return (
      <Alert variant="danger" title="Ekipman listesi alınamadı">
        API'ye ulaşılamadı — bir süre sonra tekrar deneyin.
      </Alert>
    );
  }
  const body = (await response.json()) as {
    data: AssetRow[];
    pageInfo: { total: number; page: number; pageSize: number };
  };

  const templateParams = new URLSearchParams({ page: '{page}' });
  if (q) templateParams.set('q', q);
  if (status) templateParams.set('status', status);
  if (criticality) templateParams.set('criticality', criticality);
  const hrefTemplate = `/app/assets?${templateParams}`;

  return (
    <>
      <PageHeader
        eyebrow="Envanter"
        title="Ekipmanlar"
        subtitle="Kiracı genelinde ekipman envanteri — etiket, seri, müşteri ile arama."
      />

      <Panel title="Envanter" subtitle={`${body.pageInfo.total} varlık`}>
        <AssetSearch initialQuery={q} status={status} criticality={criticality} />
        {body.data.length === 0 ? (
          <p className="tf-panel__subtitle" style={{ padding: '18px' }}>
            {q ? `"${q}" aramasıyla eşleşen ekipman yok.` : 'Henüz ekipman kaydı yok.'}
          </p>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={body.data}
            getKey={(row) => row.assetId}
            aria-label="Ekipman envanteri"
          />
        )}
        <div style={{ padding: '0 18px 14px' }}>
          <Pager
            page={body.pageInfo.page}
            pageSize={body.pageInfo.pageSize}
            total={body.pageInfo.total}
            label="Ekipman envanteri"
            hrefTemplate={hrefTemplate}
          />
        </div>
      </Panel>
    </>
  );
}
