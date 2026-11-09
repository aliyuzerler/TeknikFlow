/**
 * Faz 03 — RBAC izin kataloğu ve sistem rol matrisi.
 *
 * Tek gerçeklik: docs/ROLES_PERMISSIONS.md'deki kapasite haritasının makine
 * okunur hali. Katalog sunucuda tanımlıdır; kiracılar yalnız buradaki
 * anahtarlardan seçim yaparak özel rol üretebilir (katalog dışı izin reddi).
 *
 * "Assigned only" nüansı (iş emri tamamlama/imza) kaynak düzeyi denetimidir
 * ve ilgili kaynak fazlarında (05/08) ayrıca doğrulanır; buradaki izin
 * yalnız kapasiteyi verir, atama doğrulamasını içermez.
 */

export interface PermissionDefinition {
  key: string;
  description: string;
  category: string;
}

export const PERMISSION_CATALOGUE: readonly PermissionDefinition[] = [
  // Kiracı ve yönetim
  {
    key: 'tenant:manage',
    description: 'Kiracı ayarlarını ve faturalamayı tam yönetir',
    category: 'tenant',
  },
  {
    key: 'tenant:manage_limited',
    description: 'Kiracı ayarlarını faturalama hariç yönetir',
    category: 'tenant',
  },
  { key: 'billing:view', description: 'Faturalama bilgilerini görüntüler', category: 'tenant' },
  { key: 'users:manage', description: 'Kullanıcı, davet ve rol yönetimi', category: 'identity' },
  { key: 'branches:manage', description: 'Şube yönetimi', category: 'identity' },
  { key: 'roles:manage', description: 'Katalogdan özel rol tanımlama', category: 'identity' },
  { key: 'audit:view', description: 'Audit kayıtlarını görüntüler', category: 'identity' },

  // CRM (Faz 04)
  { key: 'customers:view_all', description: 'Tüm müşteri/varlık kayıtları', category: 'crm' },
  {
    key: 'customers:view_assigned',
    description: 'Yalnız atanmış müşteri/varlık kayıtları',
    category: 'crm',
  },
  {
    key: 'customers:view_limited',
    description: 'Sınırlı müşteri/varlık görüntüleme (depo)',
    category: 'crm',
  },
  {
    key: 'customers:manage',
    description:
      'Müşteri, kişi ve servis lokasyonu kayıtlarını oluşturur/günceller/arşivler (Faz 04)',
    category: 'crm',
  },
  {
    key: 'assets:manage',
    description: 'Ekipman/varlık kayıtlarını ve dokümanlarını yönetir (Faz 04)',
    category: 'crm',
  },

  // Servis akışı
  { key: 'service_requests:create', description: 'Servis talebi oluşturur', category: 'service' },
  { key: 'work_orders:view_all', description: 'Tüm iş emirlerini görüntüler', category: 'service' },
  {
    key: 'work_orders:view_assigned',
    description: 'Yalnız atanmış iş emirlerini görüntüler',
    category: 'service',
  },
  { key: 'work_orders:create', description: 'İş emri oluşturur', category: 'service' },
  { key: 'work_orders:dispatch', description: 'İş emri atama ve sevk', category: 'service' },
  {
    key: 'work_orders:dispatch_override',
    description: 'Çakışma üzerine bilinçli planlama (neden zorunlu, denetlenir) (Faz 06)',
    category: 'service',
  },
  { key: 'work_orders:complete', description: 'İş emri tamamlama/checklist', category: 'service' },
  { key: 'signature:capture', description: 'Müşteri imzası toplar', category: 'service' },

  // Stok (Faz 09)
  { key: 'stock:view', description: 'Stok görüntüleme', category: 'inventory' },
  { key: 'stock:manage', description: 'Stok hareketlerini tam yönetir', category: 'inventory' },
  {
    key: 'stock:manage_limited',
    description: 'Sınırlı stok hareketi yönetimi (dispatch)',
    category: 'inventory',
  },
  {
    key: 'stock:issue_own',
    description: 'Yalnız kendi aracına çıkış/yoklama',
    category: 'inventory',
  },

  // Ticari (Faz 11)
  {
    key: 'quotes:manage',
    description: 'Teklif ve masrafların tam yönetimi',
    category: 'commercial',
  },
  {
    key: 'quotes:manage_limited',
    description: 'Sınırlı teklif yönetimi (dispatch)',
    category: 'commercial',
  },
  {
    key: 'expenses:submit_own',
    description: 'Kendi masrafını gönderir',
    category: 'commercial',
  },
  {
    key: 'financial_reports:view',
    description: 'Finansal raporları görüntüler',
    category: 'commercial',
  },
  {
    key: 'financial_reports:view_limited',
    description: 'Sınırlı finansal rapor (servis yöneticisi)',
    category: 'commercial',
  },
  {
    key: 'financial_reports:view_own',
    description: 'Yalnız kendi işlerinin finansal görünümü',
    category: 'commercial',
  },
] as const;

const CATALOGUE_KEYS = new Set(PERMISSION_CATALOGUE.map((p) => p.key));

/** İzin anahtarı katalogda tanımlı mı? */
export function isKnownPermission(key: string): boolean {
  return CATALOGUE_KEYS.has(key);
}

export interface SystemRoleDefinition {
  key: string;
  name: string;
  description: string;
  permissions: readonly string[];
}

/**
 * Sistem rol matrisi — docs/ROLES_PERMISSIONS.md satırlarıyla birebir.
 * "Customer portal" rolü kiracı üyeliği DEĞİLDİR (portal kimlikleri Faz 12);
 * burada yer almaz.
 */
export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: 'owner',
    name: 'Firma Sahibi',
    description: 'Kiracı ve faturalama dahil tam yönetim',
    permissions: [
      'tenant:manage',
      'tenant:manage_limited',
      'billing:view',
      'users:manage',
      'branches:manage',
      'roles:manage',
      'audit:view',
      'customers:view_all',
      'customers:manage',
      'assets:manage',
      'service_requests:create',
      'work_orders:view_all',
      'work_orders:create',
      'work_orders:dispatch',
      'work_orders:dispatch_override',
      'work_orders:complete',
      'signature:capture',
      'stock:view',
      'stock:manage',
      'quotes:manage',
      'financial_reports:view',
    ],
  },
  {
    key: 'admin',
    name: 'Yönetici',
    description: 'Faturalama hariç tam yönetim (fatura görüntülemez)',
    permissions: [
      'tenant:manage_limited',
      'users:manage',
      'branches:manage',
      'roles:manage',
      'audit:view',
      'customers:view_all',
      'customers:manage',
      'assets:manage',
      'service_requests:create',
      'work_orders:view_all',
      'work_orders:create',
      'work_orders:dispatch',
      'work_orders:dispatch_override',
      'work_orders:complete',
      'signature:capture',
      'stock:view',
      'stock:manage',
      'quotes:manage',
      'financial_reports:view',
    ],
  },
  {
    key: 'dispatcher',
    name: 'Planlamacı',
    description: 'Servis akışı ve sınırlı stok/teklif yetkisi',
    permissions: [
      'customers:view_all',
      'customers:manage',
      'assets:manage',
      'service_requests:create',
      'work_orders:view_all',
      'work_orders:create',
      'work_orders:dispatch',
      'stock:view',
      'stock:manage_limited',
      'quotes:manage_limited',
    ],
  },
  {
    key: 'service-manager',
    name: 'Servis Yöneticisi',
    description: 'Operasyonel yönetim ve tamamlama onayı',
    permissions: [
      'customers:view_all',
      'customers:manage',
      'assets:manage',
      'service_requests:create',
      'work_orders:view_all',
      'work_orders:create',
      'work_orders:dispatch',
      'work_orders:dispatch_override',
      'work_orders:complete',
      'signature:capture',
      'stock:view',
      'stock:manage',
      'quotes:manage',
      'financial_reports:view_limited',
    ],
  },
  {
    key: 'technician',
    name: 'Teknisyen',
    description: 'Saha yürütme — yalnız atanmış işler',
    permissions: [
      'customers:view_assigned',
      'work_orders:view_assigned',
      'work_orders:complete',
      'signature:capture',
      'stock:view',
      'stock:issue_own',
      'expenses:submit_own',
      'financial_reports:view_own',
    ],
  },
  {
    key: 'warehouse',
    name: 'Depo Görevlisi',
    description: 'Stok operasyonu ve sınırlı müşteri görünümü',
    permissions: ['customers:view_limited', 'stock:view', 'stock:manage'],
  },
  {
    key: 'finance',
    name: 'Finans',
    description: 'Faturalama ve finansal raporlar',
    permissions: [
      'billing:view',
      'customers:view_all',
      'work_orders:view_all',
      'quotes:manage',
      'financial_reports:view',
    ],
  },
] as const;

/** Sistem rol anahtarları kümesi. */
export const SYSTEM_ROLE_KEYS = new Set(SYSTEM_ROLES.map((r) => r.key));

/** Bir sistem rolünün izin kümesi (kopya döner). */
export function systemRolePermissions(roleKey: string): Set<string> {
  const role = SYSTEM_ROLES.find((r) => r.key === roleKey);
  return new Set(role?.permissions ?? []);
}

/** Matris bütünlük denetimi: her rol izni katalogda tanımlı olmalı. */
export function validateMatrixIntegrity(): string[] {
  const problems: string[] = [];
  for (const role of SYSTEM_ROLES) {
    for (const permission of role.permissions) {
      if (!CATALOGUE_KEYS.has(permission)) {
        problems.push(`${role.key} → bilinmeyen izin: ${permission}`);
      }
    }
  }
  // Katalogda hiçbir sistem role'üne bağlı olmayan izin "ölü" olur — uyar.
  const used = new Set(SYSTEM_ROLES.flatMap((r) => [...r.permissions]));
  for (const permission of PERMISSION_CATALOGUE) {
    if (!used.has(permission.key)) {
      problems.push(`katalogda kullanılmayan izin: ${permission.key}`);
    }
  }
  return problems;
}
