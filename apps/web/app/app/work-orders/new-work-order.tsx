'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, FormField, SideDrawer } from '@teknikflow/ui-web';
import { PRIORITY_LABELS, WORK_ORDER_TYPE_LABELS } from '@teknikflow/contracts';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/**
 * Faz 05 — doğrudan yeni iş emri (work_orders:create).
 * Talep akışı dışından hızlı giriş; numara sunucuda atomik üretilir.
 */
export function NewWorkOrderButton({
  customers,
  branches,
}: {
  customers: Array<{ customerId: string; name: string }>;
  branches: Array<{ branchId: string; name: string }>;
}) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState(customers[0]?.customerId ?? '');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<
    'CORRECTIVE' | 'PREVENTIVE' | 'INSTALLATION' | 'INSPECTION' | 'OTHER'
  >('CORRECTIVE');
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('MEDIUM');
  const [branchId, setBranchId] = useState('');
  const [scheduledStart, setScheduledStart] = useState('');
  const [scheduledEnd, setScheduledEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (subject.trim().length < 4) {
      setError('Konu en az 4 karakter olmalı');
      return;
    }
    if (scheduledStart && scheduledEnd && new Date(scheduledEnd) <= new Date(scheduledStart)) {
      setError('Bitiş zamanı başlangıçtan sonra olmalı');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/work-orders`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          customerId,
          subject: subject.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          type,
          priority,
          ...(branchId ? { branchId } : {}),
          ...(scheduledStart ? { scheduledStart: new Date(scheduledStart).toISOString() } : {}),
          ...(scheduledEnd ? { scheduledEnd: new Date(scheduledEnd).toISOString() } : {}),
        }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        workOrderId?: string;
        message?: string;
      };
      if (!response.ok) {
        setError(body.message ?? 'İş emri oluşturulamadı');
        return;
      }
      setOpen(false);
      setSubject('');
      setDescription('');
      if (body.workOrderId) router.push(`/app/work-orders/${body.workOrderId}`);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        ＋ Yeni İş Emri
      </Button>
      <SideDrawer open={open} onClose={() => setOpen(false)} title="Yeni İş Emri">
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error ? (
            <Alert variant="danger" title="İşlem başarısız">
              {error}
            </Alert>
          ) : null}
          <FormField label="Müşteri">
            {(ids) => (
              <select
                {...ids}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
                style={{ width: '100%' }}
              >
                {customers.length === 0 ? <option value="">Müşteri yok</option> : null}
                {customers.map((customer) => (
                  <option key={customer.customerId} value={customer.customerId}>
                    {customer.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
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
          <FormField label="Açıklama" hint="Opsiyonel">
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
          <FormField label="Şube" hint="Opsiyonel">
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
          <FormField label="Planlanan başlangıç" hint="Opsiyonel">
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
            <Button type="submit" variant="primary" disabled={busy || !customerId}>
              İş emrini oluştur
            </Button>
          </div>
        </form>
      </SideDrawer>
    </>
  );
}
