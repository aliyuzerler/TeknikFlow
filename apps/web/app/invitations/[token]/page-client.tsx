'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthForm } from '@/src/components/auth-form';
import { getClientApiBaseUrl } from '@/src/lib/client-env';

/**
 * Faz 03 — davet kabulü (client).
 * Mevcut kullanıcı (çerezle oturumlu ve e-postası eşleşen) parolasız kabul
 * eder; yeni kullanıcı parola seçer. Eşleşmeyen oturum → 403 mesajı gösterilir.
 */
export function InviteAccept({
  token,
  tenantName,
  invitedEmail,
  roleName,
}: {
  token: string;
  tenantName: string;
  invitedEmail: string;
  roleName: string;
}) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const [accepted, setAccepted] = useState(false);
  const [mismatch, setMismatch] = useState(false);

  if (mismatch) {
    return (
      <AuthForm
        mode="invite"
        title="Davet bu hesapla kabul edilemez"
        subtitle={`${tenantName} daveti ${invitedEmail} adresine ait. Lütfen o hesapla giriş yapın.`}
        submitLabel="Giriş sayfasına git"
        onSubmit={async () => {
          router.push(`/login?workspace=${encodeURIComponent(tenantName)}`);
          return { ok: true };
        }}
      />
    );
  }

  if (accepted) {
    return (
      <AuthForm
        mode="invite"
        title="Davet kabul edildi 🎉"
        subtitle={`${tenantName} ekibine ${roleName} olarak katıldınız.`}
        submitLabel="Genel bakışa git"
        onSubmit={async () => {
          router.push('/app/overview');
          router.refresh();
          return { ok: true };
        }}
      />
    );
  }

  return (
    <AuthForm
      mode="invite"
      title={`${tenantName} daveti`}
      subtitle={`${invitedEmail} için ${roleName} rolüyle davet edildiniz. Hesabınızı kurun.`}
      submitLabel="Daveti kabul et"
      fixedEmail={invitedEmail}
      onSubmit={async (values) => {
        const response = await fetch(
          `${apiBaseUrl}/api/v1/invitations/${encodeURIComponent(token)}/accept`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ password: values.password, client: 'web' }),
            credentials: 'include', // oturum çerezleri API kökeninden yazılır
            signal: AbortSignal.timeout(8000),
          },
        ).catch(() => null);

        if (!response) {
          return { ok: false, error: 'Ağa ulaşılamadı — tekrar deneyin' };
        }
        if (response.status === 403) {
          setMismatch(true);
          return { ok: true };
        }
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { message?: string };
          return { ok: false, error: body.message ?? 'Davet kabul edilemedi' };
        }
        setAccepted(true);
        return { ok: true };
      }}
    />
  );
}
