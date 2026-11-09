'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, FormField, Panel } from '@teknikflow/ui-web';
import { PRIORITY_LABELS, type ServiceRequestView } from '@teknikflow/contracts';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/**
 * Faz 05 — triyaj paneli: öncelik/kategori/durum güncelleme
 * (service_requests:create). Öncelik değişimi SLA&apos;yı sunucuda yeniden
 * hesaplar.
 */
export function TriageForm({
  request,
  categories,
}: {
  request: ServiceRequestView;
  categories: Array<{ categoryId: string; name: string }>;
}) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [priority, setPriority] = useState(request.priority);
  const [categoryId, setCategoryId] = useState(request.categoryId ?? '');
  const [status, setStatus] = useState<'NEW' | 'IN_REVIEW'>(
    request.status === 'IN_REVIEW' ? 'IN_REVIEW' : 'NEW',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (priority !== request.priority) body.priority = priority;
      if ((request.categoryId ?? '') !== categoryId) body.categoryId = categoryId || null;
      if (status !== request.status) body.status = status;
      if (Object.keys(body).length === 0) {
        setError('Değişiklik yok');
        return;
      }
      const response = await fetch(`${apiBaseUrl}/api/v1/service-requests/${request.requestId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(7000),
      }).catch(() => null);
      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(payload.message ?? 'Talep güncellenemedi');
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Triyaj" headingLevel={2}>
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error ? (
          <Alert variant="danger" title="İşlem başarısız">
            {error}
          </Alert>
        ) : null}
        {saved ? (
          <Alert variant="success" title="Talep güncellendi">
            Değişiklikler kaydedildi.
          </Alert>
        ) : null}
        <FormField label="Öncelik" hint="SLA hedefi yeniden hesaplanır">
          {(ids) => (
            <select
              {...ids}
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
              style={{ width: '100%' }}
            >
              {(Object.keys(PRIORITY_LABELS) as Array<keyof typeof PRIORITY_LABELS>).map((key) => (
                <option key={key} value={key}>
                  {PRIORITY_LABELS[key]}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="Kategori">
          {(ids) => (
            <select
              {...ids}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">Kategorisiz</option>
              {categories.map((category) => (
                <option key={category.categoryId} value={category.categoryId}>
                  {category.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="Durum">
          {(ids) => (
            <select
              {...ids}
              value={status}
              onChange={(e) => setStatus(e.target.value as 'NEW' | 'IN_REVIEW')}
              style={{ width: '100%' }}
            >
              <option value="NEW">Yeni</option>
              <option value="IN_REVIEW">İncelemede</option>
            </select>
          )}
        </FormField>
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            Triyajı kaydet
          </Button>
        </div>
      </form>
    </Panel>
  );
}
