# Mobile and Offline Rules
- Persist drafts locally immediately; do not rely on screen state.
- Use SQLite outbox with idempotency and retry/backoff.
- Distinguish local, queued, syncing, synced, conflict and failed.
- Do not silently overwrite stock, signature, work-order status or payment state.
- Keep tokens in OS secure storage; clear cached tenant data on logout.
- Capture GPS only on explicit check-in/visit action with visible state and permission.
- Test airplane mode, process kill/relaunch, duplicate sync and conflict paths.
