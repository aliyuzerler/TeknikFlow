# Database and API Rules
- Tenant-owned rows require `tenant_id`; composite unique constraints and indexes must be deliberate.
- Use migrations; never mutate production schema manually.
- Monetary values are integer minor units; quantities use decimal.
- Inventory is movement-ledger based and append-only for normal roles.
- Use transactions for stock, work-order completion and billing state.
- Add idempotency to retried writes, sync operations and webhooks.
- Use version/optimistic concurrency for dispatch and work order edits.
- Use UTC timestamps and tenant timezone only for display/scheduling.
