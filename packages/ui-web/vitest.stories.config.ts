import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';

// Storybook etkileşim testleri — 'test' etiketli hikâyeler vitest ile koşar.
// Kalan hikâyeler `storybook build` + ekran görüntüsü doğrulamasıyla kapsanır.
export default defineConfig({
  plugins: [
    storybookTest({
      configDir: '.storybook',
      tags: { include: ['test'] },
    }),
  ],
  test: {
    environment: 'jsdom',
  },
});
