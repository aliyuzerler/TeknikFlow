-- CreateEnum
CREATE TYPE "time_off_status" AS ENUM ('ACTIVE', 'CANCELLED');

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "scheduleOverrideReason" TEXT,
ADD COLUMN     "slaDueAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "technician_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territory" TEXT,
    "dailyCapacityMinutes" INTEGER NOT NULL DEFAULT 480,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technician_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_hours" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_offs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "status" "time_off_status" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_offs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_skills" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamLead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "technician_profiles_tenantId_idx" ON "technician_profiles"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "technician_profiles_tenantId_userId_key" ON "technician_profiles"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "working_hours_tenantId_profileId_idx" ON "working_hours"("tenantId", "profileId");

-- CreateIndex
CREATE INDEX "time_offs_tenantId_profileId_startAt_idx" ON "time_offs"("tenantId", "profileId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "skills_tenantId_key_key" ON "skills"("tenantId", "key");

-- CreateIndex
CREATE INDEX "user_skills_tenantId_userId_idx" ON "user_skills"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_skills_tenantId_userId_skillId_key" ON "user_skills"("tenantId", "userId", "skillId");

-- CreateIndex
CREATE INDEX "teams_tenantId_idx" ON "teams"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "teams_tenantId_code_key" ON "teams"("tenantId", "code");

-- CreateIndex
CREATE INDEX "team_members_tenantId_teamId_idx" ON "team_members"("tenantId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_tenantId_userId_key" ON "team_members"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "technician_profiles" ADD CONSTRAINT "technician_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_profiles" ADD CONSTRAINT "technician_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "technician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_offs" ADD CONSTRAINT "time_offs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_offs" ADD CONSTRAINT "time_offs_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "technician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Faz 06: SLA geriye dönük doldurma (varsa)
--   1) Talepten dönüşen iş emirleri talebin slaDueAt değerini DEVRALIR
--      (müşteri sözü dönüşümle sıfırlanmaz).
--   2) Doğrudan açılmış iş emirleri: öncelik varsayılan SLA'sıyla
--      createdAt'tan hesaplanır (URGENT 4s / HIGH 8s / MEDIUM 24s / LOW 72s).
-- ---------------------------------------------------------------------------

UPDATE "work_orders" AS wo
SET "slaDueAt" = sr."slaDueAt"
FROM "service_requests" AS sr
WHERE wo."requestId" = sr."id"
  AND sr."slaDueAt" IS NOT NULL;

UPDATE "work_orders"
SET "slaDueAt" = "createdAt" + (CASE "priority"
    WHEN 'URGENT'  THEN interval '240 minutes'
    WHEN 'HIGH'    THEN interval '480 minutes'
    WHEN 'MEDIUM'  THEN interval '1440 minutes'
    WHEN 'LOW'     THEN interval '4320 minutes'
  END)
WHERE "slaDueAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Faz 06: RLS savunma derinliği — dispatch tabloları (ADR-0003 şablonu):
-- technician_profiles, working_hours, time_offs, skills, user_skills,
-- teams, team_members. FORCE: uygulama rolü (teknikflow_app) dahil tüm
-- roller politikalara tabi.
-- ---------------------------------------------------------------------------

ALTER TABLE "technician_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "technician_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "technician_profiles_tenant_isolation" ON "technician_profiles"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "working_hours" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "working_hours" FORCE ROW LEVEL SECURITY;
CREATE POLICY "working_hours_tenant_isolation" ON "working_hours"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "time_offs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "time_offs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "time_offs_tenant_isolation" ON "time_offs"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skills" FORCE ROW LEVEL SECURITY;
CREATE POLICY "skills_tenant_isolation" ON "skills"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "user_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_skills" FORCE ROW LEVEL SECURITY;
CREATE POLICY "user_skills_tenant_isolation" ON "user_skills"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;
CREATE POLICY "teams_tenant_isolation" ON "teams"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());

ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY "team_members_tenant_isolation" ON "team_members"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());
