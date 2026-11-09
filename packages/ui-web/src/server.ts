/**
 * RSC-güvenli (React Server Component) görünüm.
 *
 * Barrel (index.js) AppShell/ConfirmDialog/SideDrawer gibi hook kullanan
 * istemci bileşenlerini de toplar → sunucu bileşenlerinde barrel import
 * "use client" gerektirir. Bu giriş noktası yalnız sunum-bileşenlerini
 * (hooksuz) dışa açar; Next.js sunucu sayfaları bundan import eder.
 *
 * Kurallar: buraya EKLENEN her modül hooksuz olmalı (useId dahil —
 * LogoMark useId kullanır ve bu yüzden burada YOKTUR; ShellFrame
 * istemcide sarar).
 */
export { StatusBadge, type BadgeTone, type StatusBadgeProps } from './components/status-badge.js';
export { Card, Panel, type CardProps, type PanelProps } from './components/card.js';
export { MetricCard, type MetricCardProps, type MetricTone } from './components/metric-card.js';
export { DataTable, type DataTableColumn, type DataTableProps } from './components/data-table.js';
export { Alert, type AlertProps, type AlertVariant } from './components/alert.js';
export {
  Breadcrumbs,
  PageHeader,
  type BreadcrumbItem,
  type PageHeaderProps,
} from './components/page.js';
export { Icon, type IconName, type IconProps } from './icons.js';
export { DetailList, type DetailItem, type DetailListProps } from './components/detail-list.js';
// Pager (href tabanlı) RSC-güvenlidir; onChange kullanan istemci tarafında çalışır.
// Pager 'use client' dosyasıdır; sunucu sayfalarından serileştirilebilir
// props'larla (hrefTemplate) güvenle kullanılır (client reference).
export { Pager, type PagerProps } from './components/pager.js';
