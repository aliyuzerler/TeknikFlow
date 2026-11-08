# Product Requirements — TeknikFlow

## 1. Product summary
TeknikFlow is a multi-tenant field service management SaaS for technical service companies, equipment manufacturers, maintenance contractors, HVAC/electrical/industrial service firms and distributed field teams. It connects office dispatch, technicians, warehouses and customers through web and mobile applications.

## 2. Target personas
- **Tenant owner:** owns company workspace, plan, billing and branch configuration.
- **Operations manager / dispatcher:** triages requests, creates work orders, schedules teams, monitors SLA and escalations.
- **Service manager:** manages service contracts, equipment history, maintenance plans and quality.
- **Technician / team lead:** receives assigned jobs, navigates to the site, performs checklist/work, records parts/time/photos, gets customer sign-off and closes work.
- **Warehouse operator:** handles parts, serial/lot, transfers, reservations, technician van stock and replenishment.
- **Finance user:** handles quotes, expenses, billable work, invoices/export and receivables overview.
- **Customer contact:** opens service request, approves quote, sees appointment and report, downloads documents.
- **Platform support admin:** manages tenants, plans, subscriptions and support access with audited break-glass permissions.

## 3. Core modules
1. Tenant onboarding, branches, teams, users, roles, invitations and plan entitlements.
2. CRM: organizations, contacts, billing details, service locations, communication timeline.
3. Asset/equipment registry: asset tag, manufacturer, model, serial, QR code, installation date, warranty, manuals, service history and location hierarchy.
4. Service intake: portal form, manual office entry, email/API integration-ready intake, category, priority, SLA and attachments.
5. Work order lifecycle: draft, triage, planned, assigned, accepted, en route, on site, in progress, waiting parts/customer, completed pending approval, closed, cancelled. State changes are validated and audited.
6. Dispatch: calendar, list and kanban; technician capacity, skills, availability, territory, schedule conflicts and reassignment.
7. Technician mobile: today list, work order details, directions deep link, explicit check-in/out, checklist, labor, parts, photos/video, notes, signature and service report.
8. Inventory: warehouses, bins, stock items, SKUs, serial/lot tracking, stock movements, reservations, returns, transfers, cycle counts, reorder levels, technician/vehicle stock.
9. Preventive maintenance: recurring schedule, meter/usage-based schedule-ready design, templates, automatic work order generation and reminders.
10. Quote/approval and financial tracking: estimates, line items, discounts/tax configurable, customer approval/rejection, labor/parts/expenses, invoice status/export; no claim of certified e-invoice integration unless implemented with an approved provider.
11. Service documents: branded PDF work order/service reports, photo attachments, checklist, timestamps, technician and customer sign-off.
12. Customer portal: service request, request status, appointment windows, quotes, asset history, reports and document access.
13. Notifications: in-app, email and push; SMS/WhatsApp behind provider adapters and opt-in/consent rules.
14. Analytics: response time, first-time fix rate, SLA compliance, utilization, revisit rate, parts usage, technician workload, contract profitability, recurring faults.
15. SaaS billing: plans, seat packs, usage meters, trials, subscription state, invoices, payment events, grace period, dunning and tenant entitlements.
16. Platform admin: tenant search, operational metrics, billing support, safe impersonation/support access with reason, time limit and immutable audit trail.

## 4. Core user journeys
### J1 — Request to closed job
Customer/office opens service request → dispatcher triages → creates/links asset → priority/SLA set → work order assigned → technician accepts → travel/check-in → performs checklist and work → parts/labor/expense recorded → photos/video attached → customer signs → PDF report generated → manager closes → customer notified.

### J2 — Technician inventory use
Technician selects a part and quantity from assigned van/stock → API validates availability and permission → reservation/consumption movement recorded atomically with work-order usage → stock balance updates → low-stock threshold may trigger replenishment request. Offline action is queued with idempotency key and reconciled on sync; conflict must be visible, never silently overdraw stock.

### J3 — Preventive maintenance
Asset is linked to a maintenance plan → due date/usage threshold approaches → notification to dispatcher → planned work order created → assigned → completed checklist → next due date recalculated and history retained.

### J4 — Subscription and seat change
Tenant owner chooses plan/seat count → checkout/provider adapter → signed provider webhook → subscription state updated idempotently → entitlement cache invalidated → new limits enforced server side. Downgrade never silently deletes data; excess users are marked over-limit and admin is guided to resolve it.

## 5. MVP priorities
### MVP must-have
- Tenant, branch, role and team setup.
- Customer/contact/site/asset CRUD.
- Service request and work order lifecycle.
- Dispatcher list/kanban/calendar basics and technician assignment.
- Mobile technician inbox and work order detail.
- Explicit location check-in/out, offline notes/checklists and attachment upload queue.
- Service checklist, labor, parts used, photos and signature capture.
- PDF service report.
- Basic stock per warehouse/van with movements and work-order consumption.
- Preventive date-based maintenance.
- Customer portal for request/status/report.
- SaaS subscription state and seat limits, with mock billing provider for development.
- Audit trail, tenant isolation, backup and monitoring.

### Later iterations
- Route optimization, AI dispatch suggestions, IoT/meter-based maintenance, advanced ERP/accounting/e-invoice integrations, WhatsApp provider, customer satisfaction/NPS, advanced profitability analytics, configurable workflow builder.

## 6. Non-functional requirements
- Secure tenant isolation and least privilege.
- Offline-first field workflows with eventual sync and conflict visibility.
- Accessible web app (WCAG 2.2 AA target) and clear mobile touch affordances.
- Fast list/filter interactions; server-side pagination and search.
- Auditability for job, stock, billing, access and signature events.
- Disaster recovery: documented database and object storage backups with restore drills.
- Localization: Turkish first; architecture supports English. Currency and timezone are tenant-configurable; default TR locale and Europe/Istanbul only as initial default, not a hard-coded global assumption.

## 7. Out of scope until separately approved
- Covert or continuous employee location tracking.
- Payroll or full accounting ledger.
- Legal claims that canvas signature is qualified electronic signature.
- Direct device camera/microphone access without user action and clear disclosure.
- Automatic destructive enforcement on overdue billing.
