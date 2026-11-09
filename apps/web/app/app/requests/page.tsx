import { getSession, apiCookieHeader } from '@/src/lib/session';
import { getWebEnv } from '@/src/load-env';
import { listServiceRequests } from '@teknikflow/api-client';
import {
  PRIORITY_LABELS,
  REQUEST_SOURCE_LABELS,
  REQUEST_STATUS_LABELS,
  type ServiceRequestView,
} from '@teknikflow/contracts';
import {
  Alert,
  DataTable,
  PageHeader,
  Pager,
  Panel,
  StatusBadge,
  type DataTableColumn,
} from '@teknikflow/ui-web/server';
import { RequestsSearch } from './search';
import { NewRequestButton } from './new-request';

export const metadata = { title: 'Servis Talepleri — TeknikFlow' };

/**
 * Faz 05 — /app/requests: servis talepleri gelen kutusu (intake).
 * Arama/durum/sayfalama URL parametreli (yenilenmeye dayanıklı); SLA aşımı
 * görünür rozetle kodlanır (renk + metin — renk tek başına gösterge değil).
 */

type RequestRow = Pick<
  ServiceRequestView,
  | 'requestId'
  | 'subject'
  | 'customerName'
  | 'categoryName'
  | 'priority'
  | 'status'
  | 'slaDueAt'
  | 'slaBreached'
  | 'source'
  | 'convertedWorkOrderNo'
>;

const PRIORITY_TONES = { LOW: 'gray', MEDIUM: 'blue', HIGH: 'amber', URGENT: 'red' } as const;

const COLUMNS: Array<DataTableColumn<RequestRow>> = [
  {
    key: 'subject',
    header: 'Konu',
    render: (row) => (
      <a className="tf-table__customer" href={`/app/requests/${row.requestId}`}>
        {row.subject}
        <div className="tf-table__sub">{row.customerName}</div>
      </a>
    ),
  },
  { key: 'categoryName', header: 'Kategori', render: (row) => row.categoryName ?? '—' },
  {
    key: 'priority',
    header: 'Öncelik',
    render: (row) => (
      <StatusBadge tone={PRIORITY_TONES[row.priority]}>{PRIORITY_LABELS[row.priority]}</StatusBadge>
    ),
  },
  {
    key: 'sla',
    header: 'SLA',
    render: (row) =>
      row.slaDueAt ? (
        row.slaBreached ? (
          <StatusBadge tone="red">SLA Aşıldı</StatusBadge>
        ) : (
          <span className="tf-table__sub">{formatDateTime(row.slaDueAt)}</span>
        )
      ) : (
        '—'
      ),
  },
  { key: 'source', header: 'Kaynak', render: (row) => REQUEST_SOURCE_LABELS[row.source] },
  {
    key: 'status',
    header: 'Durum',
    render: (row) => {
      if (row.status === 'CONVERTED' && row.convertedWorkOrderNo) {
        return (
          <a href={`/app/requests/${row.requestId}`}>
            <StatusBadge tone="green">{row.convertedWorkOrderNo}</StatusBadge>
          </a>
        );
      }
      const tone =
        row.status === 'NEW'
          ? 'blue'
          : row.status === 'IN_REVIEW'
            ? 'amber'
            : row.status === 'CANCELLED'
              ? 'red'
              : 'green';
      return <StatusBadge tone={tone}>{REQUEST_STATUS_LABELS[row.status]}</StatusBadge>;
    },
  },
];

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session?.membership) return null;
  const canView =
    session.permissions.includes('service_requests:create') ||
    session.permissions.includes('work_orders:view_all');
  if (!canView) {
    return (
      <Alert variant="warning" title="Bu bölüm için yetkiniz yok">
        Servis talepleri yalnızca planlamacı ve yönetici rollerine açıktır.
      </Alert>
    );
  }

  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : '';
  const status =
    typeof params.status === 'string' &&
    ['NEW', 'IN_REVIEW', 'CONVERTED', 'CANCELLED'].includes(params.status)
      ? (params.status as 'NEW' | 'IN_REVIEW' | 'CONVERTED' | 'CANCELLED')
      : undefined;
  const page = Math.max(1, Number(params.page) || 1);

  const { apiBaseUrl } = getWebEnv();
  const cookieHeader = await apiCookieHeader();
  const result = await listServiceRequests(
    { baseUrl: apiBaseUrl, cookieHeader, timeoutMs: 10_000 },
    { page, pageSize: 10, ...(q ? { q } : {}), ...(status ? { status } : {}) },
  );

  // Yeni talep çekmecesi için müşteri seçenekleri (ilk 100).
  const customers = await fetch(`${apiBaseUrl}/api/v1/customers?pageSize=100`, {
    headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  })
    .then((response) =>
      response.ok
        ? (response.json() as Promise<{ data: Array<{ customerId: string; name: string }> }>)
        : null,
    )
    .catch(() => null);

  const rows: RequestRow[] = result.ok
    ? result.data.data.map((r) => ({
        requestId: r.requestId,
        subject: r.subject,
        customerName: r.customerName,
        categoryName: r.categoryName,
        priority: r.priority,
        status: r.status,
        slaDueAt: r.slaDueAt,
        slaBreached: r.slaBreached,
        source: r.source,
        convertedWorkOrderNo: r.convertedWorkOrderNo,
      }))
    : [];

  const canCreate = session.permissions.includes('service_requests:create');
  const templateParams = new URLSearchParams({ page: '{page}' });
  if (q) templateParams.set('q', q);
  if (status) templateParams.set('status', status);

  return (
    <>
      <PageHeader
        eyebrow="Servis Akışı"
        title="Servis Talepleri"
        subtitle="Gelen talepleri triyaj edin, SLA'yı izleyin ve iş emrine dönüştürün."
        actions={canCreate ? <NewRequestButton customers={customers?.data ?? []} /> : null}
      />
      <Panel
        title="Gelen kutusu"
        subtitle={result.ok ? `${result.data.pageInfo.total} talep` : undefined}
      >
        <RequestsSearch initialQuery={q} status={status} />
        {result.ok ? (
          <DataTable
            columns={COLUMNS}
            rows={rows}
            getKey={(row) => row.requestId}
            aria-label="Servis talepleri"
            empty={
              <p className="tf-panel__subtitle" style={{ padding: '18px' }}>
                {q || status ? 'Bu filtrelerle eşleşen talep yok.' : 'Henüz servis talebi yok.'}
              </p>
            }
          />
        ) : (
          <div style={{ padding: 18 }}>
            <Alert variant="danger" title="Talepler yüklenemedi">
              {result.error.message} — bir süre sonra tekrar deneyin.
            </Alert>
          </div>
        )}
        {result.ok && result.data.pageInfo.total > result.data.pageInfo.pageSize ? (
          <div style={{ padding: '0 18px 14px' }}>
            <Pager
              page={result.data.pageInfo.page}
              pageSize={result.data.pageInfo.pageSize}
              total={result.data.pageInfo.total}
              label="Talep listesi"
              hrefTemplate={`/app/requests?${templateParams}`}
            />
          </div>
        ) : null}
      </Panel>
    </>
  );
}
