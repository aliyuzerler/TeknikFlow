'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, FormField, SideDrawer } from '@teknikflow/ui-web';
import { PRIORITY_LABELS, REQUEST_SOURCE_LABELS } from '@teknikflow/contracts';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/**
 * Faz 05 — yeni servis talebi çekmecesi (service_requests:create).
 * Doğrulama API'de (Zod → 400 alan hataları çekmecede gösterilir).
 */
interface CustomerOption {
  customerId: string;
  name: string;
}

export function NewRequestButton({ customers }: { customers: CustomerOption[] }) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState(customers[0]?.customerId ?? '');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('MEDIUM');
  const [source, setSource] = useState<'PORTAL' | 'OFFICE' | 'EMAIL' | 'API'>('OFFICE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (subject.trim().length < 4) {
      setError('Konu en az 4 karakter olmalı');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/service-requests`, {
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
          priority,
          source,
        }),
        signal: AbortSignal.timeout(7000),
      }).catch(() => null);

      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        requestId?: string;
        message?: string;
        code?: string;
      };
      if (!response.ok) {
        setError(body.message ?? 'Talep oluşturulamadı');
        return;
      }
      setOpen(false);
      setSubject('');
      setDescription('');
      router.refresh();
      if (body.requestId) router.push(`/app/requests/${body.requestId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        ＋ Yeni Talep
      </Button>
      <SideDrawer open={open} onClose={() => setOpen(false)} title="Yeni Servis Talebi">
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
                rows={4}
                maxLength={5000}
                style={{ width: '100%' }}
              />
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
          <FormField label="Kaynak">
            {(ids) => (
              <select
                {...ids}
                value={source}
                onChange={(e) => setSource(e.target.value as typeof source)}
                style={{ width: '100%' }}
              >
                {(
                  Object.keys(REQUEST_SOURCE_LABELS) as Array<keyof typeof REQUEST_SOURCE_LABELS>
                ).map((key) => (
                  <option key={key} value={key}>
                    {REQUEST_SOURCE_LABELS[key]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !customerId}>
              Talebi oluştur
            </Button>
          </div>
        </form>
      </SideDrawer>
    </>
  );
}
