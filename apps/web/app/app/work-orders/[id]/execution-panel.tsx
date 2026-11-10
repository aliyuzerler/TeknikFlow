'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, FormField, Panel, SignaturePad, StatusBadge } from '@teknikflow/ui-web';
import {
  SIGNATURE_ROLE_LABELS,
  TIME_ENTRY_TYPE_LABELS,
  type CaptureSignatureRequest,
  type ChecklistItemView,
  type SignatureView,
  type TimeEntryView,
} from '@teknikflow/contracts';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/**
 * Faz 08 — web yürütme paneli: checklist tamamlama, süre kaydı başlat/
 * durdur ve imza yakalama. Sunucu tarafı yetki denetimi birincildir;
 * buradaki düğme görünürlüğü UX türetmesi.
 */

interface ExecutionPanelProps {
  workOrderId: string;
  status: string;
  permissions: string[];
  isAssignee: boolean;
}

export function ExecutionPanel({
  workOrderId,
  status,
  permissions,
  isAssignee,
}: ExecutionPanelProps) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItemView[] | null>(null);
  const [timeEntries, setTimeEntries] = useState<TimeEntryView[] | null>(null);
  const [signatures, setSignatures] = useState<SignatureView[] | null>(null);
  const [signerName, setSignerName] = useState('');
  const [strokes, setStrokes] = useState<Array<Array<{ x: number; y: number; t: number }>>>([]);
  const [signerRole, setSignerRole] = useState<'CUSTOMER' | 'TECHNICIAN'>('CUSTOMER');

  const terminal = status === 'CLOSED' || status === 'CANCELLED';
  const canExecute =
    permissions.includes('work_orders:complete') &&
    (permissions.includes('work_orders:view_all') || isAssignee);
  const canCaptureSignature =
    permissions.includes('signature:capture') &&
    (permissions.includes('work_orders:view_all') || isAssignee);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const headers = { accept: 'application/json' };
      const [checklistRes, timeRes, signatureRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/v1/work-orders/${workOrderId}/checklist-items`, {
          headers,
          credentials: 'include',
          signal: AbortSignal.timeout(6000),
        }).catch(() => null),
        fetch(`${apiBaseUrl}/api/v1/work-orders/${workOrderId}/time-entries`, {
          headers,
          credentials: 'include',
          signal: AbortSignal.timeout(6000),
        }).catch(() => null),
        fetch(`${apiBaseUrl}/api/v1/work-orders/${workOrderId}/signatures`, {
          headers,
          credentials: 'include',
          signal: AbortSignal.timeout(6000),
        }).catch(() => null),
      ]);
      if (cancelled) return;
      setChecklist(
        checklistRes && checklistRes.ok ? ((await checklistRes.json()).data ?? []) : null,
      );
      setTimeEntries(timeRes && timeRes.ok ? ((await timeRes.json()).data ?? []) : null);
      setSignatures(
        signatureRes && signatureRes.ok ? ((await signatureRes.json()).data ?? []) : null,
      );
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workOrderId, apiBaseUrl]);

  async function mutate(
    path: string,
    method: 'POST' | 'PATCH',
    body: unknown,
    successInfo: string,
  ) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const response = await fetch(`${apiBaseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      if (!response) {
        setError('Ağa ulaşılamadı');
        return false;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
      };
      if (!response.ok) {
        setError(payload.message ?? 'İşlem başarısız');
        return false;
      }
      setInfo(successInfo);
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function toggleChecklistItem(item: ChecklistItemView) {
    const ok = await mutate(
      `/api/v1/work-orders/${workOrderId}/checklist-items/${item.itemId}`,
      'PATCH',
      { done: !item.done },
      item.done ? 'Madde geri alındı.' : 'Madde tamamlandı.',
    );
    if (ok) {
      setChecklist((rows) =>
        (rows ?? []).map((row) =>
          row.itemId === item.itemId
            ? { ...row, done: !row.done, doneAt: new Date().toISOString() }
            : row,
        ),
      );
    }
  }

  async function startLabor() {
    const ok = await mutate(
      `/api/v1/work-orders/${workOrderId}/time-entries`,
      'POST',
      { type: 'LABOR', startedAt: new Date().toISOString() },
      'İş süresi başlatıldı.',
    );
    if (ok) router.refresh();
  }

  async function stopLabor(timeEntryId: string) {
    const ok = await mutate(
      `/api/v1/work-orders/${workOrderId}/time-entries/${timeEntryId}/stop`,
      'POST',
      { endedAt: new Date().toISOString() },
      'Süre kaydı durduruldu.',
    );
    if (ok) router.refresh();
  }

  async function captureSignature(event: React.FormEvent) {
    event.preventDefault();
    const cleanStrokes = strokes.filter((stroke) => stroke.length >= 2);
    const pointCount = cleanStrokes.reduce((total, stroke) => total + stroke.length, 0);
    if (signerName.trim().length < 2) {
      setError('İmzalayan adı en az 2 karakter olmalı');
      return;
    }
    if (pointCount < 4) {
      setError('İmza çok kısa — tuvale tekrar imzalayın');
      return;
    }
    const input: CaptureSignatureRequest = {
      role: signerRole,
      signerName: signerName.trim(),
      signedAt: new Date().toISOString(),
      strokes: cleanStrokes,
    };
    const ok = await mutate(
      `/api/v1/work-orders/${workOrderId}/signatures`,
      'POST',
      input,
      'İmza kaydedildi.',
    );
    if (ok) {
      setSignerName('');
      setStrokes([]);
      const response = await fetch(`${apiBaseUrl}/api/v1/work-orders/${workOrderId}/signatures`, {
        headers: { accept: 'application/json' },
        credentials: 'include',
        signal: AbortSignal.timeout(6000),
      }).catch(() => null);
      if (response && response.ok) {
        setSignatures(((await response.json()).data ?? []) as SignatureView[]);
      }
    }
  }

  if (terminal) return null;

  const openEntry = (timeEntries ?? []).find((entry) => entry.status === 'OPEN');
  const requiredRemaining = (checklist ?? []).filter((item) => item.required && !item.done);

  return (
    <Panel title="Saha yürütme" headingLevel={2}>
      {error ? (
        <Alert variant="danger" title="İşlem başarısız">
          {error}
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" title="Kaydedildi">
          {info}
        </Alert>
      ) : null}

      {/* Checklist */}
      <h3 className="tf-panel__title" style={{ fontSize: 15 }}>
        Checklist{' '}
        {requiredRemaining.length > 0
          ? `— ${requiredRemaining.length} zorunlu madde eksik (tamamlama kapısı)`
          : ''}
      </h3>
      {checklist === null ? (
        <p className="tf-panel__subtitle">Yükleniyor…</p>
      ) : checklist.length === 0 ? (
        <p className="tf-panel__subtitle">Checklist yok — ofis saha maddeleri ekleyebilir.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'grid', gap: 8 }}>
          {checklist.map((item) => (
            <li
              key={item.itemId}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                borderBottom: '1px solid var(--tf-border)',
                paddingBottom: 8,
              }}
            >
              <Button
                variant={item.done ? 'primary' : 'secondary'}
                size="sm"
                disabled={busy || !canExecute}
                onClick={() => void toggleChecklistItem(item)}
                aria-label={`${item.label}: ${item.done ? 'tamamlandı' : 'tamamlanmadı'}`}
              >
                {item.done ? '✓' : '○'}
              </Button>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 14 }}>{item.label}</span>
                {item.required ? (
                  <span className="tf-panel__subtitle" style={{ marginLeft: 6 }}>
                    (zorunlu)
                  </span>
                ) : null}
                {item.note ? (
                  <p className="tf-panel__subtitle" style={{ margin: '2px 0 0' }}>
                    {item.note}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Süre */}
      <h3 className="tf-panel__title" style={{ fontSize: 15 }}>
        Süre takibi
      </h3>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {openEntry ? (
          <>
            <StatusBadge tone="green">Açık: {TIME_ENTRY_TYPE_LABELS[openEntry.type]}</StatusBadge>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !canExecute}
              onClick={() => void stopLabor(openEntry.timeEntryId)}
            >
              Durdur
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" disabled={busy || !canExecute} onClick={startLabor}>
            İş süresi başlat
          </Button>
        )}
      </div>

      {/* İmza */}
      <h3 className="tf-panel__title" style={{ fontSize: 15 }}>
        İmza
      </h3>
      {(signatures ?? []).length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
          {(signatures ?? []).map((signature) => (
            <li
              key={signature.signatureId}
              style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}
            >
              <strong style={{ fontSize: 14 }}>{signature.signerName}</strong>
              <StatusBadge tone={signature.supersededById ? 'gray' : 'green'}>
                {SIGNATURE_ROLE_LABELS[signature.role]}
                {signature.supersededById ? ' · düzeltmeyle geçersiz' : ' · geçerli'}
              </StatusBadge>
              <span className="tf-panel__subtitle" style={{ marginLeft: 'auto' }}>
                {signature.capturedByName ?? '—'} · {signature.pointCount} nokta
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tf-panel__subtitle" style={{ marginTop: 0 }}>
          Kapatma için en az bir imza gerekli (kanıt kapısı).
        </p>
      )}
      {canCaptureSignature ? (
        <form
          onSubmit={captureSignature}
          style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}
        >
          <FormField label="İmza rolü">
            {(ids) => (
              <select
                {...ids}
                value={signerRole}
                onChange={(e) => setSignerRole(e.target.value as 'CUSTOMER' | 'TECHNICIAN')}
                style={{ width: '100%' }}
              >
                <option value="CUSTOMER">{SIGNATURE_ROLE_LABELS.CUSTOMER}</option>
                <option value="TECHNICIAN">{SIGNATURE_ROLE_LABELS.TECHNICIAN}</option>
              </select>
            )}
          </FormField>
          <FormField label="İmzalayan adı">
            {(ids) => (
              <input
                {...ids}
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                maxLength={120}
                style={{ width: '100%' }}
              />
            )}
          </FormField>
          <SignaturePad label="İmza tuvali" onStrokesChange={setStrokes} />
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              İmzayı kaydet
            </Button>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}
