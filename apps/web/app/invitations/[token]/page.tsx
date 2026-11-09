import { notFound } from 'next/navigation';
import { getWebEnv } from '@/src/load-env';
import { apiCookieHeader } from '@/src/lib/session';
import { InviteAccept } from './page-client';

export const metadata = { title: 'Davet — TeknikFlow' };

/**
 * Faz 03 — /invitations/[token]: davet önizleme + kabul.
 * Token URL'de opak; önizleme API'den (bilinmeyen → 404 → notFound).
 */
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { apiBaseUrl } = getWebEnv();
  const cookieHeader = await apiCookieHeader();

  const response = await fetch(`${apiBaseUrl}/api/v1/invitations/${encodeURIComponent(token)}`, {
    headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);

  if (!response || !response.ok) {
    notFound();
  }
  const preview = (await response.json()) as {
    tenantName: string;
    invitedEmail: string;
    roleName: string;
    expiresAt: string;
  };

  return (
    <main className="auth-scene">
      <InviteAccept
        token={token}
        tenantName={preview.tenantName}
        invitedEmail={preview.invitedEmail}
        roleName={preview.roleName}
      />
    </main>
  );
}
