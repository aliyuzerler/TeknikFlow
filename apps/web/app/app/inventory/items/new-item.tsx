'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, FormField } from '@teknikflow/ui-web';
import { STOCK_TRACKING_MODE_LABELS, STOCK_TRACKING_MODES } from '@teknikflow/contracts';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/** Faz 09 — yeni stok kalemi formu (stock:manage). */
export function NewItemForm() {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('ad');
  const [trackingMode, setTrackingMode] = useState<(typeof STOCK_TRACKING_MODES)[number]>('NONE');
  const [reorderPoint, setReorderPoint] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (sku.trim().length < 2) {
      setError('SKU en az 2 karakter olmalı');
      return;
    }
    if (name.trim().length < 2) {
      setError('Kalem adı en az 2 karakter olmalı');
      return;
    }
    if (unit.trim().length < 1) {
      setError('Birim zorunludur');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/inventory/items`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          sku: sku.trim(),
          name: name.trim(),
          unit: unit.trim(),
          trackingMode,
          reorderPoint: Number(reorderPoint.replace(',', '.')) || 0,
        }),
        signal: AbortSignal.timeout(6000),
      }).catch(() => null);

      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
      if (!response.ok) {
        if (body.code === 'ITEM_DUPLICATE') {
          setError('Bu SKU kullanımda');
        } else {
          setError(body.message ?? 'Stok kalemi oluşturulamadı');
        }
        return;
      }
      setSuccess(`${sku.trim()} kataloğa eklendi`);
      setSku('');
      setName('');
      setReorderPoint('0');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      style={{ padding: '0 18px 14px', display: 'grid', gap: 12, maxWidth: 520 }}
    >
      <h3 className="tf-panel__title" style={{ fontSize: 15, marginTop: 8 }}>
        Yeni stok kalemi
      </h3>
      {error ? <Alert variant="danger" title={error} /> : null}
      {success ? <Alert variant="success" title={success} /> : null}

      <FormField label="SKU" required>
        {(ids) => <input name="sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="FLT-04-25" {...ids} />}
      </FormField>

      <FormField label="Kalem adı" required>
        {(ids) => <input name="name" value={name} onChange={(e) => setName(e.target.value)} {...ids} />}
      </FormField>

      <FormField label="Birim" required hint="ad, kutu, lt, m…">
        {(ids) => <input name="unit" value={unit} onChange={(e) => setUnit(e.target.value)} {...ids} />}
      </FormField>

      <FormField label="İzleme modu" hint="Parti/seri kalemlerde hareket lot bağlanır">
        {(ids) => (
          <select
            {...ids}
            name="trackingMode"
            value={trackingMode}
            onChange={(e) => setTrackingMode(e.target.value as (typeof STOCK_TRACKING_MODES)[number])}
          >
            {STOCK_TRACKING_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {STOCK_TRACKING_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        )}
      </FormField>

      <FormField label="Yeniden sipariş eşiği">
        {(ids) => (
          <input
            {...ids}
            name="reorderPoint"
            inputMode="decimal"
            value={reorderPoint}
            onChange={(e) => setReorderPoint(e.target.value)}
          />
        )}
      </FormField>

      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'Ekleniyor…' : 'Kalem ekle'}
      </Button>
    </form>
  );
}
