#!/usr/bin/env node
/**
 * TeknikFlow tasarım token üreticisi.
 *
 * Tek kaynak: `tokens.css` (CSS özel değişkenleri). Bu betik onu ayrıştırıp
 * `src/tokens.ts` dosyasını üretir; böylece React Native teması ve JS tarafı
 * token'larla aynı değerleri kullanır — elle kopya/yanlış değer olamaz.
 *
 * Kullanım: pnpm --filter @teknikflow/design-tokens generate
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = dirname(HERE);
const CSS_PATH = join(PKG, 'tokens.css');
const OUT_PATH = join(PKG, 'src', 'tokens.ts');

/** Kök `.prettierrc.json` ile aynı seçenekler — üretilen dosya format-dostudur. */
const PRETTIER_OPTIONS = {
  parser: 'typescript',
  semi: true,
  singleQuote: true,
  printWidth: 100,
  trailingComma: 'all',
  endOfLine: 'lf',
};

/** Değeri Prettier-uyumlu TS dize sabitine çevirir (tek tırnak). */
function tsString(value) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** CSS değişkeni adını TS tanımlayıcısına çevirir: 'success-bg' → 'successBg'. */
function toIdentifier(name) {
  return name.replace(/-([a-z0-9])/g, (_, c) => String(c).toUpperCase());
}

const TEXT_SIZES = new Set(['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl']);

/** Tam CSS değişken adını [grup, tsAnahtarı] olarak sınıflandırır. */
function classify(name) {
  // Tipografi boyutları: text-xs ... text-3xl (renk 'text' ile karışmasın).
  if (/^text-(.+)$/.test(name)) {
    const size = name.slice('text-'.length);
    if (TEXT_SIZES.has(size)) {
      // Rakamla başlayan boyutlar (2xl/3xl) geçerli TS tanımlayıcısına çevrilir.
      const key = size === '2xl' ? 'xxl' : size === '3xl' ? 'xxxl' : toIdentifier(size);
      return ['text', key];
    }
    if (size === 'strong') return ['color', 'textStrong']; // RENK (slate-700), boyut değil
    return null; // bilinmeyen text-* token'ı — kasıtlı olarak yok sayılır
  }
  if (name === 'text') return ['color', 'text'];

  const colorPrefixes = ['ink-', 'blue-', 'teal-', 'success', 'warning', 'danger', 'info'];
  if (colorPrefixes.some((p) => name.startsWith(p))) return ['color', toIdentifier(name)];
  if (['canvas', 'surface', 'muted', 'border'].includes(name)) return ['color', name];
  // Anlamsal yardımcılar, marka geçişi ve bileşen yüzey/metin tonları (tokens.css).
  if (
    [
      'placeholder',
      'separator',
      'subtle',
      'brand-blue',
      'brand-teal',
      'surface-alt',
      'bg-subtle',
      'bg-quiet',
      'border-soft',
      'border-softer',
      'skeleton-base',
      'skeleton-highlight',
      'header-muted',
      'icon-muted',
      'on-accent',
      'warning-strong',
      'danger-strong',
      'attention',
      'dot-warning',
      'dot-danger',
      'dot-success',
      'sidebar-text',
      'sidebar-item',
      'sidebar-label',
      'sidebar-subtle',
      'sidebar-role',
      'sidebar-active',
      'sidebar-count-bg',
      'sidebar-count-text',
      'sidebar-divider',
      'violet-bg',
      'violet',
      'pink-bg',
      'pink',
    ].includes(name)
  ) {
    return ['color', toIdentifier(name)];
  }

  const radius = name.match(/^radius-(.+)$/);
  if (radius) return ['radius', toIdentifier(radius[1])];
  const shadow = name.match(/^shadow-(.+)$/);
  if (shadow) return ['shadow', toIdentifier(shadow[1])];
  const focus = name.match(/^focus-(.+)$/);
  if (focus) return ['focus', toIdentifier(focus[1])];

  const space = name.match(/^space-(\d+)$/);
  if (space) return ['space', `s${space[1]}`];

  if (name === 'font') return ['font', 'family'];
  return null;
}

/** Ham TS kaynağını kurar (formatlanmamış) — yardımcı. */
function buildTokensTs(css) {
  const vars = new Map();
  const pattern = /--tf-([a-z0-9-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = pattern.exec(css)) !== null) {
    vars.set(match[1], match[2].replace(/\s+/g, ' ').trim());
  }

  const out = { color: {}, radius: {}, shadow: {}, focus: {}, space: {}, text: {}, font: {} };
  for (const [name, value] of vars) {
    const classified = classify(name);
    if (!classified) {
      throw new Error(
        `Tanınmayan token: --tf-${name} (classify'a ekleyin ya da tokens.css'i düzeltin)`,
      );
    }
    const [group, key] = classified;
    if (key in out[group]) {
      throw new Error(`Tekrarlanan token anahtarı: ${group}.${key} (--tf-${name})`);
    }
    out[group][key] = value;
  }

  const lines = [];
  lines.push(
    '// OLUŞTURULMUŞ DOSYA — elle değiştirmeyin. Kaynak: packages/design-tokens/tokens.css',
  );
  lines.push('// Yeniden üretmek: pnpm --filter @teknikflow/design-tokens generate');
  lines.push('');
  lines.push('export const tokens = {');
  for (const [group, entries] of Object.entries(out)) {
    lines.push(`  ${group}: {`);
    for (const [key, value] of Object.entries(entries)) {
      lines.push(`    ${key}: ${tsString(value)},`);
    }
    lines.push('  },');
  }
  lines.push('} as const;');
  lines.push('');
  lines.push('export type Tokens = typeof tokens;');
  lines.push('');
  return lines.join('\n');
}

/**
 * CSS içeriğinden Prettier-uyumlu tokens.ts kaynağını üretir.
 * Dışa açılır — senkron testi ve CLI aynı kod yolunu kullanır.
 */
export async function generateTokensTs(css) {
  return format(buildTokensTs(css), PRETTIER_OPTIONS);
}

async function main() {
  const css = readFileSync(CSS_PATH, 'utf8');
  const ts = await generateTokensTs(css);
  writeFileSync(OUT_PATH, ts);
  const count = (ts.match(/: '/g) ?? []).length;
  console.log(`[design-tokens] ${count} token → ${OUT_PATH}`);
}

// Doğrudan çalıştırıldığında üret; import edildiğinde yalnız fonksiyon ver.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
