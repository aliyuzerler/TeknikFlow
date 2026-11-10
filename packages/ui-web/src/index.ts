/**
 * @teknikflow/ui-web — TeknikFlow web tasarım sistemi.
 *
 * Faz 02: marka (logo), kabuk (AppShell/Sidebar/Topbar), temel bileşenler
 * (düğme, girdi, rozet, kart, tablo, onay kutusu, yan panel) ve durumlar
 * (boş/hata/iskelet/çevrimdışı/senkron). Tümü docs/DESIGN_SYSTEM.md ve
 * design/preview.html önizlemesine sadık; renk/boşluk değerleri token'lardan.
 *
 * Still: `import '@teknikflow/ui-web/styles.css'`
 * (öncesinde '@teknikflow/design-tokens/tokens.css' yüklenmelidir).
 */

// Marka
export { Logo, LogoMark } from './brand/logo.js';

// Kabuk
export {
  AppShell,
  type AppShellProps,
  type NavItem,
  type NavSection,
  type ShellUser,
} from './components/app-shell.js';

// Sayfa yapıları
export {
  Breadcrumbs,
  PageHeader,
  type BreadcrumbItem,
  type PageHeaderProps,
} from './components/page.js';

// Temel bileşenler
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './components/button.js';
export {
  FormField,
  Input,
  SearchInput,
  type FormFieldProps,
  type InputProps,
  type SearchInputProps,
} from './components/input.js';
export { StatusBadge, type BadgeTone, type StatusBadgeProps } from './components/status-badge.js';
export { Card, Panel, type CardProps, type PanelProps } from './components/card.js';
export { MetricCard, type MetricCardProps, type MetricTone } from './components/metric-card.js';
export { DataTable, type DataTableColumn, type DataTableProps } from './components/data-table.js';

// Diyaloglar
export { ConfirmDialog, type ConfirmDialogProps } from './components/confirm-dialog.js';
export { SideDrawer, type SideDrawerProps } from './components/side-drawer.js';

// Durumlar ve geri bildirim
export { Alert, type AlertProps, type AlertVariant } from './components/alert.js';
export {
  EmptyState,
  ErrorState,
  Skeleton,
  type EmptyStateProps,
  type ErrorStateProps,
  type SkeletonProps,
} from './components/states.js';
export {
  Avatar,
  OfflineBanner,
  ProgressBar,
  SyncStatus,
  type AvatarProps,
  type AvatarTone,
  type OfflineBannerProps,
  type ProgressBarProps,
  type SyncState,
  type SyncStatusProps,
} from './components/feedback.js';

// İkonlar
export { Icon, type IconName, type IconProps } from './icons.js';

// Faz 04: sayfalama + tanım listesi
export { Pager, type PagerProps } from './components/pager.js';
export { DetailList, type DetailItem, type DetailListProps } from './components/detail-list.js';

// Faz 05: olay akışı / zaman çizelgesi
export {
  Timeline,
  type TimelineItem,
  type TimelineProps,
  type TimelineTone,
} from './components/timeline.js';

// Kanca
export { useFocusTrap } from './hooks/use-focus-trap.js';

// Faz 06: dispatch panosu bileşenleri
export { MeterBar, type MeterBarProps } from './components/meter-bar.js';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from './components/segmented-control.js';

// Faz 08: imza tuvali
export {
  SignaturePad,
  sanitizeStrokes,
  type SignaturePadPoint,
  type SignaturePadProps,
  type SignaturePadStroke,
} from './components/signature-pad.js';

// Faz 09: miktar girdisi (stok tüketim/hareket formları)
export {
  QuantityInput,
  type QuantityInputProps,
} from './components/quantity-input.js';
