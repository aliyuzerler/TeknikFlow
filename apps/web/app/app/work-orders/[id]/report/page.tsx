import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession, apiCookieHeader } from '@/src/lib/session';
import { getWebEnv } from '@/src/load-env';
import { fetchExecutionReport } from '@teknikflow/api-client';
import {
  GPS_SOURCE_LABELS,
  MEDIA_KIND_LABELS,
  MEDIA_STATUS_LABELS,
  PRIORITY_LABELS,
  SIGNATURE_ROLE_LABELS,
  TIME_ENTRY_TYPE_LABELS,
  VISIT_MILESTONE_LABELS,
  WORK_ORDER_STATUS_LABELS,
} from '@teknikflow/contracts';
import {
  Alert,
  DetailList,
  PageHeader,
  Panel,
  StatusBadge,
  type BadgeTone,
} from '@teknikflow/ui-web/server';

export const metadata = { title: 'Yürütme Raporu — TeknikFlow' };

const STATUS_TONES: Record<string, BadgeTone> = {
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
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} sa` : `${hours} sa ${rest} dk`;
}

/** Strokes'u SVG polyline'lara çevirir (rapor görünümü — salt okunur). */
function SignatureSketch({
  strokes,
}: {
  strokes: Array<Array<{ x: number; y: number; t: number }>>;
}) {
  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      style={{
        width: 220,
        height: 88,
        border: '1px solid var(--tf-border)',
        borderRadius: 8,
        background: 'var(--tf-surface)',
      }}
      role="img"
      aria-label="İmza görünümü"
    >
      {strokes.map((stroke, index) => (
        <polyline
          key={index}
          points={stroke.map((point) => `${point.x * 100},${point.y * 40}`).join(' ')}
          fill="none"
          stroke="var(--tf-ink-900, #0f172a)"
          strokeWidth={0.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

export default async function ExecutionReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.membership) return null;

  const { id } = await params;
  const { apiBaseUrl } = getWebEnv();
  const cookieHeader = await apiCookieHeader();
  const result = await fetchExecutionReport(
    { baseUrl: apiBaseUrl, cookieHeader, timeoutMs: 10_000 },
    id,
  );
  if (!result.ok) {
    if (result.error.httpStatus === 404) notFound();
    return (
      <Alert variant="danger" title="Rapor yüklenemedi">
        {result.error.httpStatus === 403
          ? 'Bu iş emrine erişim yetkiniz yok.'
          : result.error.message}
      </Alert>
    );
  }
  const report = result.data;

  return (
    <>
      <PageHeader
        eyebrow={`${report.workOrderNo} · Yürütme Raporu`}
        title={report.subject}
        subtitle={`${report.customerName}${report.assetTag ? ` · ${report.assetTag}` : ''}`}
        actions={
          <Link href={`/app/work-orders/${report.workOrderId}`} className="tf-link">
            İş emrine dön
          </Link>
        }
      />

      <div className="tf-grid">
        <Panel title="Özet" headingLevel={2}>
          <DetailList
            label="Rapor özeti"
            columns={2}
            items={[
              {
                label: 'Durum',
                children: (
                  <StatusBadge tone={STATUS_TONES[report.status] ?? 'gray'}>
                    {WORK_ORDER_STATUS_LABELS[report.status]}
                  </StatusBadge>
                ),
              },
              { label: 'Öncelik', children: PRIORITY_LABELS[report.priority] },
              { label: 'Teknisyen', children: report.assignedToName ?? 'Atanmadı' },
              { label: 'Lokasyon', children: report.locationName ?? '—' },
              {
                label: 'Planlanan',
                children: `${formatDateTime(report.scheduledStart)} – ${formatDateTime(report.scheduledEnd)}`,
              },
              { label: 'Kabul', children: formatDateTime(report.acceptedAt) },
              { label: 'Başlama', children: formatDateTime(report.startedAt) },
              { label: 'Tamamlanma', children: formatDateTime(report.completedAt) },
              { label: 'Kapanış', children: formatDateTime(report.closedAt) },
            ]}
          />
        </Panel>

        <Panel title="İşgücü özeti" headingLevel={2}>
          <DetailList
            label="İşgücü özeti"
            columns={2}
            items={[
              { label: 'Seyahat', children: formatMinutes(report.labor.travelMinutes) },
              { label: 'Saha işi', children: formatMinutes(report.labor.laborMinutes) },
              { label: 'Bekleme', children: formatMinutes(report.labor.waitingMinutes) },
              {
                label: 'Toplam',
                children: <strong>{formatMinutes(report.labor.totalMinutes)}</strong>,
              },
              {
                label: 'Açık kayıt',
                children: report.labor.openEntry ? 'Evet — süre devam ediyor' : 'Hayır',
              },
            ]}
          />
        </Panel>

        <Panel title="Konum kayıtları" headingLevel={2} subtitle={`${report.visits.length} kayıt`}>
          {report.visits.length === 0 ? (
            <p className="tf-panel__subtitle">Varış kaydı yok.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {report.visits.map((visit) => (
                <li
                  key={visit.visitId}
                  style={{ borderBottom: '1px solid var(--tf-border)', paddingBottom: 8 }}
                >
                  <div
                    style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}
                  >
                    <StatusBadge tone={visit.milestone === 'ARRIVED' ? 'green' : 'gray'}>
                      {VISIT_MILESTONE_LABELS[visit.milestone]}
                    </StatusBadge>
                    <span style={{ fontSize: 14 }}>
                      {visit.latitude !== null && visit.longitude !== null
                        ? `${visit.latitude.toFixed(5)}, ${visit.longitude.toFixed(5)} · ±${Math.round(visit.accuracyMeters ?? 0)} m`
                        : 'Koordinat yok'}
                    </span>
                    <StatusBadge tone={visit.source === 'GPS' ? 'blue' : 'amber'}>
                      {GPS_SOURCE_LABELS[visit.source]}
                      {visit.manualReason ? `: ${visit.manualReason}` : ''}
                    </StatusBadge>
                    <span className="tf-table__sub" style={{ marginLeft: 'auto' }}>
                      {visit.userName ?? '—'} · {formatDateTime(visit.recordedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Checklist"
          headingLevel={2}
          subtitle={
            report.requiredChecklistRemaining > 0
              ? `${report.requiredChecklistRemaining} zorunlu madde eksik`
              : 'Tüm zorunlu maddeler tamam'
          }
        >
          {report.checklist.length === 0 ? (
            <p className="tf-panel__subtitle">Checklist yok.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {report.checklist.map((item) => (
                <li
                  key={item.itemId}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'baseline',
                    borderBottom: '1px solid var(--tf-border)',
                    paddingBottom: 8,
                  }}
                >
                  <StatusBadge tone={item.done ? 'green' : item.required ? 'red' : 'gray'}>
                    {item.done ? '✓' : item.required ? '! zorunlu' : '○'}
                  </StatusBadge>
                  <span style={{ fontSize: 14, flex: 1 }}>
                    {item.label}
                    {item.note ? <span className="tf-panel__subtitle"> — {item.note}</span> : null}
                  </span>
                  <span className="tf-table__sub">
                    {item.doneByName ?? '—'} · {formatDateTime(item.doneAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Süre kayıtları"
          headingLevel={2}
          subtitle={`${report.timeEntries.length} kayıt`}
        >
          {report.timeEntries.length === 0 ? (
            <p className="tf-panel__subtitle">Süre kaydı yok.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {report.timeEntries.map((entry) => (
                <li
                  key={entry.timeEntryId}
                  style={{
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                    alignItems: 'baseline',
                    borderBottom: '1px solid var(--tf-border)',
                    paddingBottom: 8,
                  }}
                >
                  <StatusBadge tone={entry.status === 'OPEN' ? 'green' : 'gray'}>
                    {TIME_ENTRY_TYPE_LABELS[entry.type]}
                  </StatusBadge>
                  <span style={{ fontSize: 14 }}>
                    {formatDateTime(entry.startedAt)} → {formatDateTime(entry.endedAt)}
                  </span>
                  <span className="tf-table__sub" style={{ marginLeft: 'auto' }}>
                    {entry.durationMinutes !== null
                      ? formatMinutes(entry.durationMinutes)
                      : 'devam ediyor'}{' '}
                    · {entry.userName ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Medya" headingLevel={2} subtitle={`${report.media.length} dosya`}>
          {report.media.length === 0 ? (
            <p className="tf-panel__subtitle">Medya yok.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {report.media.map((media) => (
                <li
                  key={media.mediaId}
                  style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}
                >
                  <StatusBadge
                    tone={
                      media.status === 'READY'
                        ? 'green'
                        : media.status === 'FAILED'
                          ? 'red'
                          : 'amber'
                    }
                  >
                    {MEDIA_KIND_LABELS[media.kind]}
                  </StatusBadge>
                  <span style={{ fontSize: 14 }}>{media.fileName}</span>
                  <span className="tf-panel__subtitle">
                    {MEDIA_STATUS_LABELS[media.status]}
                    {media.failureCode ? ` (${media.failureCode})` : ''}
                  </span>
                  <span className="tf-table__sub" style={{ marginLeft: 'auto' }}>
                    {(media.sizeBytes / 1024).toFixed(0)} KB · {formatDateTime(media.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="İmzalar" headingLevel={2} subtitle={`${report.signatures.length} kayıt`}>
          {report.signatures.length === 0 ? (
            <p className="tf-panel__subtitle">
              İmza yok — kapatma kanıt kapısı için en az bir imza gerekir.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
              {report.signatures.map((signature) => (
                <li
                  key={signature.signatureId}
                  style={{
                    display: 'flex',
                    gap: 14,
                    alignItems: 'center',
                    borderBottom: '1px solid var(--tf-border)',
                    paddingBottom: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <SignatureSketch strokes={signature.strokes} />
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div
                      style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}
                    >
                      <strong style={{ fontSize: 14 }}>{signature.signerName}</strong>
                      <StatusBadge tone={signature.role === 'CUSTOMER' ? 'blue' : 'gray'}>
                        {SIGNATURE_ROLE_LABELS[signature.role]}
                      </StatusBadge>
                      {signature.supersededById ? (
                        <StatusBadge tone="amber">düzeltmeyle geçersiz</StatusBadge>
                      ) : null}
                    </div>
                    <p className="tf-panel__subtitle" style={{ margin: '4px 0 0' }}>
                      {signature.capturedByName ?? '—'} · {signature.pointCount} nokta ·{' '}
                      {formatDateTime(signature.signedAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <p className="tf-panel__subtitle" style={{ marginTop: 16 }}>
        Rapor anlık görüntüsü: {formatDateTime(report.generatedAt)}
      </p>
    </>
  );
}
