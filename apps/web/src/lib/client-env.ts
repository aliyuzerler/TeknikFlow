/**
 * İstemci bileşenleri için API kök adresi.
 *
 * Sunucu tarafı load-env dotenv okur (node:fs) — istemci paketine girmemeli.
 * Tarayıcıda NEXT_PUBLIC_API_BASE_URL ya da aynı-origin varsayılan geçerli;
 * geliştirmede API :4000'dedir (proxy yok — CORS izinli kök .env'de).
 */
export function getClientApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
}
