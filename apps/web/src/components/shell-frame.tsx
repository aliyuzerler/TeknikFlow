'use client';

import type { ReactNode } from 'react';
import { AppShell, type NavSection } from '@teknikflow/ui-web';

/**
 * Faz 03 — AppShell'in istemci sınırı.
 *
 * app/layout.tsx sunucu bileşenidir (oturum üyelikten türetilir); AppShell
 * ise useState (mobil çekmece/arama) kullanır → bu ince sarmalayıcı client
 * tarafına taşır. Veri ve yetki kararı SUNUCUDA verilir; burada yalnız
 * sunum gerçekleştirilir.
 */
export function ShellFrame(props: {
  navSections: NavSection[];
  activeId: string;
  user: { name: string; role: string; initials: string };
  crumbs: Array<{ label: string }>;
  topbarActions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AppShell
      navSections={props.navSections}
      activeId={props.activeId}
      user={props.user}
      crumbs={props.crumbs}
      topbarActions={props.topbarActions}
    >
      {props.children}
    </AppShell>
  );
}
