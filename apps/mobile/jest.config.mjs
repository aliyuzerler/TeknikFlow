export default {
  preset: 'jest-expo',
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.ts', '**/src/**/*.test.tsx'],
  setupFiles: ['./jest.setup.ts'],
  // pnpm kök yapısı: bağımlılıklar .pnpm altına çözülür (RN 0.88 setup.js ESM).
  // Tüm node_modules transform edilir — mobil grafik küçük, maliyet önemsiz.
  transformIgnorePatterns: [],
  clearMocks: true,
};
