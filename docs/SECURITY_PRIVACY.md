# Security and Privacy Requirements

## Baseline
Align implementation with OWASP ASVS (web/API) and OWASP MASVS principles (mobile). Threat model tenant isolation, account takeover, malicious attachments, IDOR, webhook spoofing, replay, token theft, mobile device loss, location exposure and privilege escalation.

## Authentication/session
- Argon2id password hash with sensible current parameters.
- Rate-limit login, password reset, invite acceptance and MFA endpoints; generic auth errors to reduce account enumeration.
- Email verification, secure password reset token hashing + one-time expiry.
- MFA-ready model; enforce MFA for platform admins and optionally tenant owners.
- Web: HttpOnly Secure SameSite cookies + CSRF token/origin checks for unsafe verbs.
- Mobile: SecureStore/Keychain/Keystore; rotate refresh tokens and detect reuse.
- Session listing/revocation; short-lived access tokens.

## Authorization and tenant isolation
- Server-side RBAC plus branch/resource scope checks on every route and background job.
- Do not trust tenantId, role, membership or owner IDs from body/query without server verification.
- Database composite keys and RLS defense-in-depth; test IDOR and cross-tenant reads/writes, including attachments, exports, search and websocket/events.
- Platform support access requires explicit reason, least privilege, short duration, audit log and customer-visible event where appropriate.

## Data handling
- TLS in transit; encryption at rest via managed DB/object-store encryption. Sensitive values such as tax IDs should be encrypted/tokenized if retained.
- Secrets in secret manager/environment, never committed. Rotate keys. `.env.example` has placeholders only.
- Minimize PII in logs and analytics. Define retention and deletion/export workflows.
- Audit actor, action, resource, tenant, timestamp, request ID and safe diff; do not store passwords/tokens/full signatures in audit payload.

## File upload
- Private bucket; tenant-scoped opaque object keys; short-lived signed URLs.
- Check magic bytes, MIME, extension, file size, video duration and allowed formats.
- Quarantine and malware scanning hook. Re-encode images and strip EXIF by default; original retention configurable.
- Protect against SVG/script payloads, path traversal and oversized decompression.

## Location and employee privacy
- Ask permission only at the point of a clear location-based feature.
- Capture location for explicit visit milestones (arrival/check-in/departure/check-out) with timestamp and accuracy.
- No continuous/background tracking by default. If ever added, it requires separate product/legal approval, notice, tenant policy, worker controls and retention limits.
- Provide manual location/reason fallback for GPS failure; never silently fabricate coordinates.

## Payments and webhooks
- Never store card PAN/CVV. Use provider-hosted/tokenized payment flows.
- Verify webhook signatures and timestamps; event dedupe and replay protection; do not trust frontend redirect as proof of payment.
- Keep payment keys separate by environment and tenant/provider account.

## Secure engineering
- Input validation, output encoding, parameterized DB access, CSP, secure headers, CORS allowlist, CSRF protection, SSRF controls for external URLs, rate limits and abuse detection.
- Dependency/SBOM scanning, secret scanning, SAST and container scanning in CI.
- Production error response must not leak stack traces or secrets.
- Incident response, backup restore and breach notification playbooks to be documented and reviewed by qualified counsel/security professionals before commercial launch.
