import * as SQLite from 'expo-sqlite';
import type { CacheCollection, CacheDriver } from './driver';

/**
 * Faz 07 — expo-sqlite sürücü (ADR-0004 §1: minimal snapshot).
 *
 * Şema OFFLINE_SYNC.md'deki tablo setinin Faz 07 alt kümesidir:
 * cached_work_order, sync_outbox, sync_cursor, sync_meta.
 * draft_* / pending_attachment tabloları Faz 08 (saha eylemleri) ile gelir.
 */

export const CACHE_SCHEMA_VERSION = 1;

/** DDL — sürücü açılışında koşar; versiyonlu (ilerleyen fazlarda ALTER ile). */
export const CACHE_DDL = [
  `CREATE TABLE IF NOT EXISTS cached_work_order (
     user_id TEXT NOT NULL,
     id TEXT NOT NULL,
     tenant_id TEXT NOT NULL,
     status TEXT NOT NULL,
     scheduled_start TEXT,
     synced_at TEXT NOT NULL,
     payload TEXT NOT NULL,
     PRIMARY KEY (user_id, id)
   )`,
  `CREATE TABLE IF NOT EXISTS sync_outbox (
     id TEXT PRIMARY KEY NOT NULL,
     idempotency_key TEXT NOT NULL UNIQUE,
     tenant_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     entity_id TEXT NOT NULL,
     base_version INTEGER NOT NULL,
     operation TEXT NOT NULL,
     payload TEXT NOT NULL,
     state TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     next_attempt_at TEXT,
     last_error TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sync_cursor (
     id TEXT PRIMARY KEY NOT NULL,
     cursor TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sync_meta (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   )`,
];

/** SQLite'i CacheDriver'a uyduran ince adaptör — mantık burada YOKTUR. */
export function createSqliteCacheDriver(): CacheDriver {
  const db = SQLite.openDatabaseSync('teknikflow-cache.db');
  for (const ddl of CACHE_DDL) db.execSync(ddl);

  function collection<T>(name: string): CacheCollection<T> {
    const table = `cache_kv_${name}`;
    db.execSync(
      `CREATE TABLE IF NOT EXISTS ${table} (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)`,
    );
    return {
      async all() {
        const rows = db.getAllSync(`SELECT v FROM ${table}`) as Array<{ v: string }>;
        return rows.map((row) => JSON.parse(row.v) as T);
      },
      async get(key) {
        const rows = db.getAllSync(`SELECT v FROM ${table} WHERE k = ? LIMIT 1`, key) as Array<{
          v: string;
        }>;
        if (!rows[0]) return null;
        return JSON.parse(rows[0].v) as T;
      },
      async put(key, value) {
        db.runSync(
          `INSERT INTO ${table} (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
          key,
          JSON.stringify(value),
        );
      },
      async delete(key) {
        db.runSync(`DELETE FROM ${table} WHERE k = ?`, key);
      },
      async deleteByPrefix(prefix) {
        db.runSync(`DELETE FROM ${table} WHERE k LIKE ?`, `${prefix}%`);
      },
      async listByPrefix(prefix) {
        const rows = db.getAllSync(
          `SELECT k, v FROM ${table} WHERE k LIKE ? ORDER BY k ASC`,
          `${prefix}%`,
        ) as Array<{ k: string; v: string }>;
        return rows.map((row) => ({ key: row.k, value: JSON.parse(row.v) as T }));
      },
    };
  }

  return {
    collection,
    async clear() {
      db.execSync('DELETE FROM cache_kv_cached_work_order');
      db.execSync('DELETE FROM cache_kv_sync_outbox');
      db.execSync('DELETE FROM cache_kv_sync_cursor');
      db.execSync('DELETE FROM cache_kv_sync_meta');
    },
  };
}
