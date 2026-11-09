'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@teknikflow/ui-web';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/**
 * Faz 03 — üst çubuk çıkış düğmesi.
 * CSRF başlığı çerezden okunur (çift-gönderim), API oturumu iptal eder ve
 * çerezleri temizler; istemci /login'e döner.
 */
export function LogoutButton() {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      await fetch(`${apiBaseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        body: '{}',
        credentials: 'include',
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <Button size="sm" variant="secondary" onClick={handleLogout} disabled={busy}>
      {busy ? 'Çıkılıyor…' : 'Çıkış'}
    </Button>
  );
}
