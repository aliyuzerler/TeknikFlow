import { createHash } from 'node:crypto';

/**
 * Faz 08 — medya doğrulama hattı (ADR-0005):
 *
 * 1. Magic-byte tespiti (uzantı/gövde MIME'ine güvenilmez).
 * 2. İçerik-checksum (SHA-256) — kayıt bütünlüğü.
 * 3. JPEG EXIF temizliği — GPS konum sızıntısı yüzeyi kapatılır (yalnızca
 *    JPEG segment yürütücüsüyle; PNG eXIf/WebP sınırlaması dokümante).
 */

export type MagicKind = 'JPEG' | 'PNG' | 'WEBP' | 'MP4' | 'MOV' | 'PDF' | null;

/** İlk baytlardan gerçek biçimi tespit et. */
export function detectMagicKind(buffer: Uint8Array): MagicKind {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'JPEG';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'PNG';
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'WEBP';
  }
  if (
    buffer.length >= 12 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    // 'ftyp' kutusu — marka baytı MP4/QuickTime ayrımı yapar.
    const brand = String.fromCharCode(buffer[8]!, buffer[9]!, buffer[10]!, buffer[11]!);
    if (brand.startsWith('qt')) return 'MOV';
    return 'MP4';
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return 'PDF';
  }
  return null;
}

/** Magic-byte ↔ beyan edilen içerik türü uyumu. */
export function magicMatchesContentType(kind: MagicKind, contentType: string): boolean {
  switch (kind) {
    case 'JPEG':
      return contentType === 'image/jpeg';
    case 'PNG':
      return contentType === 'image/png';
    case 'WEBP':
      return contentType === 'image/webp';
    case 'MP4':
      return contentType === 'video/mp4';
    case 'MOV':
      return contentType === 'video/quicktime';
    case 'PDF':
      return contentType === 'application/pdf';
    default:
      return false;
  }
}

/** SHA-256 özeti (hex) — complete adımında saklanır. */
export function sha256Hex(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * JPEG'den EXIF (APP1) ve diğer meta segmentlerini söker — GPS/kişisel
 * veri sızıntısını bayt düzeyinde kapatır. SOI'dan sonra:
 *   - APP0 (JFIF) tutulur (teknik segment),
 *   - APP1..APP15 + COM segmentleri atılır (EXIF, XMP, IPTC),
 *   - kalan görüntü segmentleri (DQT/SOF/DHT/SOS...) birebir korunur.
 * JPEG değilse girdi değişmeden döner.
 */
export function stripJpegMetadata(buffer: Uint8Array): { buffer: Uint8Array; stripped: boolean } {
  if (detectMagicKind(buffer) !== 'JPEG') return { buffer, stripped: false };
  // SOI (FFD8) + ilk marker'ı bul; marker'a kadar kopyala.
  let offset = 2;
  const parts: number[] = [0xff, 0xd8];
  let stripped = false;
  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xff) {
      // Bozuk akış — güvenli yol: değiştirmeden bırak.
      return { buffer, stripped: false };
    }
    const marker = buffer[offset + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // Başımsız marker'lar — uzunluksuz.
      parts.push(0xff, marker);
      offset += 2;
      continue;
    }
    if (marker === 0xda) {
      // SOS — görüntü verisi başlar; kalan baytları olduğu gibi ekle.
      parts.push(...buffer.subarray(offset, buffer.length));
      break;
    }
    if (offset + 3 >= buffer.length) {
      // Segment uzunluğu okunamıyor — bozuk akış, dokunma.
      return { buffer, stripped: false };
    }
    const segmentLength = (buffer[offset + 2]! << 8) | buffer[offset + 3]!;
    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe; // APPn + COM
    if (!isMetadata || marker === 0xe0) {
      // APP0 (JFIF) ve tüm teknik segmentler korunur.
      parts.push(...buffer.subarray(offset, offset + 2 + segmentLength));
    } else {
      stripped = true; // APP1..APP15, COM atıldı (EXIF/XMP/IPTC dahil).
    }
    offset += 2 + segmentLength;
  }
  if (!stripped) return { buffer, stripped: false };
  const out = Uint8Array.from(parts);
  // Doğrulama: çıktı hâlâ geçerli JPEG mi?
  if (detectMagicKind(out) !== 'JPEG') return { buffer, stripped: false };
  return { buffer: out, stripped: true };
}
