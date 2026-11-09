import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateTokensTs } from '../scripts/generate-tokens.mjs';

const HERE = __dirname;

/**
 * Değişmez: tokens.css (tek kaynak) ile üretilmiş src/tokens.ts her zaman
 * eşleşmelidir. tokens.css değiştiğinde `pnpm --filter @teknikflow/design-tokens
 * generate` çalıştırılmadan commit edildiğinde bu test KIRMIZI olur —
 * böylece JS/RN tarafında bayat token değeri kullanılamaz.
 */
describe('design-tokens senkronizasyonu', () => {
  it('src/tokens.ts, tokens.css’ten üretilebilen içerikle birebir eşleşir', async () => {
    const css = readFileSync(join(HERE, '../tokens.css'), 'utf8');
    const committed = readFileSync(join(HERE, 'tokens.ts'), 'utf8');
    const generated = await generateTokensTs(css);
    expect(committed).toBe(generated);
  });

  it('token grupları dolu ve bilinen anahtarları içerir', async () => {
    const css = readFileSync(join(HERE, '../tokens.css'), 'utf8');
    const generated = await generateTokensTs(css);
    expect(generated).toContain('color: {');
    expect(generated).toContain('ink950:');
    expect(generated).toContain('blue600:');
    expect(generated).toContain('dangerBg:');
    expect(generated).toContain('radius: {');
    expect(generated).toContain('space: {');
    expect(generated).toContain("s4: '16px'");
    expect(generated).toContain('text: {');
    expect(generated).toContain("xs: '12px'");
    expect(generated).toContain('family:');
  });

  it('bilinmeyen bir token adı üretimi açıkça reddeder', async () => {
    await expect(generateTokensTs(':root { --tf-bilinmeyen-token: 1px; }')).rejects.toThrow(
      /Tanınmayan token/,
    );
  });
});
