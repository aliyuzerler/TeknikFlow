'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, FormField } from '@teknikflow/ui-web';
import { WAREHOUSE_TYPE_LABELS, WAREHOUSE_TYPES } from '@teknikflow/contracts';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/** Faz 09 — yeni depo formu (stock:manage). VEHICLE türü sahipli ister. */
export function NewWarehouseForm() {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof WAREHOUSE_TYPES)[number]>('CENTRAL');
  const [assignedToId, setAssignedToId] = useState('');
  const [members, setMembers] = useState<Array<{ userId: string; displayName: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(`${apiBaseUrl}/api/v1/tenants/current/members`, {
        headers: { accept: 'application/json' },
        credentials: 'include',
        signal: AbortSignal.timeout(6000),
      }).catch(() => null);
      if (!response?.ok) return;
      const body = (await response.json()) as {
        data?: Array<{ userId: string; displayName: string }>;
      };
      if (!cancelled) setMembers(body.data ?? []);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (name.trim().length < 2) {
      setError('Depo adı en az 2 karakter olmalı');
      return;
    }
    if (type === 'VEHICLE' && !assignedToId) {
      setError('Araç deposu bir teknisyene bağlanmalı');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/inventory/warehouses`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          type,
          ...(type === 'VEHICLE' ? { assignedToId } : {}),
        }),
        signal: AbortSignal.timeout(6000),
      }).catch(() => null);

      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
      if (!response.ok) {
        if (body.code === 'WAREHOUSE_DUPLICATE') {
          setError('Bu depo adı kullanımda');
        } else {
          setError(body.message ?? 'Depo oluşturulamadı');
        }
        return;
      }
      setSuccess(`${name.trim()} eklendi`);
      setName('');
      setAssignedToId('');
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
        Yeni depo
      </h3>
      {error ? <Alert variant="danger" title={error} /> : null}
      {success ? <Alert variant="success" title={success} /> : null}

      <FormField label="Depo adı" required>
        {(ids) => (
          <input
            name="warehouse-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Merkez Depo / Teknisyen Aracı 34"
            {...ids}
          />
        )}
      </FormField>

      <FormField label="Tür">
        {(ids) => (
          <select
            {...ids}
            name="warehouse-type"
            value={type}
            onChange={(e) => setType(e.target.value as (typeof WAREHOUSE_TYPES)[number])}
          >
            {WAREHOUSE_TYPES.map((value) => (
              <option key={value} value={value}>
                {WAREHOUSE_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        )}
      </FormField>

      {type === 'VEHICLE' ? (
        <FormField label="Araç sahibi (teknisyen)" required>
          {(ids) => (
            <select
              {...ids}
              name="warehouse-owner"
              value={assignedToId}
              onChange={(e) => setAssignedToId(e.target.value)}
            >
              <option value="">Seçin…</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </select>
          )}
        </FormField>
      ) : null}

      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'Ekleniyor…' : 'Depo ekle'}
      </Button>
    </form>
  );
}
