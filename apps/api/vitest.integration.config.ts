import { defineConfig } from 'vitest/config';

// Entegrasyon testleri gerçek yerel altyapıya (PostgreSQL, Redis, RustFS) bağlanır.
// Altyapı yoksa testler dürüstçe BAŞARISIZ olur (uydurma sonuç yok).
// Bilinçli atlamak için: RUN_INTEGRATION=false pnpm test:integration
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
