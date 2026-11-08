# Mobile Offline and Sync Protocol

## Principles
- Work offline only for data the signed-in technician is allowed to access and has explicitly synced.
- Clearly distinguish local draft, queued, syncing, synced, conflict and failed states.
- Save field form changes locally immediately. Avoid losing work on navigation/app restart.
- Keep authentication tokens in OS secure storage, not SQLite/plain preferences.

## Local tables
`cached_work_order`, `cached_asset`, `cached_customer_minimal`, `draft_checklist`, `draft_labor`, `draft_note`, `pending_attachment`, `sync_outbox`, `sync_cursor`, `sync_conflict`.

## Outbox operation
Each operation includes `idempotency_key`, `tenant_id`, `user_id`, entity ID, base entity version, operation type, minimal payload, created time and retry state. Server deduplicates key and returns canonical state.

## Conflict policy
- Notes/checklist draft: allow field-level merge only when safe; otherwise present both versions.
- Work-order status: server state machine wins; return actionable conflict.
- Stock: server availability is authoritative; a conflict creates a pending stock exception, never negative stock without explicit tenant policy.
- Signature: append-only; do not overwrite another signature. Re-sign requires explicit correction event.
- Billing: never offline-finalize payment or invoice state.

## Attachments
Persist metadata, local URI and upload state. Retry resumable upload when possible. Show failed uploads clearly. Work order cannot be fully closed if required evidence has not reached server unless tenant policy explicitly allows a pending-evidence closure state.

## Security
Encrypt local sensitive data where robust platform support exists; expire offline snapshots on logout/revocation. On device loss, revoke sessions. No sensitive data in device logs or notification body by default.
