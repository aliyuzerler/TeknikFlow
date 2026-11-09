'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AppShell, type NavSection } from '@teknikflow/ui-web';

/**
 * Faz 03 — AppShell'in istemci sınırı.
 *
 * app/layout.tsx sunucu bileşenidir (oturum üyelikten türetilir); AppShell
 * ise useState (mobil çekmece/arama) kullanır → bu ince sarmalayıcı client
 * tarafına taşır. Veri ve yetki kararı SUNUCUDA verilir; burada yalnız
 * sunum gerçekleştirilir.
 *
 * Faz 06 — aktif gezinme ögesi yol adından türetilir (önceden her zaman
 * "Genel Bakış" yanılmaktaydı; dispatch dahil her sayfa kendi vurgusunu
 * görür).
 */
const PATH_TO_NAV_ID: Readonly<Record<string, string>> = {
  '/app/overview': 'overview',
  '/app/requests': 'requests',
  '/app/work-orders': 'work-orders',
  '/app/dispatch': 'dispatch',
  '/app/customers': 'customers',
  '/app/assets': 'assets',
  '/app/users': 'users',
  '/app/branches': 'branches',
};

function activeNavId(pathname: string, fallback: string): string {
  for (const [prefix, navId] of Object.entries(PATH_TO_NAV_ID)) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return navId;
  }
  return fallback;
}

export function ShellFrame(props: {
  navSections: NavSection[];
  activeId: string;
  user: { name: string; role: string; initials: string };
  crumbs: Array<{ label: string }>;
  topbarActions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '/app/overview';
  return (
    <AppShell
      navSections={props.navSections}
      activeId={activeNavId(pathname, props.activeId)}
      user={props.user}
      crumbs={props.crumbs}
      topbarActions={props.topbarActions}
    >
      {props.children}
    </AppShell>
  );
}
