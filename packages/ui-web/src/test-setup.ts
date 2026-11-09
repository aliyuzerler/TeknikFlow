import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals kapalıyken Testing Library otomatik temizliği yapmaz —
// her testten sonra DOM'u temizle (çoğaltılmış öğe hatalarını önler).
afterEach(() => {
  cleanup();
});
