# TeknikFlow Design System

## Brand
- Name: **TeknikFlow**
- Descriptor: **Saha Servis ve Operasyon Yönetimi**
- Promise: “Servis operasyonunuz, ofisten sahaya tek akışta.”
- Brand personality: competent, dependable, precise, calm, modern industrial.
- Logo direction: geometric route/flow mark made from two connected strokes forming a subtle “T”; wordmark in a clean geometric sans. Do not use wrench/gear clipart.

## Visual language
- Primary canvas: very light cool gray `#F5F7FA`.
- Surface: white `#FFFFFF`.
- Sidebar / deep surfaces: ink navy `#132238`.
- Primary action: technical blue `#2563EB`.
- Secondary accent: teal `#0F9F9A`.
- Text: `#172033`; secondary `#64748B`; border `#E2E8F0`.
- Success `#15803D`, warning `#B45309`, danger `#B91C1C`, info `#0369A1`.
- Color must never be the only status indicator; pair status with label and/or icon.

## Typography
Use Inter or a metrically similar sans-serif. Hierarchy: page title 24–28px/600, section title 16–18px/600, body 14–15px/400, table 13–14px, metadata 12px with sufficient contrast. Avoid tiny text below 12px except nonessential legal metadata.

## Layout
- Desktop dashboard target: 1440px canvas, sidebar 248px, top bar 64px, content max-width responsive.
- Main content 24px desktop padding; 16px tablet; 16px mobile.
- 8px spacing base; radii 8px controls, 12px cards, 14px modal.
- Compact data tables with 48–56px rows, clear column alignment, sticky header only when useful.
- Use 12-column grid on desktop; collapse to 1 column on narrow screens.

## Components
Create reusable components: AppShell, Sidebar, Topbar, Breadcrumbs, PageHeader, MetricCard, StatusBadge, DataTable, FilterBar, SearchInput, DateRangePicker, EmptyState, ErrorState, Skeleton, ConfirmDialog, SideDrawer, FormField, Combobox, FileDropzone, Timeline, ActivityFeed, TechnicianAvatar, WorkOrderCard, MapPanel, SignaturePad, OfflineBanner, SyncStatus, PermissionGate, UpgradePrompt.

## States
Every async screen has initial loading/skeleton, empty state with next action, error state with retry and permission-denied state. Destructive actions require confirmation and clear object context. Forms show field-level validation and preserve user input after recoverable failure.

## Accessibility
Target WCAG 2.2 AA. Keyboard navigation, visible focus, semantic landmarks, labels, accessible names, dialog focus trap/restore, sufficient contrast, reduced-motion support. Do not rely on color alone.

## Data visualization
Use charts only when they answer a real operational question. Include title, period, unit, accessible table/summary alternative and empty state. Avoid decorative donuts and 3D charts.

## Mobile
- Minimum touch target 44x44pt (prefer 48pt).
- Thumb-zone primary action at bottom for job workflow.
- Offline and pending sync state visible at all times when relevant.
- Forms optimized for field conditions; save drafts automatically.
- One task per step for long workflows; support camera, gallery and barcode scanning with explicit user action.
- Avoid dense desktop tables; use readable cards and compact lists.

## Tokens
Canonical tokens are in `design/tokens.css`. Apps should consume the generated equivalents; do not duplicate hex values in feature components.
