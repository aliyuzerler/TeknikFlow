import { notFound } from 'next/navigation';
import { getSession, apiCookieHeader } from '@/src/lib/session';
import { getWebEnv } from '@/src/load-env';
import { fetchServiceRequest } from '@teknikflow/api-client';
import {
  CANCELLATION_REASON_LABELS,
  PRIORITY_LABELS,
  REQUEST_SOURCE_LABELS,
  REQUEST_STATUS_LABELS,
  type ServiceRequestView,
} from '@teknikflow/contracts';
import {
  Alert,
  DetailList,
  PageHeader,
  Panel,
  StatusBadge,
  Timeline,
  type TimelineItem,
} from '@teknikflow/ui-web/server';
import { TriageForm } from './triage-form';
import { ConvertForm } from './convert-form';
import { CancelRequestButton } from './cancel-request';

export const metadata = { title: 'Servis Talebi — TeknikFlow' };

const PRIORITY_TONES = { LOW: 'gray', MEDIUM: 'blue', HIGH: 'amber', URGENT: 'red' } as const;

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.membership) return null;
  const canManage = session.permissions.includes('service_requests:create');
  const canConvert = session.permissions.includes('work_orders:create');

  const { id } = await params;
  const { apiBaseUrl } = getWebEnv();
  const cookieHeader = await apiCookieHeader();
  const ctx = { baseUrl: apiBaseUrl, cookieHeader, timeoutMs: 10_000 };

  const result = await fetchServiceRequest(ctx, id);
  if (!result.ok) {
    if (result.error.httpStatus === 404) notFound();
    return (
      <Alert variant="danger" title="Talep yüklenemedi">
        {result.error.message}
      </Alert>
    );
  }
  const request: ServiceRequestView = result.data;

  // Yardımcı veriler: kategoriler, şubeler, etkinlik geçmişi.
  const [categories, branches, events] = await Promise.all([
    fetch(`${apiBaseUrl}/api/v1/service-requests/categories`, {
      headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    })
      .then((r) =>
        r.ok ? (r.json() as Promise<{ data: Array<{ categoryId: string; name: string }> }>) : null,
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
    fetch(`${apiBaseUrl}/api/v1/service-requests/${id}/events`, {
      headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{
              data: Array<{ eventId: string; eventType: string; occurredAt: string }>;
            }>)
          : null,
      )
      .catch(() => null),
  ]);

  const open = request.status === 'NEW' || request.status === 'IN_REVIEW';
  const statusTone =
    request.status === 'NEW'
      ? 'blue'
      : request.status === 'IN_REVIEW'
        ? 'amber'
        : request.status === 'CANCELLED'
          ? 'red'
          : 'green';

  const timelineItems: TimelineItem[] = (events?.data ?? []).map((event) => ({
    id: event.eventId,
    title: EVENT_LABELS[event.eventType] ?? event.eventType,
    meta: formatDateTime(event.occurredAt),
    tone: event.eventType.endsWith('cancelled')
      ? 'danger'
      : event.eventType.endsWith('converted')
        ? 'success'
        : 'neutral',
  }));

  return (
    <>
      <PageHeader
        eyebrow="Servis Talebi"
        title={request.subject}
        subtitle={`${request.customerName}${request.assetTag ? ` · ${request.assetTag}` : ''}`}
        actions={open && canManage ? <CancelRequestButton requestId={request.requestId} /> : null}
      />

      {request.status === 'CANCELLED' ? (
        <Alert variant="warning" title="Talep iptal edildi">
          Neden:{' '}
          {request.cancellationReason
            ? CANCELLATION_REASON_LABELS[request.cancellationReason]
            : '—'}
        </Alert>
      ) : null}

      <div className="tf-grid">
        <Panel title="Talep bilgileri" headingLevel={2}>
          <DetailList
            label="Talep bilgileri"
            columns={2}
            items={[
              {
                label: 'Durum',
                children: (
                  <StatusBadge tone={statusTone}>
                    {REQUEST_STATUS_LABELS[request.status]}
                  </StatusBadge>
                ),
              },
              {
                label: 'Öncelik',
                children: (
                  <StatusBadge tone={PRIORITY_TONES[request.priority]}>
                    {PRIORITY_LABELS[request.priority]}
                  </StatusBadge>
                ),
              },
              { label: 'Kategori', children: request.categoryName ?? '—' },
              { label: 'Kaynak', children: REQUEST_SOURCE_LABELS[request.source] },
              {
                label: 'SLA hedefi',
                children: request.slaDueAt ? (
                  request.slaBreached ? (
                    <StatusBadge tone="red">
                      Aşıldı — {formatDateTime(request.slaDueAt)}
                    </StatusBadge>
                  ) : (
                    formatDateTime(request.slaDueAt)
                  )
                ) : (
                  '—'
                ),
              },
              { label: 'Oluşturuldu', children: formatDateTime(request.createdAt) },
              { label: 'Açıklama', children: request.description ?? '—' },
              {
                label: 'İş emri',
                children:
                  request.convertedWorkOrderId && request.convertedWorkOrderNo ? (
                    <a href={`/app/work-orders/${request.convertedWorkOrderId}`}>
                      {request.convertedWorkOrderNo}
                    </a>
                  ) : open ? (
                    'Henüz üretilmedi'
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        </Panel>

        {open && canManage ? (
          <TriageForm request={request} categories={categories?.data ?? []} />
        ) : null}

        {open && canConvert ? (
          <ConvertForm request={request} branches={branches?.data ?? []} />
        ) : null}

        <Panel title="Etkinlik geçmişi" headingLevel={2}>
          <Timeline label="Talep etkinlikleri" items={timelineItems} />
        </Panel>
      </div>
    </>
  );
}

const EVENT_LABELS: Record<string, string> = {
  'service_request.created': 'Talep oluşturuldu',
  'service_request.updated': 'Talep güncellendi (triyaj)',
  'service_request.converted': 'İş emrine dönüştürüldü',
  'service_request.cancelled': 'Talep iptal edildi',
};
