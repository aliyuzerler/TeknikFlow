-- CreateEnum
CREATE TYPE "visit_type" AS ENUM ('CHECK_IN', 'CHECK_OUT');

-- CreateEnum
CREATE TYPE "gps_source" AS ENUM ('GPS', 'MANUAL');

-- CreateEnum
CREATE TYPE "checklist_response_type" AS ENUM ('BOOLEAN', 'NUMBER', 'TEXT', 'SINGLE_SELECT', 'MULTI_SELECT');

-- CreateEnum
CREATE TYPE "attachment_kind" AS ENUM ('PHOTO', 'VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "file_object_state" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'READY', 'REJECTED');

-- CreateEnum
CREATE TYPE "signatory_role" AS ENUM ('CUSTOMER', 'TECHNICIAN');

-- CreateTable
CREATE TABLE "work_order_visits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "visitType" "visit_type" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "source" "gps_source" NOT NULL,
    "manualReason" TEXT,
    "capturedAt" TIMESTAMP(3),
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_checklist_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "responseType" "checklist_response_type" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "optionsJson" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "responseValue" JSONB,
    "respondedAt" TIMESTAMP(3),
    "respondedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_order_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_time_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_objects" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "kind" "attachment_kind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "caption" TEXT,
    "state" "file_object_state" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "checksumSha256" TEXT,
    "rejectionReason" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "file_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_attachments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "fileObjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_signatures" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "signedBy" "signatory_role" NOT NULL,
    "signerName" TEXT NOT NULL,
    "strokesJson" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "correctionOfId" TEXT,
    "capturedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseJson" JSONB NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_order_visits_tenantId_workOrderId_recordedAt_idx" ON "work_order_visits"("tenantId", "workOrderId", "recordedAt");

-- CreateIndex
CREATE INDEX "work_order_checklist_items_tenantId_workOrderId_sortOrder_idx" ON "work_order_checklist_items"("tenantId", "workOrderId", "sortOrder");

-- CreateIndex
CREATE INDEX "work_order_time_entries_tenantId_workOrderId_startedAt_idx" ON "work_order_time_entries"("tenantId", "workOrderId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "file_objects_objectKey_key" ON "file_objects"("objectKey");

-- CreateIndex
CREATE INDEX "file_objects_tenantId_createdAt_idx" ON "file_objects"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "work_order_attachments_tenantId_workOrderId_idx" ON "work_order_attachments"("tenantId", "workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_attachments_tenantId_workOrderId_fileObjectId_key" ON "work_order_attachments"("tenantId", "workOrderId", "fileObjectId");

-- CreateIndex
CREATE INDEX "work_order_signatures_tenantId_workOrderId_createdAt_idx" ON "work_order_signatures"("tenantId", "workOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "idempotency_keys_tenantId_createdAt_idx" ON "idempotency_keys"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_tenantId_userId_scope_key_key" ON "idempotency_keys"("tenantId", "userId", "scope", "key");

-- AddForeignKey
ALTER TABLE "work_order_visits" ADD CONSTRAINT "work_order_visits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_visits" ADD CONSTRAINT "work_order_visits_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_visits" ADD CONSTRAINT "work_order_visits_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_checklist_items" ADD CONSTRAINT "work_order_checklist_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_checklist_items" ADD CONSTRAINT "work_order_checklist_items_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_checklist_items" ADD CONSTRAINT "work_order_checklist_items_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_time_entries" ADD CONSTRAINT "work_order_time_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_time_entries" ADD CONSTRAINT "work_order_time_entries_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_time_entries" ADD CONSTRAINT "work_order_time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_attachments" ADD CONSTRAINT "work_order_attachments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_attachments" ADD CONSTRAINT "work_order_attachments_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_attachments" ADD CONSTRAINT "work_order_attachments_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_signatures" ADD CONSTRAINT "work_order_signatures_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_signatures" ADD CONSTRAINT "work_order_signatures_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_signatures" ADD CONSTRAINT "work_order_signatures_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "work_order_signatures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_signatures" ADD CONSTRAINT "work_order_signatures_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Faz 08 — RLS FORCE: kiracı izolasyonu (ADR-0003; faz 05/06 deseniyle birebir).
-- Süper kullanıcı atlaması KAPALI — uygulama rolü de politikalara tabi.
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

ALTER TABLE "work_order_time_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_time_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "work_order_time_entries_tenant_isolation" ON "work_order_time_entries"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "file_objects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "file_objects" FORCE ROW LEVEL SECURITY;
CREATE POLICY "file_objects_tenant_isolation" ON "file_objects"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "work_order_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "work_order_attachments_tenant_isolation" ON "work_order_attachments"
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
