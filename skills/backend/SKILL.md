# Skill: Backend and Domain Engineering

1. Identify aggregate, tenant ownership, permissions and invariants.
2. Add/adjust schema and migration with indexes/constraints.
3. Add scoped repository and application service; keep controller thin.
4. Validate DTO/schema at boundary and return stable error codes.
5. Add audit/domain event and outbox where side effects are needed.
6. Wrap multi-record invariants in transaction; make retries idempotent.
7. Add unit + integration + authorization + cross-tenant tests.
8. Update OpenAPI and API docs.

Never expose ORM models directly or trust tenant IDs from client payload.
