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
import { CustomersSearch } from './search';
import { NewCustomerButton } from './new-customer';

export const metadata = { title: 'Müşteriler — TeknikFlow' };

/**
 * Faz 04 — /app/customers: müşteri kayıt defteri.
 * Arama/filtre/sayfalama URL parametreleriyle (yenilenmeye dayanıklı);
 * veri API'den sunucu tarafında kiracı kapsamıyla çekilir.
 */

interface CustomerRow {
  customerId: string;
  name: string;
  customerType: 'COMPANY' | 'INDIVIDUAL';
  status: 'ACTIVE' | 'ARCHIVED';
  contactCount: number;
  locationCount: number;
  assetCount: number;
}

const COLUMNS: Array<DataTableColumn<CustomerRow>> = [
  {
    key: 'name',
    header: 'Müşteri',
    render: (row) => (
      <a className="tf-table__customer" href={`/app/customers/${row.customerId}`}>
        {row.name}
      </a>
    ),
  },
  {
    key: 'customerType',
    header: 'Tür',
    render: (row) => (row.customerType === 'COMPANY' ? 'Firma' : 'Bireysel'),
  },
  { key: 'contactCount', header: 'Kişi' },
  { key: 'locationCount', header: 'Lokasyon' },
  { key: 'assetCount', header: 'Ekipman' },
  {
    key: 'status',
    header: 'Durum',
    render: (row) =>
      row.status === 'ACTIVE' ? (
        <StatusBadge tone="green">Etkin</StatusBadge>
      ) : (
        <StatusBadge tone="gray">Arşiv</StatusBadge>
      ),
  },
];

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session?.membership) {
    return null; // layout yönlendirmesi zaten /login'e taşır
  }
  const canView =
    session.permissions.includes('customers:view_all') ||
    session.permissions.includes('customers:view_limited');
  if (!canView) {
    return (
      <Alert variant="warning" title="Bu bölüm için yetkiniz yok">
        Müşteri kayıtları yalnızca ilgili rollere açıktır.
      </Alert>
    );
  }

  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : '';
  const status = params.status === 'ARCHIVED' ? 'ARCHIVED' : undefined;
  const page = Math.max(1, Number(params.page) || 1);

  const { apiBaseUrl } = getWebEnv();
  const cookieHeader = await apiCookieHeader();
  const query = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (q) query.set('q', q);
  if (status) query.set('status', status);

  const response = await fetch(`${apiBaseUrl}/api/v1/customers?${query}`, {
    headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);

  if (!response?.ok) {
    return (
      <Alert variant="danger" title="Müşteri listesi alınamadı">
        API'ye ulaşılamadı — bir süre sonra tekrar deneyin.
      </Alert>
    );
  }
  const body = (await response.json()) as {
    data: CustomerRow[];
    pageInfo: { total: number; page: number; pageSize: number };
  };

  // hrefTemplate: serileştirilebilir (RSC sınırını güvenle geçer).
  const templateParams = new URLSearchParams({ page: '{page}' });
  if (q) templateParams.set('q', q);
  if (status) templateParams.set('status', status);
  const hrefTemplate = `/app/customers?${templateParams}`;

  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Müşteriler"
        subtitle="Müşteri kayıt defteri — kişiler, lokasyonlar ve ekipmanlarla birlikte."
        actions={<NewCustomerButton canManage={session.permissions.includes('customers:manage')} />}
      />

      <Panel title="Kayıt defteri" subtitle={`${body.pageInfo.total} müşteri`}>
        <CustomersSearch initialQuery={q} showArchived={status === 'ARCHIVED'} />
        {body.data.length === 0 ? (
          <p className="tf-panel__subtitle" style={{ padding: '18px' }}>
            {q ? `"${q}" aramasıyla eşleşen müşteri yok.` : 'Henüz müşteri kaydı yok.'}
          </p>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={body.data}
            getKey={(row) => row.customerId}
            aria-label="Müşteri listesi"
          />
        )}
        <div style={{ padding: '0 18px 14px' }}>
          <Pager
            page={body.pageInfo.page}
            pageSize={body.pageInfo.pageSize}
            total={body.pageInfo.total}
            label="Müşteri listesi"
            hrefTemplate={hrefTemplate}
          />
        </div>
      </Panel>
    </>
  );
}
