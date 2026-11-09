import { randomBytes } from 'node:crypto';

/**
 * Faz 04 — CRM saf yardımcıları (birim testleri doğrudan sınar).
 */

/** Çift kayıt anahtarı: Türkçe karakterler dahil büyük harf + sıkıştırılmış boşluk. */
export function normalizeName(input: string): string {
  const map: Record<string, string> = {
    İ: 'I',
    ı: 'I',
    ş: 'S',
    Ş: 'S',
    ğ: 'G',
    Ğ: 'G',
    ü: 'U',
    Ü: 'U',
    ö: 'O',
    Ö: 'O',
    ç: 'C',
    Ç: 'C',
  };
  return input
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** E-posta normalizasyonu (tekil anahtar parçası). */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

const TAG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // karışabilir karakterler yok

/** Otomatik varlık etiketi: AST-XXXXXX (kiracı içinde tekil olması servisçe garanti). */
export function generateAssetTag(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += TAG_ALPHABET[bytes[i]! % TAG_ALPHABET.length];
  }
  return `AST-${code}`;
}

/** Varlık QR derin bağlantısı — mobil uygulama (Faz 07) tarar. */
export function assetDeepLink(baseUrl: string, assetTag: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/a/${encodeURIComponent(assetTag)}`;
}

export const ASSET_SORT_ALLOWLIST = ['assetTag', 'createdAt', 'manufacturer'] as const;
export const CUSTOMER_SORT_ALLOWLIST = ['name', 'createdAt'] as const;
