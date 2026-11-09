# Roles and Permission Matrix

Roles are templates; tenants can create custom roles only by selecting from a permission catalogue. Enforce server-side.

| Capability | Owner | Admin | Dispatcher | Service manager | Technician | Warehouse | Finance | Customer portal |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Manage tenant/billing | Yes | Limited | No | No | No | No | Billing view | No |
| Manage users/roles | Yes | Yes | No | No | No | No | No | No |
| View all customers/assets | Yes | Yes | Yes | Yes | Assigned only | Limited | Yes | Own only |
| Manage customers/contacts/locations (Phase 04) | Yes | Yes | Yes | Yes | No | No | No | No |
| Manage asset registry & documents (Phase 04) | Yes | Yes | Yes | Yes | No | No | No | No |
| Create service request | Yes | Yes | Yes | Yes | Limited | No | No | Own only |
| Dispatch/assign jobs | Yes | Yes | Yes | Yes | No | No | No | No |
| View assigned work | Yes | Yes | Yes | Yes | Yes | No | No | Own request only |
| Complete job/checklist | Yes | Yes | No | Yes | Assigned only | No | No | No |
| Capture signature | Yes | Yes | No | Yes | Assigned only | No | No | Approve own report |
| Manage stock movements | Yes | Yes | Limited | Yes | Assigned van issue/use | Yes | Read-only | No |
| Manage quotes/expenses | Yes | Yes | Limited | Yes | Submit own expense | No | Yes | Approve own quote |
| View financial reports | Yes | Yes | No | Limited | Own jobs only | No | Yes | No |
| Platform support access | No | No | No | No | No | No | No | No |

Implement permission checks at resource and action level. `Assigned only` must verify the user is an active assignee or team member for that work order. Branch scope must be checked separately from role. Customer portal access must use explicit grants and resource ownership; never infer access from an email address alone.
