'use client';

import { useState } from 'react';
import { Alert, Button, FormField } from '@teknikflow/ui-web';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/**
 * Faz 03 — davet formu (users:manage sahibi sayfasında).
 * Davet token'ı yanıtta BİR kez döner → bağlantı kopyalanıp paylaşılır
 * (e-posta gönderimi Faz 12'de).
 */
const ROLE_OPTIONS = [
  { value: 'dispatcher', label: 'Planlamacı' },
  { value: 'service-manager', label: 'Servis Yöneticisi' },
  { value: 'technician', label: 'Teknisyen' },
  { value: 'warehouse', label: 'Depo Görevlisi' },
  { value: 'finance', label: 'Finans' },
];

export function InviteForm() {
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState('technician');
  const [busy, setBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setInviteLink(null);

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError('Geçerli bir e-posta girin');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/tenants/current/invitations`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim().toLowerCase(), roleKey }),
        signal: AbortSignal.timeout(6000),
      }).catch(() => null);

      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        inviteToken?: string;
        message?: string;
        code?: string;
      };
      if (!response.ok) {
        if (response.status === 403 && body.code === 'PLAN_LIMIT_EXCEEDED') {
          setError(body.message ?? 'Plan limiti aşıldı');
        } else if (response.status === 409) {
          setError(body.message ?? 'Bu e-posta için açık davet var');
        } else {
          setError(body.message ?? 'Davet oluşturulamadı');
        }
        return;
      }
      if (body.inviteToken) {
        setInviteLink(`${window.location.origin}/invitations/${body.inviteToken}`);
        setEmail('');
      }
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
      {inviteLink ? (
        <Alert variant="success" title="Davet oluşturuldu" passive={false}>
          <p style={{ margin: '0 0 8px' }}>
            Bağlantıyı davet edilen kişiyle paylaşın (tek kullanımlık):
          </p>
          <code
            style={{
              display: 'block',
              padding: '8px 10px',
              background: 'var(--tf-bg-subtle)',
              borderRadius: 'var(--tf-radius-sm)',
              fontSize: 12,
              wordBreak: 'break-all',
            }}
          >
            {inviteLink}
          </code>
        </Alert>
      ) : null}

      <FormField label="E-posta" required>
        {(ids) => (
          <input
            name="invite-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            {...ids}
          />
        )}
      </FormField>

      <FormField label="Rol">
        {(ids) => (
          <select
            name="invite-role"
            value={roleKey}
            onChange={(e) => setRoleKey(e.target.value)}
            {...ids}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </FormField>

      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'Gönderiliyor…' : 'Davet oluştur'}
      </Button>
    </form>
  );
}
