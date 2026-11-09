import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons.js';
import { LogoMark } from '../brand/logo.js';
import { Avatar } from './feedback.js';
import { Breadcrumbs, type BreadcrumbItem } from './page.js';
import { SearchInput } from './input.js';
import { SideDrawer } from './side-drawer.js';

export interface NavItem {
  id: string;
  label: string;
  icon?: IconName;
  /** Gelecek fazlarda açılacak bölüm — erişilebilir "henüz yok" düğmesi. */
  href?: string;
  count?: number;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export interface ShellUser {
  name: string;
  role: string;
  initials: string;
}

export interface AppShellProps {
  navSections: NavSection[];
  activeId?: string;
  /** Gelecek-faz öğesine tıklanınca (href yoksa) çağrılır. */
  onNavigate?: (item: NavItem) => void;
  user: ShellUser;
  crumbs?: BreadcrumbItem[];
  searchPlaceholder?: string;
  onSearch?: (value: string) => void;
  /** Üst çubuğun sağında ek eylemler (bildirim, avatar...). */
  topbarActions?: ReactNode;
  children: ReactNode;
}

/**
 * Duyarlı uygulama kabuğu (design/preview.html birebir yeniden üretimi):
 * 248px ink-navy kenar çubuğu + 64px üst çubuk + içerik.
 * ≤720px'de kenar çubuğu gizlenir, hamburger menü ARIA çekmecesine dönüşür.
 * Atlama bağlantısı ("İçeriğe geç") her sayfada birinci klavye durağıdır.
 */
export function AppShell({
  navSections,
  activeId,
  onNavigate,
  user,
  crumbs = [],
  searchPlaceholder = 'İş emri, müşteri veya ekipman ara',
  onSearch,
  topbarActions,
  children,
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [search, setSearch] = useState('');

  const nav = (
    <SidebarNav
      navSections={navSections}
      activeId={activeId}
      onNavigate={(item) => {
        setMobileNavOpen(false);
        onNavigate?.(item);
      }}
    />
  );

  return (
    <div className="tf-root tf-shell">
      <a className="tf-skip-link" href="#tf-main">
        İçeriğe geç
      </a>

      <aside className="tf-sidebar" aria-label="Çalışma alanı kenar menüsü">
        <a className="tf-sidebar__brand" href="/app/overview" aria-label="TeknikFlow ana sayfa">
          <LogoMark size={34} />
          <span className="tf-sidebar__brand-text">
            <strong>TeknikFlow</strong>
            <small>SAHA SERVİS YÖNETİMİ</small>
          </span>
        </a>
        {nav}
        <SidebarUser user={user} />
      </aside>

      <div className="tf-shell__main">
        <header className="tf-topbar">
          <div className="tf-topbar__left">
            <button
              type="button"
              className="tf-menubtn"
              aria-expanded={mobileNavOpen}
              aria-controls="tf-mobile-nav"
              aria-label={mobileNavOpen ? 'Menüyü kapat' : 'Menüyü aç'}
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              <Icon name="menu" size={20} />
            </button>
            {crumbs.length > 0 ? <Breadcrumbs items={crumbs} /> : null}
          </div>
          <div className="tf-topbar__right">
            {onSearch ? (
              <SearchInput
                className="tf-topbar__search"
                aria-label="Global arama"
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  onSearch(value);
                }}
                placeholder={searchPlaceholder}
              />
            ) : (
              <span className="tf-topbar__search tf-input tf-input--disabled" aria-hidden="true">
                <Icon
                  name="search"
                  size={16}
                  style={{ color: 'var(--tf-placeholder)', flexShrink: 0 }}
                />
                <span className="tf-input__control" style={{ color: 'var(--tf-placeholder)' }}>
                  {searchPlaceholder}
                </span>
              </span>
            )}
            {topbarActions ?? (
              <button type="button" className="tf-topbar__iconbtn" aria-label="Bildirimler">
                <Icon name="bell" size={17} />
              </button>
            )}
            <Avatar initials={user.initials} />
          </div>
        </header>

        <main className="tf-shell__content" id="tf-main" tabIndex={-1}>
          {children}
        </main>
      </div>

      <SideDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        title="Menü"
        side="left"
      >
        <div style={{ margin: '-16px -16px 0' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '14px 16px 18px',
            }}
          >
            <LogoMark size={30} />
            <span className="tf-sidebar__brand-text">
              <strong style={{ color: 'var(--tf-text)' }}>TeknikFlow</strong>
              <small>SAHA SERVİS YÖNETİMİ</small>
            </span>
          </div>
          {nav}
          <SidebarUser user={user} />
        </div>
      </SideDrawer>
    </div>
  );
}

function SidebarNav({
  navSections,
  activeId,
  onNavigate,
}: {
  navSections: NavSection[];
  activeId?: string;
  onNavigate: (item: NavItem) => void;
}) {
  return (
    <>
      {navSections.map((section) => (
        <div key={section.label}>
          <div className="tf-navlabel" aria-hidden="true">
            {section.label}
          </div>
          <nav className="tf-nav" aria-label={section.label}>
            {section.items.map((item) => {
              const isActive = item.id === activeId;
              const commonClass = `tf-nav__item ${isActive ? 'tf-nav__item--active' : ''}`.trim();
              const icon = item.icon ? (
                <span className="tf-nav__icon">
                  <Icon name={item.icon} size={17} />
                </span>
              ) : null;

              if (item.href) {
                return (
                  <a
                    key={item.id}
                    href={item.href}
                    className={commonClass}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {icon}
                    <span>{item.label}</span>
                    {typeof item.count === 'number' ? (
                      <span className="tf-nav__count" aria-label={`${item.count} bekleyen`}>
                        {item.count}
                      </span>
                    ) : null}
                  </a>
                );
              }

              return (
                <button
                  key={item.id}
                  type="button"
                  className={commonClass}
                  aria-disabled="true"
                  title="Bu bölüm sonraki fazlarda açılır"
                  onClick={() => onNavigate(item)}
                >
                  {icon}
                  <span>{item.label}</span>
                  {typeof item.count === 'number' ? (
                    <span className="tf-nav__count" aria-label={`${item.count} bekleyen`}>
                      {item.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>
      ))}
    </>
  );
}

function SidebarUser({ user }: { user: ShellUser }) {
  return (
    <div className="tf-sidebar__bottom">
      <Avatar initials={user.initials} />
      <div className="tf-sidebar__user">
        <b>{user.name}</b>
        <small>{user.role}</small>
      </div>
    </div>
  );
}
