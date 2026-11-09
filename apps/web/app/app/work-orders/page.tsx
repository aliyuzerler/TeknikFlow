import { getSession, apiCookieHeader } from '@/src/lib/session';
import { getWebEnv } from '@/src/load-env';
import { listWorkOrders } from '@teknikflow/api-client';
import {
  PRIORITY_LABELS,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_TYPE_LABELS,
  type WorkOrderView,
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
import { WorkOrdersSearch } from './search';
import { NewWorkOrderButton } from './new-work-order';

export const metadata = { title: 'İş Emirleri — TeknikFlow' };

/**
 * Faz 05 — /app/work-orders: iş emri listesi.
 * Yetki: view_all (tümü) veya view_assigned (teknisyen — yalnız kendi işleri;
 * filtre API tarafında zorlanır, gizleme UX&apos;ten ibarettir).
 */

type WorkOrderRow = Pick<
  WorkOrderView,
  | 'workOrderId'
  | 'workOrderNo'
  | 'subject'
  | 'customerName'
  | 'type'
  | 'priority'
  | 'status'
  | 'assignedToName'
  | 'scheduledStart'
>;

const PRIORITY_TONES = { LOW: 'gray', MEDIUM: 'blue', HIGH: 'amber', URGENT: 'red' } as const;

const STATUS_TONES = {
  DRAFT: 'gray',
  PLANNED: 'blue',
  ASSIGNED: 'blue',
  ACCEPTED: 'blue',
  EN_ROUTE: 'blue',
  ON_SITE: 'blue',
  IN_PROGRESS: 'info',
  WAITING_PARTS: 'amber',
  WAITING_CUSTOMER: 'amber',
  COMPLETED: 'green',
  CLOSED: 'gray',
  CANCELLED: 'red',
} as const;

const COLUMNS: Array<DataTableColumn<WorkOrderRow>> = [
  {
    key: 'workOrderNo',
    header: 'İş emri',
    render: (row) => (
      <a className="tf-table__customer" href={`/app/work-orders/${row.workOrderId}`}>
        {row.workOrderNo}
        <div className="tf-table__sub">{WORK_ORDER_TYPE_LABELS[row.type]}</div>
      </a>
    ),
  },
  {
    key: 'subject',
    header: 'Konu',
    render: (row) => (
      <span>
        <span className="tf-table__customer">{row.subject}</span>
        <div className="tf-table__sub">{row.customerName}</div>
      </span>
    ),
  },
  {
    key: 'priority',
    header: 'Öncelik',
    render: (row) => (
      <StatusBadge tone={PRIORITY_TONES[row.priority]}>{PRIORITY_LABELS[row.priority]}</StatusBadge>
    ),
  },
  {
    key: 'assignedToName',
    header: 'Teknisyen',
    render: (row) => row.assignedToName ?? '—',
  },
  {
    key: 'scheduledStart',
    header: 'Planlanan',
    render: (row) => (row.scheduledStart ? formatDate(row.scheduledStart) : '—'),
  },
  {
    key: 'status',
    header: 'Durum',
    render: (row) => (
      <StatusBadge tone={STATUS_TONES[row.status]}>
        {WORK_ORDER_STATUS_LABELS[row.status]}
      </StatusBadge>
    ),
  },
];

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

const STATUS_VALUES = Object.keys(WORK_ORDER_STATUS_LABELS) as Array<
  keyof typeof WORK_ORDER_STATUS_LABELS
>;

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session?.membership) return null;
  const canView =
    session.permissions.includes('work_orders:view_all') ||
    session.permissions.includes('work_orders:view_assigned');
  if (!canView) {
    return (
      <Alert variant="warning" title="Bu bölüm için yetkiniz yok">
        İş emirleri planlamacı, yönetici ve teknisyen rollerine açıktır.
      </Alert>
    );
  }

  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : '';
  const status =
    typeof params.status === 'string' && STATUS_VALUES.includes(params.status as never)
      ? (params.status as keyof typeof WORK_ORDER_STATUS_LABELS)
      : undefined;
  const page = Math.max(1, Number(params.page) || 1);

  const { apiBaseUrl } = getWebEnv();
  const cookieHeader = await apiCookieHeader();
  const result = await listWorkOrders(
    { baseUrl: apiBaseUrl, cookieHeader, timeoutMs: 10_000 },
    { page, pageSize: 10, ...(q ? { q } : {}), ...(status ? { status } : {}) },
  );

  const rows: WorkOrderRow[] = result.ok
    ? result.data.data.map((w) => ({
        workOrderId: w.workOrderId,
        workOrderNo: w.workOrderNo,
        subject: w.subject,
        customerName: w.customerName,
        type: w.type,
        priority: w.priority,
        status: w.status,
        assignedToName: w.assignedToName,
        scheduledStart: w.scheduledStart,
      }))
    : [];

  // Yeni iş emri çekmecesi için müşteriler + şubeler.
  const [customers, branches] = await Promise.all([
    fetch(`${apiBaseUrl}/api/v1/customers?pageSize=100`, {
      headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    })
      .then((r) =>
        r.ok ? (r.json() as Promise<{ data: Array<{ customerId: string; name: string }> }>) : null,
      )
      .catch(() => null),
    fetch(`${apiBaseUrl}/api/v1/tenants/current/branches`, {
      headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    })
      .then((r) =>
        r.ok ? (r.json() as Promise<{ data: Array<{ branchId: string; name: string }> }>) : null,
      )
      .catch(() => null),
  ]);

  const canCreate = session.permissions.includes('work_orders:create');
  const templateParams = new URLSearchParams({ page: '{page}' });
  if (q) templateParams.set('q', q);
  if (status) templateParams.set('status', status);

  return (
    <>
      <PageHeader
        eyebrow="Servis Akışı"
        title="İş Emirleri"
        subtitle="Yaşam döngüsü durumu, atanan teknisyen ve planlamayla birlikte."
        actions={
          canCreate ? (
            <NewWorkOrderButton customers={customers?.data ?? []} branches={branches?.data ?? []} />
          ) : null
        }
      />
      <Panel
        title="Tüm işler"
        subtitle={
          result.ok
            ? session.permissions.includes('work_orders:view_all')
              ? `${result.data.pageInfo.total} iş emri`
              : 'Size atanmış işler'
            : undefined
        }
      >
        <WorkOrdersSearch initialQuery={q} status={status} />
        {result.ok ? (
          <DataTable
            columns={COLUMNS}
            rows={rows}
            getKey={(row) => row.workOrderId}
            aria-label="İş emri listesi"
            empty={
              <p className="tf-panel__subtitle" style={{ padding: '18px' }}>
                {q || status ? 'Bu filtrelerle eşleşen iş emri yok.' : 'Henüz iş emri yok.'}
              </p>
            }
          />
        ) : (
          <div style={{ padding: 18 }}>
            <Alert variant="danger" title="İş emirleri yüklenemedi">
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
              label="İş emri listesi"
              hrefTemplate={`/app/work-orders?${templateParams}`}
            />
          </div>
        ) : null}
      </Panel>
    </>
  );
}
