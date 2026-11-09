-- CreateEnum
CREATE TYPE "service_priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "request_source" AS ENUM ('PORTAL', 'OFFICE', 'EMAIL', 'API');

-- CreateEnum
CREATE TYPE "request_status" AS ENUM ('NEW', 'IN_REVIEW', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "work_order_status" AS ENUM ('DRAFT', 'PLANNED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'WAITING_PARTS', 'WAITING_CUSTOMER', 'COMPLETED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "work_order_type" AS ENUM ('CORRECTIVE', 'PREVENTIVE', 'INSTALLATION', 'INSPECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "cancellation_reason" AS ENUM ('CUSTOMER_REQUEST', 'DUPLICATE', 'OUT_OF_SCOPE', 'PARTS_UNAVAILABLE', 'SCHEDULE_CONFLICT', 'OTHER');

-- CreateEnum
CREATE TYPE "assignment_status" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "note_visibility" AS ENUM ('INTERNAL', 'CUSTOMER');

-- CreateTable
CREATE TABLE "service_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "priority" "service_priority" NOT NULL,
    "resolveMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "assetId" TEXT,
    "serviceLocationId" TEXT,
    "categoryId" TEXT,
    "source" "request_source" NOT NULL DEFAULT 'OFFICE',
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "priority" "service_priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "request_status" NOT NULL DEFAULT 'NEW',
    "slaDueAt" TIMESTAMP(3),
    "cancellationReason" "cancellation_reason",
    "cancellationNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderNo" TEXT NOT NULL,
    "requestId" TEXT,
    "customerId" TEXT NOT NULL,
    "assetId" TEXT,
    "serviceLocationId" TEXT,
    "branchId" TEXT,
    "type" "work_order_type" NOT NULL DEFAULT 'CORRECTIVE',
    "priority" "service_priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "work_order_status" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "scheduledStart" TIMESTAMP(3),
    "scheduledEnd" TIMESTAMP(3),
    "assignedToId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" "cancellation_reason",
    "cancellationNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_assignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT,
    "status" "assignment_status" NOT NULL DEFAULT 'ACTIVE',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "work_order_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromState" "work_order_status",
    "toState" "work_order_status",
    "actorId" TEXT,
    "metadataJson" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_notes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "visibility" "note_visibility" NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_counters" (
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "work_order_counters_pkey" PRIMARY KEY ("tenantId","year")
);

-- CreateIndex
CREATE INDEX "service_categories_tenantId_idx" ON "service_categories"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_tenantId_key_key" ON "service_categories"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "sla_policies_tenantId_priority_key" ON "sla_policies"("tenantId", "priority");

-- CreateIndex
CREATE INDEX "service_requests_tenantId_status_createdAt_idx" ON "service_requests"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "service_requests_tenantId_priority_createdAt_idx" ON "service_requests"("tenantId", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "service_requests_tenantId_customerId_createdAt_idx" ON "service_requests"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_requestId_key" ON "work_orders"("requestId");

-- CreateIndex
CREATE INDEX "work_orders_tenantId_status_createdAt_idx" ON "work_orders"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "work_orders_tenantId_assignedToId_scheduledStart_idx" ON "work_orders"("tenantId", "assignedToId", "scheduledStart");

-- CreateIndex
CREATE INDEX "work_orders_tenantId_customerId_createdAt_idx" ON "work_orders"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_tenantId_workOrderNo_key" ON "work_orders"("tenantId", "workOrderNo");

-- CreateIndex
CREATE INDEX "work_order_assignments_tenantId_workOrderId_idx" ON "work_order_assignments"("tenantId", "workOrderId");

-- CreateIndex
CREATE INDEX "work_order_assignments_tenantId_userId_status_idx" ON "work_order_assignments"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "work_order_events_tenantId_workOrderId_occurredAt_idx" ON "work_order_events"("tenantId", "workOrderId", "occurredAt");

-- CreateIndex
CREATE INDEX "work_order_notes_tenantId_workOrderId_createdAt_idx" ON "work_order_notes"("tenantId", "workOrderId", "createdAt");

-- AddForeignKey
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_serviceLocationId_fkey" FOREIGN KEY ("serviceLocationId") REFERENCES "service_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "service_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_serviceLocationId_fkey" FOREIGN KEY ("serviceLocationId") REFERENCES "service_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_notes" ADD CONSTRAINT "work_order_notes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_notes" ADD CONSTRAINT "work_order_notes_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_notes" ADD CONSTRAINT "work_order_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_counters" ADD CONSTRAINT "work_order_counters_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Faz 05: RLS savunma derinliği — servis akışı tabloları (ADR-0003 şablonu).
-- service_categories, sla_policies, service_requests, work_orders,
-- work_order_assignments, work_order_events, work_order_notes,
-- work_order_counters. FORCE: uygulama rolü (teknikflow_app) dahil tüm
-- roller politikalara tabi.
-- ---------------------------------------------------------------------------

ALTER TABLE "service_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY "service_categories_tenant_isolation" ON "service_categories"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "sla_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sla_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "sla_policies_tenant_isolation" ON "sla_policies"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "service_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "service_requests_tenant_isolation" ON "service_requests"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "work_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY "work_orders_tenant_isolation" ON "work_orders"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "work_order_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "work_order_assignments_tenant_isolation" ON "work_order_assignments"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "work_order_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "work_order_events_tenant_isolation" ON "work_order_events"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "work_order_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "work_order_notes_tenant_isolation" ON "work_order_notes"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "work_order_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_counters" FORCE ROW LEVEL SECURITY;
CREATE POLICY "work_order_counters_tenant_isolation" ON "work_order_counters"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());
