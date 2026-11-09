'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, FormField, SideDrawer } from '@teknikflow/ui-web';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/**
 * Faz 04 — yeni müşteri çekmecesi (customers:manage).
 * Çift kayıt denetimi API'de (409 → hata mesajı gösterilir).
 */
export function NewCustomerButton({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [customerType, setCustomerType] = useState<'COMPANY' | 'INDIVIDUAL'>('COMPANY');
  const [taxId, setTaxId] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) return null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim().length < 2) {
      setError('Müşteri adı en az 2 karakter olmalı');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/customers`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          customerType,
          ...(taxId.trim() ? { taxId: taxId.trim() } : {}),
          ...(contactName.trim() && contactEmail.trim()
            ? { primaryContact: { name: contactName.trim(), email: contactEmail.trim() } }
            : {}),
        }),
        signal: AbortSignal.timeout(7000),
      }).catch(() => null);

      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        customerId?: string;
        message?: string;
        code?: string;
      };
      if (!response.ok) {
        if (body.code === 'CUSTOMER_DUPLICATE') setError('Bu adda müşteri zaten kayıtlı');
        else if (body.code === 'TAX_ID_DUPLICATE') setError('Bu vergi numarası kayıtlı');
        else setError(body.message ?? 'Müşteri oluşturulamadı');
        return;
      }
      setOpen(false);
      setName('');
      setTaxId('');
      setContactName('');
      setContactEmail('');
      if (body.customerId) {
        router.push(`/app/customers/${body.customerId}`);
      } else {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        ＋ Yeni Müşteri
      </Button>
      <SideDrawer open={open} onClose={() => setOpen(false)} title="Yeni Müşteri">
        <form onSubmit={handleSubmit} noValidate style={{ display: 'grid', gap: 14 }}>
          {error ? (
            <p role="alert" style={{ margin: 0, color: 'var(--tf-danger)', fontSize: 13 }}>
              {error}
            </p>
          ) : null}

          <FormField label="Müşteri adı" required>
            {(ids) => (
              <input name="name" value={name} onChange={(e) => setName(e.target.value)} {...ids} />
            )}
          </FormField>

          <FormField label="Tür">
            {(ids) => (
              <select
                name="customerType"
                value={customerType}
                onChange={(e) => setCustomerType(e.target.value as 'COMPANY' | 'INDIVIDUAL')}
                {...ids}
              >
                <option value="COMPANY">Firma</option>
                <option value="INDIVIDUAL">Bireysel</option>
              </select>
            )}
          </FormField>

          <FormField label="Vergi No (opsiyonel)" hint="10-11 rakam">
            {(ids) => (
              <input
                name="taxId"
                inputMode="numeric"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                {...ids}
              />
            )}
          </FormField>

          <FormField label="İlgili kişi (opsiyonel)">
            {(ids) => (
              <input
                name="contactName"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                {...ids}
              />
            )}
          </FormField>

          <FormField label="Kişi e-postası (opsiyonel)">
            {(ids) => (
              <input
                name="contactEmail"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                {...ids}
              />
            )}
          </FormField>

          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Müşteriyi oluştur'}
          </Button>
        </form>
      </SideDrawer>
    </>
  );
}
