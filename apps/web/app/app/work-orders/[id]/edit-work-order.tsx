'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, FormField, SideDrawer } from '@teknikflow/ui-web';
import {
  PRIORITY_LABELS,
  WORK_ORDER_TYPE_LABELS,
  type WorkOrderDetailResponse,
} from '@teknikflow/contracts';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/**
 * Faz 05 — iş emri düzenleme çekmecesi (create|dispatch yetkisi).
 * İyimser eşzamanlılık: expectedVersion gönderilir; 409 → yenileme.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function EditWorkOrderButton({
  workOrder,
  branches,
}: {
  workOrder: WorkOrderDetailResponse;
  branches: Array<{ branchId: string; name: string }>;
}) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(workOrder.subject);
  const [description, setDescription] = useState(workOrder.description ?? '');
  const [type, setType] = useState(workOrder.type);
  const [priority, setPriority] = useState(workOrder.priority);
  const [branchId, setBranchId] = useState(workOrder.branchId ?? '');
  const [scheduledStart, setScheduledStart] = useState(toLocalInput(workOrder.scheduledStart));
  const [scheduledEnd, setScheduledEnd] = useState(toLocalInput(workOrder.scheduledEnd));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (scheduledStart && scheduledEnd && new Date(scheduledEnd) <= new Date(scheduledStart)) {
      setError('Bitiş zamanı başlangıçtan sonra olmalı');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/work-orders/${workOrder.workOrderId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          subject: subject.trim(),
          ...(description.trim() ? { description: description.trim() } : { description: null }),
          type,
          priority,
          branchId: branchId || null,
          scheduledStart: scheduledStart ? new Date(scheduledStart).toISOString() : null,
          scheduledEnd: scheduledEnd ? new Date(scheduledEnd).toISOString() : null,
          expectedVersion: workOrder.version,
        }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
      };
      if (!response.ok) {
        if (payload.code === 'VERSION_CONFLICT') {
          setError('İş emri başka biri tarafından güncellendi — sayfa yenileniyor.');
          setTimeout(() => router.refresh(), 900);
        } else if (payload.code === 'WORK_ORDER_IMMUTABLE') {
          setError('Kapatılmış/iptal edilmiş iş emri düzenlenemez.');
        } else {
          setError(payload.message ?? 'Güncelleme başarısız');
        }
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Düzenle
      </Button>
      <SideDrawer open={open} onClose={() => setOpen(false)} title="İş emrini düzenle">
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error ? (
            <Alert variant="danger" title="İşlem başarısız">
              {error}
            </Alert>
          ) : null}
          <FormField label="Konu">
            {(ids) => (
              <input
                {...ids}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                required
                style={{ width: '100%' }}
              />
            )}
          </FormField>
          <FormField label="Açıklama">
            {(ids) => (
              <textarea
                {...ids}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={5000}
                style={{ width: '100%' }}
              />
            )}
          </FormField>
          <FormField label="İş türü">
            {(ids) => (
              <select
                {...ids}
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                style={{ width: '100%' }}
              >
                {(
                  Object.keys(WORK_ORDER_TYPE_LABELS) as Array<keyof typeof WORK_ORDER_TYPE_LABELS>
                ).map((key) => (
                  <option key={key} value={key}>
                    {WORK_ORDER_TYPE_LABELS[key]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label="Öncelik">
            {(ids) => (
              <select
                {...ids}
                value={priority}
                onChange={(e) => setPriority(e.target.value as typeof priority)}
                style={{ width: '100%' }}
              >
                {(Object.keys(PRIORITY_LABELS) as Array<keyof typeof PRIORITY_LABELS>).map(
                  (key) => (
                    <option key={key} value={key}>
                      {PRIORITY_LABELS[key]}
                    </option>
                  ),
                )}
              </select>
            )}
          </FormField>
          <FormField label="Şube">
            {(ids) => (
              <select
                {...ids}
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">Şube yok</option>
                {branches.map((branch) => (
                  <option key={branch.branchId} value={branch.branchId}>
                    {branch.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label="Planlanan başlangıç">
            {(ids) => (
              <input
                {...ids}
                type="datetime-local"
                value={scheduledStart}
                onChange={(e) => setScheduledStart(e.target.value)}
                style={{ width: '100%' }}
              />
            )}
          </FormField>
          <FormField label="Planlanan bitiş">
            {(ids) => (
              <input
                {...ids}
                type="datetime-local"
                value={scheduledEnd}
                onChange={(e) => setScheduledEnd(e.target.value)}
                style={{ width: '100%' }}
              />
            )}
          </FormField>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              Değişiklikleri kaydet
            </Button>
          </div>
        </form>
      </SideDrawer>
    </>
  );
}
