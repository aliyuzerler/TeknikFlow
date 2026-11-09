-- CreateTable
CREATE TABLE "service_category_skills" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_category_skills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_category_skills_tenantId_categoryId_idx" ON "service_category_skills"("tenantId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "service_category_skills_tenantId_categoryId_skillId_key" ON "service_category_skills"("tenantId", "categoryId", "skillId");

-- AddForeignKey
ALTER TABLE "service_category_skills" ADD CONSTRAINT "service_category_skills_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_category_skills" ADD CONSTRAINT "service_category_skills_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_category_skills" ADD CONSTRAINT "service_category_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Faz 06: RLS savunma derinliği — kategori yetenek eşlemesi (ADR-0003 şablonu).

ALTER TABLE "service_category_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_category_skills" FORCE ROW LEVEL SECURITY;
CREATE POLICY "service_category_skills_tenant_isolation" ON "service_category_skills"
  FOR ALL
  USING ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"())
  WITH CHECK ("tenantId" = "app_current_tenant_id"() OR "app_is_platform_admin"());
