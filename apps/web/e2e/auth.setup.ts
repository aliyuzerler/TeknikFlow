import { request } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Faz 03 E2E global kurulumu — demo owner oturumu.
 *
 * Login uçlarında rate limit (kasıtlı güvenlik) olduğundan her testin kendi
 * başına login olması kovayı doldurur. Global setup BİR kez API login yapar,
 * çerezleri storageState olarak diske yazar; worker'lar bunu yükler.
 * Web kimlik çerezleri API kökenlidir (localhost) — portlar farklı olsa da
 * tarayıcı çerezi host'a (localhost) yazar; storageState bunu taşır.
 */
const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';
const STATE_FILE = 'test-results/.auth/owner-state.json';

async function globalSetup(): Promise<void> {
  const api = await request.newContext({ baseURL: API_BASE });
  const response = await api.post('/api/v1/auth/login', {
    data: {
      email: 'owner@atlas.example.test',
      password: 'Atlas!2026',
      client: 'web',
    },
  });
  if (response.status() !== 200) {
    throw new Error(`owner login başarısız: HTTP ${response.status()}`);
  }
  const cookies = await api.cookies('http://localhost:4000');
  await api.dispose();

  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify({ cookies, origins: [] }, null, 2), 'utf8');
  process.stdout.write(`[auth-setup] owner oturumu kaydedildi (${cookies.length} çerez)\n`);
}

export default globalSetup;
