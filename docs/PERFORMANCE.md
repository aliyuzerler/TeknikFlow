# Performance and Reliability Budgets

## Web targets (production-like, mid-range device/network)
- Core Web Vitals target: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1 at p75 where measurable.
- Initial route JS minimized; route-level code splitting; avoid loading map, chart and rich editor bundles until required.
- API read p95 < 400ms for typical indexed queries; write p95 < 700ms excluding external providers and large media.
- Search/list endpoints paginated; default page size 25, max 100; cursor for large histories.

## Mobile targets
- Cold start target < 3.5s on representative mid-range Android; keep first usable screen fast.
- 60fps target for common navigation/list interactions; virtualize long lists.
- Image upload resized/compressed on device and queued with progress; do not block form saving on media upload.
- Keep offline data set bounded and purge cached tenant data on logout/account removal.

## Database
- Index actual query patterns. Inspect EXPLAIN plans for slow queries.
- Avoid N+1; select only required columns; use transactions for invariant updates.
- Connection pool configured per deployment. Add statement timeout and slow query logging with PII-safe parameters.
- Large exports run asynchronously and stream/chunk data.

## Caching
- Cache only safe, tenant-scoped, permission-aware data. Include tenant and permission context in cache keys.
- Invalidate entitlements and permissions on membership/role/billing updates.
- Never use shared unscoped cache entries for private data.

## Resilience
- Retry transient network/provider failures with exponential backoff + jitter; cap retries and send poison jobs to dead-letter queue.
- Idempotency required for retried mutations and webhooks.
- Graceful degradation: show last sync state; never show stale/unsynced action as confirmed server state.
- Health/readiness endpoints; queue backlog and failed sync alerting.

## Load test
Use k6 or equivalent for auth, work-order list, dispatch board, technician sync and attachment metadata. Start with a documented baseline workload; report p50/p95/p99, error rate, DB pool and resource use. Do not claim capacity without running tests on declared hardware.
