import { notFound } from 'next/navigation';
import { getSession, apiCookieHeader } from '@/src/lib/session';
import { getWebEnv } from '@/src/load-env';
import { fetchWorkOrder } from '@teknikflow/api-client';
import {
  CANCELLATION_REASON_LABELS,
  PRIORITY_LABELS,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_TYPE_LABELS,
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
import { WorkOrderActions } from './work-order-actions';
import { EditWorkOrderButton } from './edit-work-order';
import { NoteForm } from './note-form';

export const metadata = { title: 'İş Emri — TeknikFlow' };

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

const EVENT_LABELS: Record<string, string> = {
  'work_order.created': 'İş emri oluşturuldu',
  'work_order.state_changed': 'Durum değişti',
  'work_order.assigned': 'Teknisyen atandı',
  'work_order.unassigned': 'Atama kaldırıldı',
  'work_order.cancelled': 'İptal edildi',
  'work_order.note_added': 'Not eklendi',
  'work_order.updated': 'Güncellendi',
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.membership) return null;

  const { id } = await params;
  const { apiBaseUrl } = getWebEnv();
  const cookieHeader = await apiCookieHeader();
  const result = await fetchWorkOrder({ baseUrl: apiBaseUrl, cookieHeader, timeoutMs: 10_000 }, id);
  if (!result.ok) {
    if (result.error.httpStatus === 404) notFound();
    return (
      <Alert variant="danger" title="İş emri yüklenemedi">
        {result.error.httpStatus === 403
          ? 'Bu iş emrine erişim yetkiniz yok.'
          : result.error.message}
      </Alert>
    );
  }
  const workOrder = result.data;

  // Şubeler (planlama/düzenleme çekmeceleri için).
  const branches = await fetch(`${apiBaseUrl}/api/v1/tenants/current/branches`, {
    headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  })
    .then((r) =>
      r.ok ? (r.json() as Promise<{ data: Array<{ branchId: string; name: string }> }>) : null,
    )
    .catch(() => null);

  const permissions = [...session.permissions];
  const isAssignee = workOrder.assignedToId === session.user.userId;
  const canEdit =
    permissions.includes('work_orders:create') || permissions.includes('work_orders:dispatch');
  const editable = workOrder.status !== 'CLOSED' && workOrder.status !== 'CANCELLED';

  const timelineItems: TimelineItem[] = workOrder.events.map((event) => {
    const metadata = event.metadata as Record<string, unknown>;
    let description: string | null = null;
    if (event.eventType === 'work_order.state_changed' && event.fromState && event.toState) {
      description = `${WORK_ORDER_STATUS_LABELS[event.fromState]} → ${WORK_ORDER_STATUS_LABELS[event.toState]}`;
    }
    if (event.eventType === 'work_order.note_added' && typeof metadata.visibility === 'string') {
      description = metadata.visibility === 'CUSTOMER' ? 'Müşteri görünür not' : 'Dahili not';
    }
    if (event.eventType === 'work_order.cancelled' && typeof metadata.reasonCode === 'string') {
      const reason = metadata.reasonCode as keyof typeof CANCELLATION_REASON_LABELS;
      description = `Neden: ${CANCELLATION_REASON_LABELS[reason] ?? reason}`;
    }
    const tone =
      event.eventType === 'work_order.cancelled'
        ? 'danger'
        : event.toState === 'COMPLETED' || event.toState === 'CLOSED'
          ? 'success'
          : event.toState === 'WAITING_PARTS' || event.toState === 'WAITING_CUSTOMER'
            ? 'warning'
            : 'neutral';
    return {
      id: event.eventId,
      title: EVENT_LABELS[event.eventType] ?? event.eventType,
      description,
      meta: `${event.actorName ?? 'Sistem'} · ${formatDateTime(event.occurredAt)}`,
      tone,
    };
  });

  return (
    <>
      <PageHeader
        eyebrow={workOrder.workOrderNo}
        title={workOrder.subject}
        subtitle={`${workOrder.customerName}${workOrder.assetTag ? ` · ${workOrder.assetTag}` : ''}`}
        actions={
          canEdit && editable ? (
            <EditWorkOrderButton workOrder={workOrder} branches={branches?.data ?? []} />
          ) : null
        }
      />

      {workOrder.status === 'CANCELLED' ? (
        <Alert variant="warning" title="İş emri iptal edildi">
          Neden:{' '}
          {workOrder.cancellationReason
            ? CANCELLATION_REASON_LABELS[workOrder.cancellationReason]
            : '—'}
          {workOrder.description ? '' : ''}
        </Alert>
      ) : null}

      <div className="tf-grid">
        <Panel title="İş emri bilgileri" headingLevel={2}>
          <DetailList
            label="İş emri bilgileri"
            columns={2}
            items={[
              {
                label: 'Durum',
                children: (
                  <StatusBadge tone={STATUS_TONES[workOrder.status]}>
                    {WORK_ORDER_STATUS_LABELS[workOrder.status]}
                  </StatusBadge>
                ),
              },
              {
                label: 'Öncelik',
                children: (
                  <StatusBadge tone={PRIORITY_TONES[workOrder.priority]}>
                    {PRIORITY_LABELS[workOrder.priority]}
                  </StatusBadge>
                ),
              },
              { label: 'İş türü', children: WORK_ORDER_TYPE_LABELS[workOrder.type] },
              {
                label: 'Müşteri',
                children: (
                  <a href={`/app/customers/${workOrder.customerId}`}>{workOrder.customerName}</a>
                ),
              },
              { label: 'Ekipman', children: workOrder.assetTag ?? '—' },
              { label: 'Şube', children: workOrder.branchName ?? '—' },
              { label: 'Planlanan başlangıç', children: formatDateTime(workOrder.scheduledStart) },
              { label: 'Planlanan bitiş', children: formatDateTime(workOrder.scheduledEnd) },
              { label: 'Teknisyen', children: workOrder.assignedToName ?? 'Atanmadı' },
              {
                label: 'Servis talebi',
                children: workOrder.requestId ? (
                  <a href={`/app/requests/${workOrder.requestId}`}>Talebe git</a>
                ) : (
                  'Doğrudan oluşturuldu'
                ),
              },
              { label: 'Kabul', children: formatDateTime(workOrder.acceptedAt) },
              { label: 'Başlama', children: formatDateTime(workOrder.startedAt) },
              { label: 'Tamamlanma', children: formatDateTime(workOrder.completedAt) },
              { label: 'Kapanış', children: formatDateTime(workOrder.closedAt) },
              { label: 'Açıklama', children: workOrder.description ?? '—' },
            ]}
          />
        </Panel>

        <WorkOrderActions
          workOrderId={workOrder.workOrderId}
          status={workOrder.status}
          version={workOrder.version}
          permissions={permissions}
          isAssignee={isAssignee}
          branches={branches?.data ?? []}
        />

        <Panel title="Notlar" headingLevel={2} subtitle={`${workOrder.notes.length} not`}>
          {workOrder.notes.length === 0 ? (
            <p className="tf-panel__subtitle" style={{ marginBottom: 12 }}>
              Henüz not yok.
            </p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: '0 0 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {workOrder.notes.map((note) => (
                <li
                  key={note.noteId}
                  style={{ borderBottom: '1px solid var(--tf-border)', paddingBottom: 10 }}
                >
                  <div
                    style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}
                  >
                    <strong style={{ fontSize: 14 }}>{note.authorName ?? 'Bilinmeyen'}</strong>
                    <StatusBadge tone={note.visibility === 'CUSTOMER' ? 'blue' : 'gray'}>
                      {note.visibility === 'CUSTOMER' ? 'Müşteri görünür' : 'Dahili'}
                    </StatusBadge>
                    <span className="tf-table__sub" style={{ marginLeft: 'auto' }}>
                      {formatDateTime(note.createdAt)}
                    </span>
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: 14 }}>{note.body}</p>
                </li>
              ))}
            </ul>
          )}
          <NoteForm workOrderId={workOrder.workOrderId} />
        </Panel>

        {workOrder.assignments.length > 0 ? (
          <Panel title="Atama geçmişi" headingLevel={2}>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {workOrder.assignments.map((assignment) => (
                <li
                  key={assignment.assignmentId}
                  style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}
                >
                  <strong style={{ fontSize: 14 }}>{assignment.userName ?? '—'}</strong>
                  <StatusBadge tone={assignment.status === 'ACTIVE' ? 'green' : 'gray'}>
                    {assignment.status === 'ACTIVE' ? 'Aktif' : 'Kaldırıldı'}
                  </StatusBadge>
                  <span className="tf-table__sub" style={{ marginLeft: 'auto' }}>
                    {formatDateTime(assignment.assignedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <Panel title="Zaman çizelgesi" headingLevel={2}>
          <Timeline label="İş emri zaman çizelgesi" items={timelineItems} />
        </Panel>
      </div>
    </>
  );
}
