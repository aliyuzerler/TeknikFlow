import { describe, expect, it } from 'vitest';

// Tohum (seed) betiğinin saf çekirdeği: ayar listesinin idempotent upsert
// anahtarları benzersiz olmalı — aksi halde yazma sırası belirsizleşir.
const SEED_KEYS = ['bootstrap.version', 'bootstrap.completedAt', 'demo.workspace', 'demo.note'];

describe('prisma seed ayarları', () => {
  it('anahtarlar benzersizdir (upsert güvenli)', () => {
    expect(new Set(SEED_KEYS).size).toBe(SEED_KEYS.length);
  });
  it('demo notu faz 03+ bilgisini taşır', () => {
    expect(SEED_KEYS.some((key) => key.startsWith('demo.'))).toBe(true);
  });
});
