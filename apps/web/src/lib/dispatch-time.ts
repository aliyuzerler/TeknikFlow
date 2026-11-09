/**
 * Faz 06 — dispatch zaman yardımcıları (istemci).
 *
 * Panoda girilen duvar saati (date + time input değerleri) KIRACININ saat
 * diliminde yorumlanır ve UTC'ye çevrilir — planlamacının tarayıcı saati
 * kiracı saat diliminden farklı olsa bile doğrudur (kabul ölçütü:
 * "timezone correctness"). İki geçişli ofset düzeltmesi DST geçişlerinde
 * doğru an üretir (dispatch-engine.ts ile aynı teknik).
 */

function tzOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') map[part.type] = Number(part.value);
  }
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(map.year!, map.month! - 1, map.day!, hour, map.minute!, map.second!);
  return asUtc - instant.getTime();
}

/** Kiracı yerel duvar saati (YYYY-MM-DD + HH:mm) → UTC ISO dizesi. */
export function tenantWallClockToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(timeStr)) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const naive = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  let offset = tzOffsetMs(new Date(naive), timeZone);
  let candidate = naive - offset;
  const secondOffset = tzOffsetMs(new Date(candidate), timeZone);
  if (secondOffset !== offset) {
    offset = secondOffset;
    candidate = naive - offset;
  }
  return new Date(candidate).toISOString();
}

/** UTC ISO → kiracı yerel {date: YYYY-MM-DD, time: HH:mm} (form ön doldurma). */
export function utcToTenantWallClock(
  iso: string,
  timeZone: string,
): { date: string; time: string } | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') map[part.type] = Number(part.value);
  }
  const hour = map.hour === 24 ? 0 : map.hour;
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return {
    date: `${map.year}-${pad(map.month!)}-${pad(map.day!)}`,
    time: `${pad(hour!)}:${pad(map.minute!)}`,
  };
}

/** YYYY-MM-DD + gün kaydırma (yerel takvim aritmetiği). */
export function shiftDate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const probe = new Date(Date.UTC(year!, month! - 1, day! + days, 12));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${probe.getUTCFullYear()}-${pad(probe.getUTCMonth() + 1)}-${pad(probe.getUTCDate())}`;
}

/** ISO haftanın başı (Pazartesi) YYYY-MM-DD. */
export function startOfWeek(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const probe = new Date(Date.UTC(year!, month! - 1, day!, 12));
  const jsDay = probe.getUTCDay(); // 0=Pazar
  const back = (jsDay + 6) % 7; // Pazartesiye uzaklık
  return shiftDate(dateStr, -back);
}

/** HH:mm dakikaya (gün içi konumlandırma; takvim görünümü). */
export function minutesOfDay(timeStr: string): number {
  const [hour, minute] = timeStr.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}
