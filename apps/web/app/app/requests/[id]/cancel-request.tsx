'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, FormField, SideDrawer } from '@teknikflow/ui-web';
import { CANCELLATION_REASON_LABELS } from '@teknikflow/contracts';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/**
 * Faz 05 — talep iptali (neden kodu zorunlu). Yıkıcı eylem:
 * ConfirmDialog ile doğrulanır; vazgeç güvenli yoldur.
 */
export function CancelRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [open, setOpen] = useState(false);
  const [reasonCode, setReasonCode] =
    useState<keyof typeof CANCELLATION_REASON_LABELS>('CUSTOMER_REQUEST');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/service-requests/${requestId}/cancel`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ reasonCode, ...(note.trim() ? { note: note.trim() } : {}) }),
        signal: AbortSignal.timeout(7000),
      }).catch(() => null);
      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(payload.message ?? 'İptal başarısız');
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
        Talebi iptal et
      </Button>
      <SideDrawer open={open} onClose={() => setOpen(false)} title="Talebi iptal et">
        <p className="tf-panel__subtitle" style={{ marginTop: 0 }}>
          Bu eylem geri alınamaz — talep kapatılır ve iş emrine dönüşemez.
        </p>
        {error ? (
          <Alert variant="danger" title="İşlem başarısız">
            {error}
          </Alert>
        ) : null}
        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          onSubmit={handleConfirm}
        >
          <FormField label="İptal nedeni">
            {(ids) => (
              <select
                {...ids}
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value as typeof reasonCode)}
                style={{ width: '100%' }}
              >
                {(
                  Object.keys(CANCELLATION_REASON_LABELS) as Array<
                    keyof typeof CANCELLATION_REASON_LABELS
                  >
                ).map((key) => (
                  <option key={key} value={key}>
                    {CANCELLATION_REASON_LABELS[key]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label="Not" hint="Opsiyonel">
            {(ids) => (
              <textarea
                {...ids}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={500}
                style={{ width: '100%' }}
              />
            )}
          </FormField>
        </form>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Vazgeç
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={handleConfirm}>
            {busy ? 'İptal ediliyor…' : 'Talebi iptal et'}
          </Button>
        </div>
      </SideDrawer>
    </>
  );
}
