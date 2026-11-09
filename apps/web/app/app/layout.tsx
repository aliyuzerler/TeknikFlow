import { redirect } from 'next/navigation';
import { getSession } from '@/src/lib/session';
import type { NavSection } from '@teknikflow/ui-web';
import { ShellFrame } from '@/src/components/shell-frame';
import { LogoutButton } from './logout-button';

/**
 * Faz 03 — korumalı uygulama yerleşimi.
 *
 * Kiracı/rol/izin bağlamı sunucuda oturumdan (üyelikten) türetilir;
 * oturumsuz → /login. Bu yerleşim altındaki her sayfa aynı kabuğu paylaşır.
 * Menü ögeleri yetki tabanlıdır: olmayan modül gizlenir (sunucu tarafı
 * denetim API'dedir — gizleme yalnız UX'tir, yetkilendirme DEĞİLDİR).
 */

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || !session.membership) {
    redirect('/login');
  }

  const { user, membership, permissions } = session;
  const canManageUsers = permissions.includes('users:manage');
  const canManageBranches = permissions.includes('branches:manage');

  const navSections: NavSection[] = [
    {
      label: 'Çalışma alanı',
      items: [
        { id: 'overview', label: 'Genel Bakış', icon: 'overview' as const, href: '/app/overview' },
      ],
    },
    ...(canManageUsers || canManageBranches
      ? [
          {
            label: 'Yönetim',
            items: [
              ...(canManageUsers
                ? [
                    {
                      id: 'users',
                      label: 'Kullanıcılar & Roller',
                      icon: 'users' as const,
                      href: '/app/users',
                    },
                  ]
                : []),
              ...(canManageBranches
                ? [
                    {
                      id: 'branches',
                      label: 'Şubeler',
                      icon: 'pin' as const,
                      href: '/app/branches',
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
  ];

  return (
    <ShellFrame
      navSections={navSections}
      activeId="overview"
      user={{
        name: user.displayName,
        role: membership.roleName,
        initials: initialsOf(user.displayName),
      }}
      crumbs={[{ label: membership.tenantName }, { label: 'Genel Bakış' }]}
      topbarActions={<LogoutButton />}
    >
      {children}
    </ShellFrame>
  );
}

function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toLocaleUpperCase('tr-TR') || 'TF';
}
