import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  // Faz 03: kimlik korumalı kabuk — global kurulum owner oturumunu hazırlar.
  globalSetup: './e2e/auth.setup.ts',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      // Kimlik akışları: temiz tarayıcı (login/signup/davet kendi oturumunu kurar).
      name: 'chromium-auth',
      testMatch: /auth\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Korunmuş kabuk + durum sayfası: global owner oturumu storageState ile.
      name: 'chromium',
      testIgnore: /auth\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'test-results/.auth/owner-state.json',
      },
    },
  ],
  webServer: {
    // E2E üretim derlemesi üzerinde koşar (dev modunda isteğe bağlı derleme
    // takılmaları testleri kararsız yapar). reuseExistingServer sayesinde
    // ayakta sunucu varsa yeniden derlenmez.
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 300000,
  },
});
