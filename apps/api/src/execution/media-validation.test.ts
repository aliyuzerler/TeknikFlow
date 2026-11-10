import { describe, expect, it } from 'vitest';
import {
  detectMagicKind,
  magicMatchesContentType,
  sha256Hex,
  stripJpegMetadata,
} from './media-validation.js';

/**
 * TEST-08 §2 — medya doğrulama hattı birim testleri: magic-byte tespiti,
 * içerik türü uyumu, JPEG EXIF sökme (GPS sızıntı yüzeyi) ve checksum.
 */

/**
 * Geçerli JPEG segment uzunlukleri (uzunluk alanı 2 uzunluk baytı DAHİL,
 * marker Hariç): APP0 0x0010, APP1 0x000C, DQT 0x0004, SOS 0x0002.
 */
const APP0_JFIF = [
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
  0x00, 0x00,
];
const APP1_EXIF = [
  0xff, 0xe1, 0x00, 0x0c, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a,
];
const DQT = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x00];
const SOS_DATA_EOI = [0xff, 0xda, 0x00, 0x02, 0xaa, 0xbb, 0xcc, 0xff, 0xd9];

function jpegWithExif(): Uint8Array {
  // SOI + APP0(JFIF) + APP1(Exif) + DQT + SOS/veri/EOI
  return Uint8Array.from([0xff, 0xd8, ...APP0_JFIF, ...APP1_EXIF, ...DQT, ...SOS_DATA_EOI]);
}

function minimalJpeg(): Uint8Array {
  // SOI + APP0 + DQT + SOS/veri/EOI (metadatasız)
  return Uint8Array.from([0xff, 0xd8, ...APP0_JFIF, ...DQT, ...SOS_DATA_EOI]);
}

describe('detectMagicKind', () => {
  it('biçim imzaları tanınır', () => {
    expect(detectMagicKind(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('JPEG');
    expect(detectMagicKind(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'PNG',
    );
    expect(
      detectMagicKind(
        Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe('WEBP');
    expect(detectMagicKind(Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).toBe('PDF');
    // ftyp markaları
    expect(
      detectMagicKind(
        Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
      ),
    ).toBe('MP4');
    expect(
      detectMagicKind(
        Uint8Array.from([0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]),
      ),
    ).toBe('MOV');
  });

  it('bilinmeyen içerik null döner', () => {
    expect(detectMagicKind(Uint8Array.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
    expect(detectMagicKind(new Uint8Array(0))).toBeNull();
  });
});

describe('magicMatchesContentType', () => {
  it('uyumlu çiftler true, uyuşmazlık false', () => {
    expect(magicMatchesContentType('JPEG', 'image/jpeg')).toBe(true);
    expect(magicMatchesContentType('JPEG', 'image/png')).toBe(false);
    expect(magicMatchesContentType('PNG', 'image/png')).toBe(true);
    expect(magicMatchesContentType('MP4', 'video/mp4')).toBe(true);
    expect(magicMatchesContentType('MP4', 'video/quicktime')).toBe(false);
    expect(magicMatchesContentType('MOV', 'video/quicktime')).toBe(true);
    expect(magicMatchesContentType('PDF', 'application/pdf')).toBe(true);
    expect(magicMatchesContentType('PDF', 'image/jpeg')).toBe(false);
    expect(magicMatchesContentType(null, 'image/jpeg')).toBe(false);
  });
});

describe('stripJpegMetadata', () => {
  it('EXIF APP1 segmenti sökülür; teknik segmentler korunur', () => {
    const input = jpegWithExif();
    const { buffer, stripped } = stripJpegMetadata(input);
    expect(stripped).toBe(true);
    expect(buffer.length).toBeLessThan(input.length);
    expect(detectMagicKind(buffer)).toBe('JPEG');
    // APP0 (JFIF) duruyor: JFIF imzası arka arkaya aranır
    const bytes = Array.from(buffer);
    const hasJfif = bytes.some(
      (_, i) =>
        bytes[i] === 0xff &&
        bytes[i + 1] === 0xe0 &&
        bytes[i + 4] === 0x4a &&
        bytes[i + 5] === 0x46,
    );
    expect(hasJfif).toBe(true);
    // EXIF imzası (APP1 içinde "Exif") yok
    const joined = bytes.map((b) => String.fromCharCode(b)).join('');
    expect(joined.includes('Exif')).toBe(false);
  });

  it('metadatasız JPEG dokunulmadan döner', () => {
    const input = minimalJpeg();
    const { buffer, stripped } = stripJpegMetadata(input);
    expect(stripped).toBe(false);
    expect(buffer).toBe(input);
  });

  it('JPEG olmayan girdi değişmez', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const { buffer, stripped } = stripJpegMetadata(png);
    expect(stripped).toBe(false);
    expect(buffer).toBe(png);
  });
});

describe('sha256Hex', () => {
  it('deterministik ve 64 hex karakter', () => {
    const digest = sha256Hex(new TextEncoder().encode('teknikflow'));
    expect(digest).toHaveLength(64);
    expect(digest).toBe(sha256Hex(new TextEncoder().encode('teknikflow')));
    expect(digest).not.toBe(sha256Hex(new TextEncoder().encode('teknikflow2')));
  });
});
