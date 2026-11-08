# Global Definition of Done

A feature is done only when:
1. Product behavior and role/tenant rules are documented.
2. Loading, empty, error, success, offline and permission-denied states are designed where applicable.
3. Inputs validated on client and server; server remains authoritative.
4. Unit and integration tests cover normal, boundary, failure and authorization cases.
5. New/changed web components have Storybook stories; interaction tests cover primary behavior and accessibility basics.
6. Critical web journeys have Playwright E2E coverage on Chromium and at least smoke coverage on a second engine in CI if resources permit.
7. Mobile features have RNTL tests and Maestro E2E for high-risk field journeys.
8. Tenant-crossing negative tests prove no IDOR/data leakage.
9. Performance impact reviewed; pagination and query plan considered.
10. Telemetry/audit events added without logging sensitive data.
11. Docs, API contracts, changelog and STATUS are updated.
12. Build, lint, typecheck and required tests pass. Any skipped test is documented with a follow-up, not represented as passed.
