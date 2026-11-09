'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, FormField, SideDrawer } from '@teknikflow/ui-web';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/** Faz 04 — müşteriye kişi ekleme çekmecesi (customers:manage). */
export function AddContactButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim().length < 2) {
      setError('Ad en az 2 karakter olmalı');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Geçerli bir e-posta girin');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/customers/${customerId}/contacts`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        }),
        signal: AbortSignal.timeout(7000),
      }).catch(() => null);
      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
      if (!response.ok) {
        setError(
          body.code === 'CONTACT_DUPLICATE'
            ? 'Bu e-posta zaten kayıtlı'
            : (body.message ?? 'Kişi eklenemedi'),
        );
        return;
      }
      setOpen(false);
      setName('');
      setEmail('');
      setPhone('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        ＋ Kişi
      </Button>
      <SideDrawer open={open} onClose={() => setOpen(false)} title="Yeni Kişi">
        <form onSubmit={handleSubmit} noValidate style={{ display: 'grid', gap: 14 }}>
          {error ? (
            <p role="alert" style={{ margin: 0, color: 'var(--tf-danger)', fontSize: 13 }}>
              {error}
            </p>
          ) : null}
          <FormField label="Ad" required>
            {(ids) => (
              <input name="name" value={name} onChange={(e) => setName(e.target.value)} {...ids} />
            )}
          </FormField>
          <FormField label="E-posta" required>
            {(ids) => (
              <input
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                {...ids}
              />
            )}
          </FormField>
          <FormField label="Telefon (opsiyonel)">
            {(ids) => (
              <input
                name="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                {...ids}
              />
            )}
          </FormField>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Ekleniyor…' : 'Kişiyi ekle'}
          </Button>
        </form>
      </SideDrawer>
    </>
  );
}
