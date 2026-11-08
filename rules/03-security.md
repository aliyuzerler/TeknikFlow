# Security Rules
- Read `docs/SECURITY_PRIVACY.md` before any auth, file, tenant, billing or location change.
- Server-side RBAC/resource scope is mandatory; frontend permission gates are UX only.
- Scope every tenant query; test cross-tenant IDOR for list/detail/update/delete/download/export.
- Never put secrets in code, docs, logs or screenshots.
- Use secure token storage, refresh rotation, CSRF protection for cookie sessions, rate limits and security headers.
- Files private by default and delivered only through authorized short-lived URLs.
- Location only after explicit user action; no covert tracking.
- Add security tests for all new endpoints.
