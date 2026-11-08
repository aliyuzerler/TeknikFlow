# Data Model — initial entity map

All tenant-owned entities contain `tenant_id`, `created_at`, `updated_at`, `created_by`, and (where useful) `version`. Use UUID/ULID IDs; never expose sequential database IDs.

## Identity and SaaS
- `User(id, email_normalized, password_hash, display_name, status, mfa_enabled, created_at)`
- `Tenant(id, name, slug, status, timezone, locale, currency, settings_json)`
- `Membership(id, tenant_id, user_id, role_id, branch_scope, status, invited_at, accepted_at)`
- `Role`, `Permission`, `RolePermission`, `Session`, `RefreshTokenFamily`, `Invitation`
- `Plan`, `PlanEntitlement`, `Subscription`, `SubscriptionItem`, `SeatAllocation`, `UsageCounter`, `BillingCustomer`, `BillingEvent`, `ProviderWebhookEvent`

## Organization/CRM
- `Branch(id, tenant_id, name, code, address, timezone)`
- `Team(id, tenant_id, branch_id, name)`
- `TeamMember(id, tenant_id, team_id, user_id, active_from, active_to)`
- `Customer(id, tenant_id, customer_type, name, tax_id_encrypted_or_tokenized, status, billing_address)`
- `Contact(id, tenant_id, customer_id, name, email, phone, notification_preferences)`
- `ServiceLocation(id, tenant_id, customer_id, address, geo_point, access_notes, site_contact_id)`

## Assets and service catalog
- `Asset(id, tenant_id, customer_id, service_location_id, parent_asset_id, asset_tag, serial_number, manufacturer, model, installed_at, warranty_until, status, criticality, metadata_json)`
- `AssetDocument(id, tenant_id, asset_id, object_key, document_type, visibility)`
- `ServiceCategory`, `ServiceType`, `FaultCode`, `Skill`, `UserSkill`, `SlaPolicy`, `ServiceContract`, `ContractAsset`, `ContractEntitlement`

## Requests, work orders and execution
- `ServiceRequest(id, tenant_id, customer_id, asset_id, service_location_id, source, subject, description, priority, status, sla_due_at)`
- `WorkOrder(id, tenant_id, request_id, customer_id, asset_id, service_location_id, branch_id, work_order_no, type, priority, status, scheduled_start, scheduled_end, assigned_team_id, assigned_to, accepted_at, started_at, completed_at, closed_at, version)`
- `WorkOrderAssignment(id, tenant_id, work_order_id, user_id, assigned_by, assigned_at, status)`
- `WorkOrderEvent(id, tenant_id, work_order_id, event_type, from_state, to_state, actor_id, metadata_json, occurred_at)`
- `ChecklistTemplate`, `ChecklistTemplateItem`, `WorkOrderChecklist`, `WorkOrderChecklistAnswer`
- `LaborEntry(id, tenant_id, work_order_id, user_id, started_at, ended_at, minutes, description, billable)`
- `Expense(id, tenant_id, work_order_id, category, amount_minor, currency, receipt_object_key, approval_status)`
- `WorkOrderNote`, `WorkOrderAttachment`, `CustomerSignature`

## Inventory
- `StockItem(id, tenant_id, sku, name, unit, tracking_mode, reorder_point, active)`
- `Warehouse(id, tenant_id, branch_id, name, type)`; type includes central, branch, vehicle/technician.
- `StockBin(id, tenant_id, warehouse_id, code)`
- `StockLot(id, tenant_id, stock_item_id, lot_no, serial_no, expires_at, cost_minor)`
- `StockMovement(id, tenant_id, stock_item_id, lot_id, from_warehouse_id, to_warehouse_id, movement_type, quantity_delta, reference_type, reference_id, idempotency_key, actor_id, occurred_at)`
- `StockReservation(id, tenant_id, stock_item_id, lot_id, warehouse_id, work_order_id, reserved_qty, consumed_qty, status)`
- `PurchaseOrder`, `PurchaseOrderLine`, `Supplier`, `StockCount`, `StockCountLine`, `ReplenishmentRequest`

## Maintenance, commercial and customer portal
- `MaintenancePlan`, `MaintenanceSchedule`, `MaintenanceExecution`
- `Quote`, `QuoteLine`, `QuoteApproval`, `InvoiceRecord` (reference/status, not full legal ledger by default), `PaymentRecord`, `CustomerPortalIdentity`, `PortalAccessGrant`
- `Notification`, `NotificationPreference`, `OutboxEvent`, `AuditLog`, `FileObject`, `ExportJob`

## Required constraints / indexes
- Unique `(tenant_id, work_order_no)`, `(tenant_id, sku)`, `(tenant_id, asset_tag)` where business rules permit.
- Index all foreign keys and common filters `(tenant_id, status, created_at)`, `(tenant_id, assigned_to, scheduled_start)`, `(tenant_id, customer_id, created_at)`.
- `StockMovement` is append-only to ordinary tenant roles; corrections are compensating movements with reason and audit trail.
- Store money as integer minor units plus ISO currency. Never use float for money.
- Quantities use fixed precision decimal; never binary floating point.
- Store UTC timestamps. Tenant timezone is applied for display/scheduling.
- Enforce non-negative inventory by transaction and appropriate locking/version strategy; allow negative only if tenant policy explicitly permits and audit records it.
