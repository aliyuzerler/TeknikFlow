# Observability and Release Rules
- Use structured logs with request ID and safe tenant correlation; redact personal data and secrets.
- Instrument error rate, latency, job backlog, sync failures, storage errors and payment webhook failures.
- Feature flag risky changes; use backward-compatible DB migration pattern.
- Provide release notes, rollback plan and migration verification.
- Restore tests are a release readiness requirement for production.
