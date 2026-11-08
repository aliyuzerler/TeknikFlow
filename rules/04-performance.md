# Performance Rules
- Paginate and filter server-side. No unbounded list endpoints.
- Avoid N+1 queries; inspect ORM query count and explain plans.
- Lazy-load maps, charts, editors and heavy media components.
- Virtualize long mobile and web lists.
- Compress images/videos; upload asynchronously with progress.
- Cache only with tenant + permission-aware keys and explicit invalidation.
- Measure before optimizing; document p95 and bundle size changes.
