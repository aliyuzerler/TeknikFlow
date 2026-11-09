import { getSession, apiCookieHeader } from '@/src/lib/session';
import { getWebEnv } from '@/src/load-env';
import { fetchDispatchBoard } from '@teknikflow/api-client';
import { Alert, PageHeader } from '@teknikflow/ui-web/server';
import { DispatchBoard } from './dispatch-board';

export const metadata = { title: 'Dispatch Panosu — TeknikFlow' };

/**
 * Faz 06 — /app/dispatch: sevk panosu.
 *
 * Yetki: work_orders:view_all (planlamacı/yönetici görünümü). Teknisyen
 * (view_assigned) buraya giremez — kendi gününü iş emri listesinde görür;
 * sunucu tarafı denetim API'dedir, bu sayfa yalnız nazik bir uyarı verir.
 * İlk pano yükü sunucuda (hızlı ilk boyama); tarih gezintisi ve planlama
 * istemcide API'ye gider.
 */
export default async function DispatchPage() {
  const session = await getSession();
  if (!session?.membership) return null;

  const canView = session.permissions.includes('work_orders:view_all');
  if (!canView) {
    return (
      <Alert variant="warning" title="Bu bölüm için yetkiniz yok">
        Dispatch panosu planlamacı, yönetici ve servis yöneticisi rollerine açıktır.
      </Alert>
    );
  }

  const { apiBaseUrl } = getWebEnv();
  const cookieHeader = await apiCookieHeader();
  const result = await fetchDispatchBoard(
    { baseUrl: apiBaseUrl, cookieHeader, timeoutMs: 10_000 },
    {},
  );

  const canDispatch = session.permissions.includes('work_orders:dispatch');
  const canOverride = session.permissions.includes('work_orders:dispatch_override');

  return (
    <>
      <PageHeader
        eyebrow="Sevk ve Planlama"
        title="Dispatch Panosu"
        subtitle="Teknisyen kapasitesi, plan çakışmaları ve SLA uyarılarıyla günlük planlama."
      />
      {result.ok ? (
        <DispatchBoard
          initialBoard={result.data}
          canDispatch={canDispatch}
          canOverride={canOverride}
        />
      ) : (
        <Alert variant="danger" title="Pano yüklenemedi">
          {result.error.message} — bir süre sonra tekrar deneyin.
        </Alert>
      )}
    </>
  );
}
