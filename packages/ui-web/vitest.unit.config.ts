import { defineConfig } from 'vitest/config';

// Bileşen birim testleri — jsdom + Testing Library.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
