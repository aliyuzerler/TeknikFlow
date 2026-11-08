# Architecture

## Architecture style
Use a **modular monolith** for the API and a separate queue worker. Avoid microservices until operational scale justifies them. Modules have explicit boundaries and communicate through application services/domain events.

## Workspace
Use pnpm workspaces + Turborepo. Keep apps independently buildable. Shared packages must not import app internals.

## API modules
`auth`, `tenants`, `memberships`, `branches`, `billing`, `customers`, `contacts`, `locations`, `assets`, `service-requests`, `work-orders`, `dispatch`, `technicians`, `skills`, `checklists`, `attachments`, `signatures`, `inventory`, `maintenance`, `quotes`, `expenses`, `documents`, `notifications`, `customer-portal`, `reports`, `audit`, `platform-admin`.

## Data isolation
- Each tenant-owned table includes `tenant_id NOT NULL` and suitable composite indexes.
- Tenant context is established from authenticated user membership on the server. Client-supplied tenant ID is only a selector to validate, never authority.
- Prisma data access must use scoped repositories/application context. Add PostgreSQL RLS for high-risk tenant tables as defense-in-depth where feasible.
- Every unique constraint for tenant-owned records should normally be composite `(tenant_id, business_key)`.
- Background jobs carry tenant ID and verify tenant context at execution.
- Cross-tenant tests are mandatory for CRUD, search, file download, exports, jobs and billing.

## API conventions
- Versioned REST API under `/api/v1`.
- OpenAPI spec generated from NestJS; contracts validated with Zod or class-validator. Use one consistent validation model per boundary.
- Cursor pagination for large event/history feeds; page pagination acceptable for small admin tables.
- Consistent error envelope with code, safe message, request ID and field errors; never leak stack traces.
- Idempotency keys for work-order state changes, inventory movements, mobile sync, billing events and external callbacks.
- Optimistic concurrency using `version` or `updated_at` for conflict-prone entities.
- Rate limits by tenant, user and route class.

## Authentication
- Web: secure, HttpOnly, SameSite cookies; CSRF protection for state-changing cookie-authenticated requests.
- Mobile: short-lived access token and rotating refresh token in platform secure storage; revoke token families on reuse detection.
- Password hashing with Argon2id; MFA-ready account model; invite token hashing and expiration.
- Session/device management and revoke-all-sessions support.
- Platform support access must be time-bound, reason-coded, approved and audited.

## Mobile offline model
- Local SQLite stores only the minimal assigned work-order snapshot and drafts required for field tasks.
- Use transactional outbox table with UUID idempotency key, entity version, operation, payload, created_at, retry_count, last_error.
- Server returns canonical entity state and sync cursor.
- Never blindly last-write-wins for stock, signature, work-order closure or billing. Conflicts return explicit resolution tasks.
- Attachment upload uses resumable/chunked strategy where practical; metadata sync and binary upload are separate steps.
- Token is kept in SecureStore/Keychain/Keystore; local sensitive data encrypted where platform/library support is verified.

## File storage
- Private S3-compatible buckets; object keys are opaque and tenant-scoped.
- API issues short-lived signed upload/download URLs after authorization.
- Validate actual MIME/magic bytes, size, extension and image/video duration; strip EXIF GPS from copies when not required; preserve service location separately with consent.
- Malware scanning hook; quarantine until scan passes. No public bucket access.

## Background jobs
BullMQ queues for email/push, PDF generation, reminders, subscription reconciliation, maintenance generation, media processing and report exports. Job handlers are idempotent, tenant-aware and observable.

## Billing provider abstraction
`BillingProvider` interface: createCustomer, createCheckout/PaymentIntent, changeSubscription, cancelSubscription, fetchSubscription, verifyWebhook, parseWebhook. Use provider adapter and mock provider for tests. Never hard-wire commercial logic to a single vendor. Subscription states: trialing, active, past_due, grace_period, suspended, canceled, incomplete. Entitlements are computed server-side. Payment webhooks must verify signatures and deduplicate by provider event ID.

## Observability
Structured JSON logs with request/trace/tenant identifiers (pseudonymized where possible); metrics for API latency/error, job queue delay/failure, sync conflicts, media upload failures, DB pool and billing webhook backlog. OpenTelemetry-ready traces. Sentry or equivalent adapter for error reporting; redact PII.
