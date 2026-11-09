import { describe, expect, it } from 'vitest';
import {
  PERMISSION_CATALOGUE,
  SYSTEM_ROLES,
  isKnownPermission,
  systemRolePermissions,
  validateMatrixIntegrity,
} from './rbac-matrix.js';

/**
 * docs/ROLES_PERMISSIONS.md matris bütünlüğü — katalog ve roller arasındaki
 * ilişki her zaman tutarlı olmalı (yeni izin kataloğa eklenmeden rol
 * tanımlanamaz, matris dışı izin kullanılamaz).
 */
describe('RBAC matrisi', () => {
  it('matris bütünlük denetimi temiz (katalog↔roller kapalı)', () => {
    expect(validateMatrixIntegrity()).toEqual([]);
  });

  it('yedi sistem rolü tanımlı', () => {
    expect(SYSTEM_ROLES.map((r) => r.key)).toEqual([
      'owner',
      'admin',
      'dispatcher',
      'service-manager',
      'technician',
      'warehouse',
      'finance',
    ]);
  });

  it('katalog anahtarları benzersiz', () => {
    const keys = PERMISSION_CATALOGUE.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Belirgin rol/izin eşleşmeleri (docs/ROLES_PERMISSIONS.md satırları):
  it('owner: tenant:manage + users:manage taşır', () => {
    const owner = systemRolePermissions('owner');
    expect(owner.has('tenant:manage')).toBe(true);
    expect(owner.has('users:manage')).toBe(true);
    expect(owner.has('billing:view')).toBe(true);
  });

  it('admin: tenant:manage (tam) YOK; faturalama görüntüleme YOK', () => {
    const admin = systemRolePermissions('admin');
    expect(admin.has('tenant:manage')).toBe(false);
    expect(admin.has('tenant:manage_limited')).toBe(true);
    expect(admin.has('billing:view')).toBe(false);
    expect(admin.has('users:manage')).toBe(true);
  });

  it('technician: users:manage/branches:manage YOK; atanan işler var', () => {
    const technician = systemRolePermissions('technician');
    expect(technician.has('users:manage')).toBe(false);
    expect(technician.has('branches:manage')).toBe(false);
    expect(technician.has('work_orders:view_assigned')).toBe(true);
    expect(technician.has('work_orders:view_all')).toBe(false);
    expect(technician.has('signature:capture')).toBe(true);
  });

  it('dispatcher: sevk yetkisi var, kullanıcı yönetimi yok', () => {
    const dispatcher = systemRolePermissions('dispatcher');
    expect(dispatcher.has('work_orders:dispatch')).toBe(true);
    expect(dispatcher.has('users:manage')).toBe(false);
    expect(dispatcher.has('stock:manage_limited')).toBe(true);
  });

  it('warehouse: stok tam yetki, müşteri görünümü sınırlı', () => {
    const warehouse = systemRolePermissions('warehouse');
    expect(warehouse.has('stock:manage')).toBe(true);
    expect(warehouse.has('customers:view_limited')).toBe(true);
    expect(warehouse.has('customers:view_all')).toBe(false);
  });

  it('finance: faturalama görüntüler, kullanıcı yönetimi yok', () => {
    const finance = systemRolePermissions('finance');
    expect(finance.has('billing:view')).toBe(true);
    expect(finance.has('financial_reports:view')).toBe(true);
    expect(finance.has('users:manage')).toBe(false);
  });

  it('bilinmeyen izin anahtarı tanınmaz', () => {
    expect(isKnownPermission('super:powers')).toBe(false);
    expect(isKnownPermission('users:manage')).toBe(true);
  });

  it('hiçbir kiracı rolü platform desteği yetkisi taşımaz', () => {
    // ROLES_PERMISSIONS.md: "Platform support access" tüm kiracı rollerinde No.
    for (const role of SYSTEM_ROLES) {
      expect(
        role.permissions.some((p) => p.startsWith('platform:')),
        `${role.key} platform yetkisi taşınamaz`,
      ).toBe(false);
    }
  });
});
