#!/usr/bin/env node
/**
 * TeknikFlow — düşük ayrıcalıklı uygulama rolü kurulumu (RLS için zorunlu).
 *
 * PostgreSQL'te süper kullanıcılar satır düzeyi güvenliği (FORCE dahil)
 * ATLAR ve bootstrap süper kullanıcısı düşürüLEMEZ. Bu yüzden iki rol:
 *   - teknikflow        : bootstrap sahibi — yalnız MIGRATION/DDL için
 *                         (MIGRATION_DATABASE_URL).
 *   - teknikflow_app    : uygulama çalışma zamanı (DATABASE_URL) —
 *                         NOSUPERUSER, RLS'e TABİ.
 *
 * Idempotent: rol varsa günceller; mevcut tablo yetkileri ve gelecek
 * nesneler (ALTER DEFAULT PRIVILEGES) her koşumda tazelenir.
 *
 * Çağıranlar: infra/native/start-local.mjs (her başlatma),
 *             kök db:migrate / db:migrate:dev betikleri (her migration),
 *             CI (migration sonrası).
 */
import { Client } from 'pg';

const SUPER_URL =
  process.env.MIGRATION_DATABASE_URL ??
  'postgresql://teknikflow:local_dev_only@127.0.0.1:5432/postgres';

const APP_ROLE = process.env.APP_DB_ROLE ?? 'teknikflow_app';
const APP_PASSWORD = process.env.APP_DB_PASSWORD ?? 'local_dev_only';
const OWNER_ROLE = process.env.APP_DB_OWNER ?? 'teknikflow';
const DATABASES = (process.env.APP_DB_DATABASES ?? 'teknikflow,teknikflow_test')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean);

const client = new Client({ connectionString: SUPER_URL });
await client.connect();

// 1) Uygulama rolü (yoksa oluştur; süper kullanıcı ASLA).
const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_ROLE]);
if (existing.rowCount === 0) {
  await client.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}'`);
}
await client.query(
  `ALTER ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS`,
);

for (const database of DATABASES) {
  // 2) Veritabanı bağlantı yetkisi.
  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${APP_ROLE}`);
}

// 3) Her veritabanında: şema + mevcut tablo/dizi yetkileri + gelecek nesneler.
for (const database of DATABASES) {
  const db = new Client({
    connectionString: SUPER_URL.replace(/\/[^/]+$/, `/${database}`),
  });
  await db.connect();
  await db.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await db.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
  await db.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);
  await db.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER_ROLE} IN SCHEMA public
       GRANT ALL ON TABLES TO ${APP_ROLE}`,
  );
  await db.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER_ROLE} IN SCHEMA public
       GRANT ALL ON SEQUENCES TO ${APP_ROLE}`,
  );
  await db.end();
}

await client.end();
console.log(
  `[app-role] '${APP_ROLE}' hazır (NOSUPERUSER) — DATABASE_URL bu rolü kullanmalı; ` +
    `migration'lar '${OWNER_ROLE}' (MIGRATION_DATABASE_URL) ile koşmalı`,
);
