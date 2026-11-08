# SaaS Billing and Entitlements

## Commercial model
Monthly/annual subscription with included seats and optional additional seat packs. Plans may differ by work-order volume, storage, branch count, customer portal, advanced analytics and integrations. All pricing/limits are configurable data, never constants hard-coded in UI.

## Plan examples (placeholders, not market pricing)
- Starter: small team, core work orders, customer/equipment records, limited storage.
- Professional: dispatch board, maintenance plans, inventory, customer portal, reporting, more seats.
- Business: multi-branch, advanced permissions, automation, API/integrations and extended audit.
- Enterprise: custom seat/usage quotas, SSO-ready, priority support, dedicated deployment options.

## Entitlement model
`PlanEntitlement(key, value, unit, hard_or_soft_limit)`. Runtime service evaluates tenant subscription state, seats and usage. UI can explain limits but API must enforce. Add usage metering for API, storage, monthly work orders and active seats only when product needs it.

## Subscription states
`trialing → active → past_due → grace_period → suspended` and `active → canceled` (continues until period end if configured). State changes are recorded with source and provider event ID.

## Billing behavior
- Trial and plan changes configurable.
- Seat increase can apply immediately; seat decrease at renewal by default.
- Downgrade must not delete records or attachments. Restrict creation of over-limit items and provide export path.
- Grace period configurable. Never delete tenant data due to payment failure.
- Canceled tenant may have read-only/export period according to terms.
- Payment success is confirmed only by verified provider webhook/server reconciliation.
- Mock provider supports deterministic local and CI tests.
