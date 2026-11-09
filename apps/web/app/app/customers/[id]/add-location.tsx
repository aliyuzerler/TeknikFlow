'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, FormField, SideDrawer } from '@teknikflow/ui-web';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/** Faz 04 — müşteriye servis lokasyonu ekleme çekmecesi (customers:manage). */
export function AddLocationButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (address.trim().length < 4) {
      setError('Adres en az 4 karakter olmalı');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/customers/${customerId}/locations`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          ...(name.trim() ? { name: name.trim() } : {}),
          address: address.trim(),
          ...(city.trim() ? { city: city.trim() } : {}),
        }),
        signal: AbortSignal.timeout(7000),
      }).catch(() => null);
      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(body.message ?? 'Lokasyon eklenemedi');
        return;
      }
      setOpen(false);
      setName('');
      setAddress('');
      setCity('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        ＋ Lokasyon
      </Button>
      <SideDrawer open={open} onClose={() => setOpen(false)} title="Yeni Servis Lokasyonu">
        <form onSubmit={handleSubmit} noValidate style={{ display: 'grid', gap: 14 }}>
          {error ? (
            <p role="alert" style={{ margin: 0, color: 'var(--tf-danger)', fontSize: 13 }}>
              {error}
            </p>
          ) : null}
          <FormField label="Lokasyon adı (opsiyonel)">
            {(ids) => (
              <input name="name" value={name} onChange={(e) => setName(e.target.value)} {...ids} />
            )}
          </FormField>
          <FormField label="Adres" required>
            {(ids) => (
              <input
                name="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                {...ids}
              />
            )}
          </FormField>
          <FormField label="Şehir (opsiyonel)">
            {(ids) => (
              <input name="city" value={city} onChange={(e) => setCity(e.target.value)} {...ids} />
            )}
          </FormField>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Ekleniyor…' : 'Lokasyonu ekle'}
          </Button>
        </form>
      </SideDrawer>
    </>
  );
}
