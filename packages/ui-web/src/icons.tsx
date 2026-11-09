import type { CSSProperties, ReactElement } from 'react';

/**
 * TeknikFlow çizgi ikon seti — 16-18px, stroke tabanlı, erişilebilir.
 * İkonlar süslü değildir; işlevleri adlandırır (aria-hidden ile süs,
 * metin taşıyan bileşenler anlamı verir).
 */

export type IconName =
  | 'overview'
  | 'work-orders'
  | 'dispatch'
  | 'customers'
  | 'assets'
  | 'map'
  | 'team'
  | 'warehouse'
  | 'maintenance'
  | 'quotes'
  | 'reports'
  | 'settings'
  | 'billing'
  | 'search'
  | 'bell'
  | 'menu'
  | 'close'
  | 'chevron-right'
  | 'plus'
  | 'alert'
  | 'clock'
  | 'users'
  | 'check'
  | 'refresh'
  | 'list'
  | 'pin'
  | 'inbox'
  | 'inbox-off';

const PATHS: Record<IconName, ReactElement> = {
  overview: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  'work-orders': (
    <>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3.5 6h.01" />
      <path d="M3.5 12h.01" />
      <path d="M3.5 18h.01" />
    </>
  ),
  dispatch: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M3 10h18" />
    </>
  ),
  customers: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M3 20c0-3.3 2.7-5.4 6-5.4s6 2.1 6 5.4" />
      <path d="M16 5.6a3.4 3.4 0 0 1 0 6.5" />
      <path d="M17.5 14.9c2.1.7 3.5 2.4 3.5 5.1" />
    </>
  ),
  assets: (
    <>
      <path d="M3.5 8.5 12 4l8.5 4.5v7L12 20l-8.5-4.5z" />
      <path d="M3.5 8.5 12 13l8.5-4.5" />
      <path d="M12 13v7" />
    </>
  ),
  map: (
    <>
      <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  team: (
    <>
      <circle cx="7.5" cy="7.5" r="3" />
      <circle cx="16.5" cy="7.5" r="3" />
      <path d="M2.5 19.5c0-2.8 2.2-4.6 5-4.6" />
      <path d="M21.5 19.5c0-2.8-2.2-4.6-5-4.6" />
    </>
  ),
  warehouse: (
    <>
      <path d="M3 9.5 12 4l9 5.5V20H3z" />
      <path d="M7.5 20v-6h9v6" />
      <path d="M7.5 16.5h9" />
    </>
  ),
  maintenance: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 3.5V8h-4.5" />
    </>
  ),
  quotes: (
    <>
      <path d="M5 3.5h14v17l-7-3.5-7 3.5z" />
      <path d="M9 8.5h6" />
      <path d="M9 12.5h4" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20V9" />
      <path d="M10 20V4" />
      <path d="M16 20v-8" />
      <path d="M22 20H2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
    </>
  ),
  billing: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 9.5h19" />
      <path d="M6 14.5h4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4s2-1.5 2-6.5" />
      <path d="M10 19a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  menu: (
    <>
      <path d="M4 6.5h16" />
      <path d="M4 12h16" />
      <path d="M4 17.5h16" />
    </>
  ),
  close: (
    <>
      <path d="m5 5 14 14" />
      <path d="M19 5 5 19" />
    </>
  ),
  'chevron-right': <path d="m9 5 7 7-7 7" />,
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 22 20H2z" />
      <path d="M12 9.5v4.5" />
      <path d="M12 17h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.5l3.5 2" />
    </>
  ),
  users: (
    <>
      <circle cx="12" cy="7.5" r="4" />
      <path d="M4 20.5c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  refresh: (
    <>
      <path d="M20 8a8.5 8.5 0 1 0 .5 6" />
      <path d="M20 3v5h-5" />
    </>
  ),
  list: (
    <>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s6.5-5.8 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.2 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.4" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 13h5l1.5 3h5L16 13h5" />
      <path d="M5 5h14l2 8v6H3v-6z" />
    </>
  ),
  'inbox-off': (
    <>
      <path d="M3 13h5l1.5 3h5L16 13h5" />
      <path d="M5 5h14l2 8v6H3v-6z" />
      <path d="m4 4 16 16" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  size?: number;
  /** Renk: currentcolor varsayılan; kalınlık dar ebatlarda incelir. */
  style?: CSSProperties;
  className?: string;
}

/** Süs ikonu — ekran okuyuculardan gizlenir (anlam metinde taşınır). */
export function Icon({ name, size = 18, style, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentcolor"
      strokeWidth={size <= 14 ? 2.2 : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
