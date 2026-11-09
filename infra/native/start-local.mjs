#!/usr/bin/env node
/**
 * TeknikFlow — Docker'suz yerel altyapı başlatıcı (sandbox / CI / sade makine).
 *
 * Sağladıkları (kök .env.example ile aynı port ve kimlik bilgileri):
 *   PostgreSQL 18  → localhost:5432  (teknikflow / local_dev_only, db: teknikflow + teknikflow_test)
 *   Redis          → localhost:6379
 *   RustFS         → localhost:9000 (S3 API) + :9001 (konsol)
 *                     (S3-uyumlu obje deposu; MinIO OSS Nisan 2026'da arşivlendi)
 *
 * Root/sudo GEREKMEZ. Kalıcı veriler infra/native/.data altındadır.
 * Durdurmak için: node stop-local.mjs
 */

import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get as httpGet } from 'node:http';

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(HERE, '.state');
const DATA_DIR = join(HERE, '.data');
const BIN_DIR = join(HERE, 'bin');

const PG_PORT = 5432;
const PG_USER = 'teknikflow';
const PG_PASSWORD = 'local_dev_only';
const PG_DB = 'teknikflow';
const PG_TEST_DB = 'teknikflow_test';

const REDIS_PORT = 6379;

const S3_PORT = 9000;
const S3_CONSOLE_PORT = 9001;
const S3_ACCESS_KEY = 'local_s3_user';
const S3_SECRET_KEY = 'local_s3_password_change_me';

// RustFS 1.0.4 — Apache-2.0, S3-uyumlu, MinIO drop-in (bkz. ADR-0005).
const RUSTFS_VERSION = '1.0.4';
const RUSTFS_DOWNLOAD_URL =
  process.env.RUSTFS_DOWNLOAD_URL ??
  `https://github.com/rustfs/rustfs/releases/download/${RUSTFS_VERSION}/rustfs-linux-x86_64-gnu-v${RUSTFS_VERSION}.zip`;

const log = (msg) => console.log(`[infra-native] ${msg}`);

async function waitFor(name, fn, { attempts = 40, delayMs = 500 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await fn();
      return true;
    } catch {
      if (attempt === attempts) {
        throw new Error(`${name} hazır olmadı (${attempts} deneme)`);
      }
      await sleep(delayMs);
    }
  }
  return false;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startPostgres() {
  const mod = await import('embedded-postgres');
  const EmbeddedPostgres = mod.default ?? mod;
  const dataDir = join(DATA_DIR, 'pg');
  mkdirSync(dataDir, { recursive: true });

  const pg = new EmbeddedPostgres({
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    databaseDir: dataDir,
    persistent: true,
  });

  const initialised = existsSync(join(dataDir, 'PG_VERSION'));
  if (!initialised) {
    log('PostgreSQL kümesi ilk kez hazırlanıyor (initdb)...');
    await pg.initialise();
  }
  await pg.start();
  log(`PostgreSQL :${PG_PORT} (${initialised ? 'mevcut küme' : 'yeni küme'})`);

  // Uygulama + test veritabanlarını garanti et.
  await pg.createDatabase(PG_DB).catch((error) => {
    if (!String(error.code).includes('42P04')) throw error; // 42P04 = zaten var
  });
  await pg.createDatabase(PG_TEST_DB).catch((error) => {
    if (!String(error.code).includes('42P04')) throw error;
  });
  log(`Veritabanları hazır: ${PG_DB}, ${PG_TEST_DB}`);
  return { kind: 'postgres', stop: () => pg.stop() };
}

async function startRedis() {
  const { RedisMemoryServer } = await import('redis-memory-server');
  const redis = new RedisMemoryServer({
    instance: { port: REDIS_PORT, ip: '127.0.0.1' },
  });
  await redis.start();
  log(`Redis :${REDIS_PORT}`);
  return { kind: 'redis', stop: () => redis.stop() };
}

function httpOk(url) {
  return () =>
    new Promise((resolve, reject) => {
      const request = httpGet(url, (response) => {
        response.resume();
        // 4xx (ör. 403 kimlik doğrulama) sunucunun ayakta olduğu anlamına gelir.
        if (response.statusCode && response.statusCode < 500) {
          resolve();
        } else {
          reject(new Error(`HTTP ${response.statusCode}`));
        }
      });
      request.once('error', reject);
      request.setTimeout(1500, () => {
        request.destroy();
        reject(new Error('timeout'));
      });
    });
}

async function downloadFile(url, destination) {
  log(`RustFS arşivi indiriliyor → ${destination}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`RustFS indirme başarısız: HTTP ${response.status}`);
  }
  const total = Number(response.headers.get('content-length') ?? '0');
  let written = 0;
  const out = createWriteStream(destination);
  // Akışı dosyaya aktar (Node stream API).
  for await (const chunk of response.body) {
    written += chunk.length;
    out.write(Buffer.from(chunk));
  }
  await new Promise((resolve, reject) => {
    out.end(resolve);
    out.once('error', reject);
  });
  if (total > 0 && written !== total) {
    throw new Error(`RustFS indirme eksik: ${written}/${total} bayt`);
  }
}

async function startRustfs() {
  mkdirSync(BIN_DIR, { recursive: true });
  const binPath = join(BIN_DIR, 'rustfs');
  const dataDir = join(DATA_DIR, 'rustfs');
  mkdirSync(dataDir, { recursive: true });

  if (!existsSync(binPath)) {
    const zipPath = join(BIN_DIR, 'rustfs.zip');
    await downloadFile(RUSTFS_DOWNLOAD_URL, zipPath);
    try {
      await execFileAsync('unzip', ['-o', zipPath, 'rustfs', '-d', BIN_DIR]);
    } catch {
      throw new Error(
        "zip açılamadı: sistemde 'unzip' komutu bulunamadı. RustFS'i manuel indirip infra/native/bin/rustfs olarak yerleştirin.",
      );
    }
    const { chmodSync } = await import('node:fs');
    chmodSync(binPath, 0o755);
    rmSync(zipPath);
  }

  const child = spawn(
    binPath,
    [
      'server',
      dataDir,
      '--address',
      `:${S3_PORT}`,
      '--console-enable',
      '--console-address',
      `:${S3_CONSOLE_PORT}`,
    ],
    {
      env: {
        ...process.env,
        RUSTFS_ACCESS_KEY: S3_ACCESS_KEY,
        RUSTFS_SECRET_KEY: S3_SECRET_KEY,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const logStream = createWriteStream(join(STATE_DIR, 'rustfs.log'), { flags: 'a' });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  await waitFor('RustFS', httpOk(`http://127.0.0.1:${S3_PORT}/`), {
    attempts: 60,
    delayMs: 500,
  });
  log(`RustFS :${S3_PORT} (konsol :${S3_CONSOLE_PORT}) — log: .state/rustfs.log`);
  return {
    kind: 'rustfs',
    pid: child.pid,
    stop: () => {
      child.kill('SIGTERM');
      return Promise.resolve();
    },
  };
}

async function main() {
  mkdirSync(STATE_DIR, { recursive: true });
  const stateFile = join(STATE_DIR, 'running.json');
  if (existsSync(stateFile)) {
    rmSync(stateFile);
  }

  const services = [];

  try {
    const pg = await startPostgres();
    services.push(pg);
    const redis = await startRedis();
    services.push(redis);
    const rustfs = await startRustfs();
    services.push(rustfs);

    // Son doğrulama: veritabanı gerçekten sorgu yanıtlıyor mu?
    await waitFor('PostgreSQL ping', async () => {
      const { Client } = await import('pg');
      const client = new Client({
        host: '127.0.0.1',
        port: PG_PORT,
        user: PG_USER,
        password: PG_PASSWORD,
        database: PG_DB,
        connectionTimeoutMillis: 1500,
      });
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
    });

    writeState(stateFile, {
      startedAt: new Date().toISOString(),
      rustfsPid: rustfs.pid,
    });

    log('Tüm altyapı hazır:');
    log(`  PostgreSQL : ${PG_PORT} (db: ${PG_DB}, ${PG_TEST_DB})`);
    log(`  Redis      : ${REDIS_PORT}`);
    log(`  RustFS     : ${S3_PORT} / konsol ${S3_CONSOLE_PORT} (${S3_ACCESS_KEY})`);
    log('Sonraki adımlar: pnpm db:migrate && pnpm db:seed && pnpm dev');
    log('Durdurmak için: pnpm infra:native:stop');

    // RustFS sürecini ayakta tutmak için bu süreç açık kalsın.
    await new Promise((resolve) => {
      process.on('SIGINT', resolve);
      process.on('SIGTERM', resolve);
    });
    await stopAll(services);
    process.exit(0);
  } catch (error) {
    console.error(`[infra-native] HATA: ${error instanceof Error ? error.message : error}`);
    await stopAll(services);
    process.exit(1);
  }
}

function writeState(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

async function stopAll(services) {
  for (const service of services.reverse()) {
    try {
      await service.stop();
      log(`${service.kind} durduruldu`);
    } catch (error) {
      console.error(`[infra-native] ${service.kind} durdurulamadı:`, error);
    }
  }
}

main().catch((error) => {
  console.error(`[infra-native] Beklenmeyen hata: ${error}`);
  process.exit(1);
});
