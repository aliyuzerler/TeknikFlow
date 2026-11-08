# Deployment and Operations

## Local development
Docker Compose services: PostgreSQL, Redis, MinIO, Mailpit (optional). Apps run locally with hot reload. Provide health checks, seeded demo tenant and reset script that is disabled in production.

## Environments
Separate local/dev/staging/production. Separate DB, object bucket, payment provider keys, push credentials and secrets. Never copy production PII into dev/staging without approved anonymization.

## Production
Use managed PostgreSQL with automated backups/PITR where available, private object storage with versioning/lifecycle policies, managed Redis or protected deployment, TLS termination and WAF/rate limits. Container images are immutable and scanned.

## Backup/restore
- Automated DB backups and object-storage replication/versioning according to RPO/RTO.
- Document backup retention and encryption.
- Quarterly restore drill on isolated environment; verify DB + referenced media consistency.
- Tenant-level export and tenant deletion workflows are separate from infrastructure backup.

## Observability
Health/readiness, error reporting, request IDs, traces, API latency, DB saturation, job queue lag, mobile sync failures, attachment failures, webhook failures and billing reconciliation metrics.

## Release
Feature flags for risky modules; migration expand/contract pattern; backward-compatible mobile API; phased rollout; rollback plan. Keep API compatibility with at least the supported previous mobile version.
