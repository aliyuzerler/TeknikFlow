'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, FormField } from '@teknikflow/ui-web';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/** Faz 03 — yeni şube formu (branches:manage sayfasında). */
export function NewBranchForm() {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (name.trim().length < 2) {
      setError('Şube adı en az 2 karakter olmalı');
      return;
    }
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code.trim())) {
      setError('Kod: yalnız büyük harf, rakam ve tire (ör. IST-MRKZ)');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/tenants/current/branches`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim().toUpperCase(),
          ...(address.trim() ? { address: address.trim() } : {}),
        }),
        signal: AbortSignal.timeout(6000),
      }).catch(() => null);

      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
      if (!response.ok) {
        if (body.code === 'PLAN_LIMIT_EXCEEDED') {
          setError(body.message ?? 'Plan limiti aşıldı — planınızı yükseltin');
        } else if (body.code === 'BRANCH_CODE_TAKEN') {
          setError('Bu şube kodu kullanımda');
        } else {
          setError(body.message ?? 'Şube oluşturulamadı');
        }
        return;
      }
      setSuccess(`${name.trim()} eklendi`);
      setName('');
      setCode('');
      setAddress('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      style={{ padding: '0 18px 14px', display: 'grid', gap: 12 }}
    >
      {error ? <Alert variant="danger" title={error} /> : null}
      {success ? <Alert variant="success" title={success} /> : null}

      <FormField label="Şube adı" required>
        {(ids) => (
          <input
            name="branch-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            {...ids}
          />
        )}
      </FormField>

      <FormField label="Kod" required hint="Yalnız büyük harf, rakam ve tire">
        {(ids) => (
          <input
            name="branch-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="IST-MRKZ"
            {...ids}
          />
        )}
      </FormField>

      <FormField label="Adres (opsiyonel)">
        {(ids) => (
          <input
            name="branch-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            {...ids}
          />
        )}
      </FormField>

      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'Ekleniyor…' : 'Şube ekle'}
      </Button>
    </form>
  );
}
