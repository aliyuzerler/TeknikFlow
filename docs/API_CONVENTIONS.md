# API Contracts and Workflow Invariants

## Conventions
- Base path `/api/v1`; JSON; ISO 8601 UTC timestamps.
- Request validation at every boundary. OpenAPI generated and checked in CI for breaking changes.
- Errors: `{ "error": { "code": "WORK_ORDER_INVALID_TRANSITION", "message": "...", "requestId": "...", "fields": {} } }`.
- Lists return `{ data, pageInfo }` or cursor equivalent. Never return unbounded collection.
- Mutating requests that can be retried accept `Idempotency-Key`.
- Use ETags or `version` for concurrency-sensitive updates.

## Example routes
- `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/mfa/verify`
- `GET/POST /tenants`, `GET/PATCH /tenants/current`, `/memberships`, `/branches`
- `GET/POST /customers`, `/customers/:id/contacts`, `/service-locations`
- `GET/POST /assets`, `/assets/:id/history`
- `GET/POST /service-requests`, `POST /service-requests/:id/convert-to-work-order`
- `GET/POST /work-orders`, `POST /work-orders/:id/transitions`, `/assignments`, `/checklists`, `/labor`, `/expenses`, `/attachments`, `/signature`, `/report`
- `GET/POST /dispatch/board`, `/dispatch/availability`
- `GET/POST /inventory/items`, `/warehouses`, `/movements`, `/reservations`, `/counts`, `/transfers`
- `GET/POST /maintenance/plans`, `/maintenance/schedules`
- `GET/POST /quotes`, `POST /quotes/:id/approval`
- `GET/POST /subscriptions`, `POST /billing/checkout`, `POST /billing/webhooks/:provider`
- `GET/POST /portal/requests`, `/portal/work-orders/:id`, `/portal/quotes/:id/decision`, `/portal/documents/:id`

## Critical transaction boundaries
1. Work-order completion: validate state and permissions → validate checklist required answers → validate parts/labor/expense → create stock consumption movements and link usage rows → create immutable completion event → create report job/outbox event. Use transaction for DB state. Media object upload is staged separately and only linked after validation.
2. Inventory movement: lock affected stock balance rows or use serializable/appropriate transaction strategy → check available quantity and reservation → write movement → update cached balance atomically → audit event. Idempotency uniqueness `(tenant_id, idempotency_key)`.
3. Billing webhook: verify provider signature → deduplicate provider event → update subscription/payment state → recalculate entitlements → emit event; process retries safely.
4. Customer approval: signed one-time approval token or authenticated portal identity → enforce quote version/expiry → record approver, timestamp and exact quote snapshot.

## Work order state machine
`draft → triaged → planned → assigned → accepted → en_route → on_site → in_progress → waiting_parts | waiting_customer | completed_pending_approval → closed`.
Allow `cancelled` from approved pre-close states with permission and reason. Some transitions may be skipped by configuration (e.g. office-entered job starts at planned), but not by arbitrary status patch. Store every transition in `WorkOrderEvent`.
