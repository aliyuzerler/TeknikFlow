#!/usr/bin/env node
/**
 * Docker'suz yerel altyapıyı durdurur.
 * - state dosyasındaki RustFS PID'sini sonlandırır
 * - embedded-postgres kümesi ve redis-memory-server kapanır
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(HERE, '.state', 'running.json');

const log = (msg) => console.log(`[infra-native:stop] ${msg}`);

function killPid(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!existsSync(STATE_FILE)) {
    log('Çalışan kayıt yok; .state/running.json bulunamadı.');
    return;
  }

  const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  if (typeof state.rustfsPid === 'number') {
    const killed = killPid(state.rustfsPid);
    log(
      killed
        ? `RustFS (pid ${state.rustfsPid}) durduruldu`
        : `RustFS pid ${state.rustfsPid} zaten yok`,
    );
  }

  rmSync(STATE_FILE);
  log('Tamam. (PostgreSQL/Redis, başlatan sürecin SIGTERM temizliğiyle kapanır.)');
}

main().catch((error) => {
  console.error(`[infra-native:stop] HATA: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
