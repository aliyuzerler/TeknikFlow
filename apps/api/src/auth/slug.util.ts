/** Türkçe karakterleri koruyarak URL dostu slug üretir. */
export function slugify(input: string): string {
  const map: Record<string, string> = {
    ç: 'c',
    ğ: 'g',
    ı: 'i',
    İ: 'i',
    ö: 'o',
    ş: 's',
    ü: 'u',
    Ç: 'c',
    Ğ: 'g',
    Ö: 'o',
    Ş: 's',
    Ü: 'u',
  };
  const lowered = input
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .toLowerCase();
  const slug = lowered
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug.length >= 3 ? slug : `tenant-${Date.now().toString(36)}`;
}
