'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, FormField, Panel } from '@teknikflow/ui-web';
import {
  PRIORITY_LABELS,
  WORK_ORDER_TYPE_LABELS,
  type ServiceRequestView,
} from '@teknikflow/contracts';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/**
 * Faz 05 — talebi iş emrine dönüştürme paneli (work_orders:create).
 * Schedule girilirse iş emri PLANLANMIŞ olarak üretilir; aksi halde TASLAK.
 * Dönüşüm başarılıysa yeni iş emri detayına yönlendirilir.
 */
export function ConvertForm({
  request,
  branches,
}: {
  request: ServiceRequestView;
  branches: Array<{ branchId: string; name: string }>;
}) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [type, setType] = useState<
    'CORRECTIVE' | 'PREVENTIVE' | 'INSTALLATION' | 'INSPECTION' | 'OTHER'
  >('CORRECTIVE');
  const [branchId, setBranchId] = useState('');
  const [scheduledStart, setScheduledStart] = useState('');
  const [scheduledEnd, setScheduledEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConvert(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (scheduledStart && scheduledEnd && new Date(scheduledEnd) <= new Date(scheduledStart)) {
      setError('Bitiş zamanı başlangıçtan sonra olmalı');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/v1/service-requests/${request.requestId}/convert`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(csrf ? { 'x-csrf-token': csrf } : {}),
          },
          credentials: 'include',
          body: JSON.stringify({
            type,
            ...(branchId ? { branchId } : {}),
            ...(scheduledStart ? { scheduledStart: new Date(scheduledStart).toISOString() } : {}),
            ...(scheduledEnd ? { scheduledEnd: new Date(scheduledEnd).toISOString() } : {}),
          }),
          signal: AbortSignal.timeout(8000),
        },
      ).catch(() => null);
      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        workOrder?: { workOrderId: string };
        message?: string;
        code?: string;
      };
      if (!response.ok) {
        setError(payload.message ?? 'Dönüşüm başarısız');
        return;
      }
      if (payload.workOrder?.workOrderId) {
        router.push(`/app/work-orders/${payload.workOrder.workOrderId}`);
      } else {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="İş emrine dönüştür" headingLevel={2}>
      <form onSubmit={handleConvert} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error ? (
          <Alert variant="danger" title="İşlem başarısız">
            {error}
          </Alert>
        ) : null}
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
        <FormField label="Şube" hint="Opsiyonel — atama kapsamını daraltır">
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
        <FormField label="Planlanan başlangıç" hint="Opsiyonel — girilirse iş emri planlanır">
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
        <p className="tf-panel__subtitle">
          Öncelik talepten devralınır: {PRIORITY_LABELS[request.priority]}
        </p>
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            İş emri oluştur
          </Button>
        </div>
      </form>
    </Panel>
  );
}
