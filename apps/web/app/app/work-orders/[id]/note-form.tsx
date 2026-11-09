'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, FormField } from '@teknikflow/ui-web';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/**
 * Faz 05 — iş emri notu ekleme (INTERNAL | CUSTOMER görünürlük).
 * Notlar append-only; silme yok (denetlenebilirlik).
 */
export function NoteForm({ workOrderId }: { workOrderId: string }) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'INTERNAL' | 'CUSTOMER'>('INTERNAL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (body.trim().length === 0) {
      setError('Not boş olamaz');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/work-orders/${workOrderId}/notes`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ body: body.trim(), visibility }),
        signal: AbortSignal.timeout(7000),
      }).catch(() => null);
      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(payload.message ?? 'Not eklenemedi');
        return;
      }
      setBody('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error ? (
        <Alert variant="danger" title="İşlem başarısız">
          {error}
        </Alert>
      ) : null}
      <FormField label="Not">
        {(ids) => (
          <textarea
            {...ids}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={2000}
            style={{ width: '100%' }}
            placeholder="Gözlem, parça bilgisi, müşteri notu…"
          />
        )}
      </FormField>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="note-visibility" style={{ fontSize: 14, color: 'var(--tf-muted)' }}>
          Görünürlük
        </label>
        <select
          id="note-visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as 'INTERNAL' | 'CUSTOMER')}
          aria-label="Not görünürlüğü"
          style={{
            height: 36,
            padding: '0 10px',
            border: '1px solid var(--tf-border)',
            borderRadius: 'var(--tf-radius-sm)',
          }}
        >
          <option value="INTERNAL">Dahili</option>
          <option value="CUSTOMER">Müşteri görünür</option>
        </select>
        <Button type="submit" variant="primary" disabled={busy}>
          Not ekle
        </Button>
      </div>
    </form>
  );
}
