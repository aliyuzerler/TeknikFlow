import type { LaborSummary, TimeEntryType } from '@teknikflow/contracts';

/**
 * Faz 08 — medya doğrulama yardımcıları (ADR-0005 doğrulama hattı).
 *
 * Magic-byte koklama SAF fonksiyonlardır: birim testleri dosya sistemi ya
 * da S3 olmadan çalışır. Sunucu, complete adımında obje deposundan ilk
 * 32 baytı okuyup gerçek MIME'ı burada belirler.
 */

/** Bilinen MIME aileleri (beyaz liste — SVG bilinçli olarak yok). */
export const KNOWN_MIME_PREFIXES: ReadonlyArray<{ mime: string; bytes: number[] }> = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
];

/**
 * Gerçek MIME'ı başlıktan belirle. MP4 'ftyp' kutusu 4. bayttan başlar:
 * `....ftyp` — ISO BMFF ailesi (mp4/m4v/mov) tek çatı altında kabul.
 */
export function detectMime(head: Uint8Array): string | null {
  if (head.length >= 3) {
    for (const known of KNOWN_MIME_PREFIXES) {
      if (known.bytes.every((byte, index) => head[index] === byte)) {
        return known.mime;
      }
    }
  }
  if (head.length >= 8) {
    if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) {
      return 'video/mp4'; // 'ftyp'
    }
  }
  return null;
}

/** Bildirilen MIME magic-byte tespitiyle eşleşiyor mu? */
export function mimeMatches(declared: string, detected: string | null): boolean {
  return detected !== null && declared === detected;
}

/**
 * Faz 08 — işgücü özeti hesabı (saf).
 *
 * Süre kayıtları kapatılmış (CLOSED) olanlar toplama girer; AÇIK kayıt
 * işaret olarak döner. Dakika yuvarlaması: yukarı (ceil) — müşteriye
 * yansıyan işgücü konservatif tarafta kalır, asla kayıp dakika yok.
 */
export function computeLaborSummary(
  entries: Array<{ type: TimeEntryType; startedAt: Date; endedAt: Date | null; status: string }>,
): LaborSummary {
  let travelMinutes = 0;
  let laborMinutes = 0;
  let waitingMinutes = 0;
  let openEntry = false;

  for (const entry of entries) {
    if (entry.status === 'OPEN') {
      openEntry = true;
      continue;
    }
    if (!entry.endedAt) continue;
    const diffMs = entry.endedAt.getTime() - entry.startedAt.getTime();
    if (diffMs <= 0) continue;
    const minutes = Math.ceil(diffMs / 60_000);
    switch (entry.type) {
      case 'TRAVEL':
        travelMinutes += minutes;
        break;
      case 'LABOR':
        laborMinutes += minutes;
        break;
      case 'WAITING':
        waitingMinutes += minutes;
        break;
    }
  }

  return {
    travelMinutes,
    laborMinutes,
    waitingMinutes,
    totalMinutes: travelMinutes + laborMinutes + waitingMinutes,
    openEntry,
  };
}

/** Kapalı kaydın dakika karşılığı (görünüm eşlemesi için). */
export function entryDurationMinutes(startedAt: Date, endedAt: Date | null): number | null {
  if (!endedAt) return null;
  const diffMs = endedAt.getTime() - startedAt.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / 60_000);
}
