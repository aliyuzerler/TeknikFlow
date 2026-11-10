-- CreateEnum
CREATE TYPE "visit_milestone" AS ENUM ('ARRIVED', 'DEPARTED');

-- CreateEnum
CREATE TYPE "gps_source" AS ENUM ('GPS', 'MANUAL');

-- CreateEnum
CREATE TYPE "time_entry_type" AS ENUM ('TRAVEL', 'LABOR', 'WAITING');

-- CreateEnum
CREATE TYPE "time_entry_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "media_kind" AS ENUM ('PHOTO', 'VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "file_status" AS ENUM ('PENDING_UPLOAD', 'READY', 'QUARANTINED', 'FAILED');

-- CreateEnum
CREATE TYPE "signature_role" AS ENUM ('CUSTOMER', 'TECHNICIAN');

-- CreateTable
CREATE TABLE "work_order_visits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "milestone" "visit_milestone" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "source" "gps_source" NOT NULL DEFAULT 'GPS',
    "manualReason" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_checklist_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "detail" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_order_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "time_entry_type" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "note" TEXT,
    "status" "time_entry_status" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_objects" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "kind" "media_kind" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "file_status" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "failureCode" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "file_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_signatures" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "role" "signature_role" NOT NULL,
    "signerName" TEXT NOT NULL,
    "strokesJson" JSONB NOT NULL,
    "note" TEXT,
    "capturedById" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "correctionOfId" TEXT,
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("tenantId","userId","key")
);

-- CreateIndex
CREATE INDEX "work_order_visits_tenantId_workOrderId_recordedAt_idx" ON "work_order_visits"("tenantId", "workOrderId", "recordedAt");

-- CreateIndex
CREATE INDEX "work_order_checklist_items_tenantId_workOrderId_position_idx" ON "work_order_checklist_items"("tenantId", "workOrderId", "position");

-- CreateIndex
CREATE INDEX "time_entries_tenantId_workOrderId_startedAt_idx" ON "time_entries"("tenantId", "workOrderId", "startedAt");

-- CreateIndex
CREATE INDEX "time_entries_tenantId_userId_status_idx" ON "time_entries"("tenantId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "file_objects_objectKey_key" ON "file_objects"("objectKey");

-- CreateIndex
CREATE INDEX "file_objects_tenantId_workOrderId_idx" ON "file_objects"("tenantId", "workOrderId");

-- CreateIndex
CREATE INDEX "file_objects_tenantId_status_idx" ON "file_objects"("tenantId", "status");

-- CreateIndex
CREATE INDEX "work_order_signatures_tenantId_workOrderId_createdAt_idx" ON "work_order_signatures"("tenantId", "workOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");

-- AddForeignKey
ALTER TABLE "work_order_visits" ADD CONSTRAINT "work_order_visits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_visits" ADD CONSTRAINT "work_order_visits_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_visits" ADD CONSTRAINT "work_order_visits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_checklist_items" ADD CONSTRAINT "work_order_checklist_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_checklist_items" ADD CONSTRAINT "work_order_checklist_items_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_checklist_items" ADD CONSTRAINT "work_order_checklist_items_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_signatures" ADD CONSTRAINT "work_order_signatures_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_signatures" ADD CONSTRAINT "work_order_signatures_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_signatures" ADD CONSTRAINT "work_order_signatures_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Faz 08: RLS savunma derinliği — saha yürütme tabloları (ADR-0003 şablonu):
-- work_order_visits, work_order_checklist_items, time_entries, file_objects,
-- work_order_signatures, idempotency_keys. FORCE: uygulama rolü
-- (teknikflow_app) dahil tüm roller politikalara tabi.
-- ---------------------------------------------------------------------------

ALTER TABLE "work_order_visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_visits" FORCE ROW LEVEL SECURITY;
CREATE POLICY "work_order_visits_tenant_isolation" ON "work_order_visits"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "work_order_checklist_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_checklist_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "work_order_checklist_items_tenant_isolation" ON "work_order_checklist_items"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "time_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "time_entries_tenant_isolation" ON "time_entries"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "file_objects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "file_objects" FORCE ROW LEVEL SECURITY;
CREATE POLICY "file_objects_tenant_isolation" ON "file_objects"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "work_order_signatures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_signatures" FORCE ROW LEVEL SECURITY;
CREATE POLICY "work_order_signatures_tenant_isolation" ON "work_order_signatures"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY "idempotency_keys_tenant_isolation" ON "idempotency_keys"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());
