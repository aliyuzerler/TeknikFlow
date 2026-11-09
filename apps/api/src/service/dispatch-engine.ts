/**
 * Faz 06 — dispatch motoru (SAF fonksiyonlar; ADR-0008).
 *
 * TEK GERÇEKLİK: planlama çakışması, çalışma penceresi ve kapasite
 * kuralları burada tanımlıdır; API servisleri ve testler aynı motoru
 * kullanır. Veritabanı erişimi YOKTUR — girdileri servis yükler.
 *
 * Saat dilimi kuralları:
 * - Depolama her zaman UTC; kiracı saat dilimi yalnız "yerel duvar saati"
 *   (working hours, pano günü) yorumlamasında kullanılır.
 * - Duvar saati → UTC dönüşümü iki geçişli ofset düzeltmesiyle DST
 *   geçişlerinde (ileri/geri alma) doğru an üretir; gün sınırları
 *   SONRAKİ günün yerel gece yarısından türetilir (23/25 saatlik günler).
 * - Europe/Istanbul 2016'dan beri kalıcı UTC+3'tür (DST yok); motor
 *   yine de genel çalışır — kiracı saat dilimi yapılandırılabilirdir.
 */

/** SLA "risk altında" eşiği: kalan süre ≤ bu değer (dakika). */
export const SLA_AT_RISK_MINUTES = 240;

/** SLA gözlemi açısından terminal iş emri durumları. */
export const SLA_TERMINAL_STATUSES = ['COMPLETED', 'CLOSED', 'CANCELLED'] as const;

export interface UtcWindow {
  start: Date;
  end: Date;
}

export interface ScheduleCandidate {
  workOrderId: string;
  workOrderNo: string;
  start: Date;
  end: Date;
}

export interface TimeOffWindow {
  timeOffId: string;
  start: Date;
  end: Date;
  reason: string | null;
}

export interface WorkingHourRule {
  weekday: number; // ISO 1..7
  startMinute: number;
  endMinute: number;
}

export interface ConflictInput {
  /** Aday planlama penceresi (UTC). */
  window: UtcWindow;
  /** Aynı teknisyenin DİĞER terminal-olmayan, tam pencereli iş emirleri. */
  otherOrders: ScheduleCandidate[];
  /** Adayın değdiği tüm yerel günlerin çalışma pencereleri (UTC). */
  workingWindows: UtcWindow[];
  /** Teknisyenin çalışma saati ŞABLONU var mı? Yoksa saat kısıtı uygulanmaz. */
  hasWorkingHours: boolean;
  /** Aktif izinler (UTC). */
  timeOffs: TimeOffWindow[];
}

export interface EngineConflict {
  type: 'OVERLAP' | 'OUTSIDE_WORKING_HOURS' | 'TIME_OFF';
  message: string;
  workOrderId: string | null;
  workOrderNo: string | null;
}

// ------------------------- Saat dilimi çekirdeği -------------------------

/**
 * Bir UTC anının verilen saat dilimindeki ofseti (ms). Intl tabanlı
 * hesap: anın bölge-yerel bileşenleri UTC'ye yansıtılıp fark alınır.
 */
export function tzOffsetMs(instant: Date, timeZone: string): number {
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
  const parts = formatter.formatToParts(instant);
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type === 'literal') continue;
    map[part.type] = Number(part.value);
  }
  const hour = map.hour === 24 ? 0 : map.hour; // bazı ortamlarda 00 → 24
  const asUtc = Date.UTC(map.year!, map.month! - 1, map.day!, hour, map.minute!, map.second!);
  return asUtc - instant.getTime();
}

export interface LocalDate {
  year: number;
  month: number; // 1..12
  day: number;
}

/** Yerel tarih → ISO hafta içi (1=Pazartesi..7=Pazar). */
export function isoWeekdayOf(date: LocalDate): number {
  const jsDay = new Date(Date.UTC(date.year, date.month - 1, date.day, 12)).getUTCDay();
  return ((jsDay + 6) % 7) + 1;
}

function nextLocalDate(date: LocalDate): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + 1, 12));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Yerel duvar saati → UTC anı (iki geçişli ofset düzeltmesi).
 * Var olmayan yerel saat (yaz saati ileri almadaki boşluk) en yakın
 * çözülebilir ana oturur — çalışma pencereleri pratikte 02:00-03:00
 * bandına düşmez; davranış belgelenmiştir.
 */
export function wallClockToUtc(date: LocalDate, minuteOfDay: number, timeZone: string): Date {
  const naive = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
  );
  let offset = tzOffsetMs(new Date(naive), timeZone);
  let candidate = naive - offset;
  const secondOffset = tzOffsetMs(new Date(candidate), timeZone);
  if (secondOffset !== offset) {
    offset = secondOffset;
    candidate = naive - offset;
  }
  return new Date(candidate);
}

/** Bir yerel günün UTC sınırları: [yerel gece yarısı, sonraki gün gece yarısı).
 *  Sonraki günden türetme DST'te 23/25 saatlik günleri doğru verir. */
export function localDayBoundsUtc(date: LocalDate, timeZone: string): { start: Date; end: Date } {
  const start = wallClockToUtc(date, 0, timeZone);
  const end = wallClockToUtc(nextLocalDate(date), 0, timeZone);
  return { start, end };
}

/** Bir UTC anının içinde bulunduğu yerel tarih (kiracı saat diliminde). */
export function localDateOf(instant: Date, timeZone: string): LocalDate {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(instant);
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type === 'literal') continue;
    map[part.type] = Number(part.value);
  }
  return { year: map.year!, month: map.month!, day: map.day! };
}

function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function sameDate(a: LocalDate, b: LocalDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** Bir UTC pencerenin değdiği yerel günlerin listesi (sıralı, tekil). */
export function localDatesTouched(window: UtcWindow, timeZone: string): LocalDate[] {
  const dates: LocalDate[] = [];
  let cursor = localDateOf(window.start, timeZone);
  const last = localDateOf(new Date(window.end.getTime() - 1), timeZone);
  // Güvenlik sınırı: makul olmayan genişlikte pencere.
  for (let i = 0; i < 366 && !sameDate(cursor, last); i += 1) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  dates.push(last);
  return dates;
}

/**
 * Şablon kurallarından verilen yerel günün UTC çalışma pencereleri.
 * Kural yoksa boş dizi (o gün çalışma yok → o güne planlama saat-dışı
 * çakışması üretir; ŞABLON tamamen yoksa kısıt uygulanmaz).
 */
export function workingWindowsForLocalDate(
  rules: readonly WorkingHourRule[],
  date: LocalDate,
  timeZone: string,
): UtcWindow[] {
  const weekday = isoWeekdayOf(date);
  return rules
    .filter((rule) => rule.weekday === weekday)
    .map((rule) => ({
      start: wallClockToUtc(date, rule.startMinute, timeZone),
      end: wallClockToUtc(date, rule.endMinute, timeZone),
    }))
    .filter((window) => window.end.getTime() > window.start.getTime());
}

// ------------------------- Aralık işlemleri -------------------------

/** A∩B tıkışma (uçtan-uca bitişiklik çakışma SAYILMAZ). */
export function windowsOverlap(a: UtcWindow, b: UtcWindow): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

function intersectionMinutes(a: UtcWindow, b: UtcWindow): number {
  const start = Math.max(a.start.getTime(), b.start.getTime());
  const end = Math.min(a.end.getTime(), b.end.getTime());
  return Math.max(0, end - start) / 60_000;
}

/** base pencerelerinden blocks'ı düşür (serbest slot hesabı). */
export function subtractWindows(base: UtcWindow[], blocks: UtcWindow[]): UtcWindow[] {
  let remaining = [...base];
  for (const block of blocks) {
    const next: UtcWindow[] = [];
    for (const window of remaining) {
      // Tamamen blok dışı.
      if (window.end <= block.start || block.end <= window.start) {
        next.push(window);
        continue;
      }
      // Sol artık.
      if (window.start < block.start) {
        next.push({ start: window.start, end: block.start });
      }
      // Sağ artık.
      if (block.end < window.end) {
        next.push({ start: block.end, end: window.end });
      }
    }
    remaining = next;
  }
  return remaining;
}

function totalMinutes(windows: UtcWindow[]): number {
  return windows.reduce(
    (sum, window) => sum + (window.end.getTime() - window.start.getTime()) / 60_000,
    0,
  );
}

// ------------------------- Çakışma tespiti -------------------------

/**
 * Aday planlama penceresi için çakışma bulguları:
 * - OVERLAP: aynı teknisyenin başka terminal-olmayan işiyle örtüşme
 *   (çift rezervasyon — kabul ölçütü: izinsiz/asılsız hiçbir örtüşme).
 * - TIME_OFF: aktif izinle örtüşme.
 * - OUTSIDE_WORKING_HOURS: pencerenin çalışma pencereleriyle
 *   KAPLANMAYAN kısmı (yalnız şablon VARSA denetlenir).
 */
export function findScheduleConflicts(input: ConflictInput): EngineConflict[] {
  const conflicts: EngineConflict[] = [];

  for (const order of input.otherOrders) {
    if (windowsOverlap(input.window, order)) {
      conflicts.push({
        type: 'OVERLAP',
        message: `Teknisyenin ${order.workOrderNo} iş emriyle zaman örtüşüyor`,
        workOrderId: order.workOrderId,
        workOrderNo: order.workOrderNo,
      });
    }
  }

  for (const off of input.timeOffs) {
    if (windowsOverlap(input.window, off)) {
      conflicts.push({
        type: 'TIME_OFF',
        message: off.reason ? `Teknisyen izinli (${off.reason})` : 'Teknisyen bu aralıkta izinli',
        workOrderId: null,
        workOrderNo: null,
      });
    }
  }

  if (input.hasWorkingHours) {
    const uncovered = subtractWindows([input.window], input.workingWindows);
    if (uncovered.length > 0) {
      const minutes = Math.round(totalMinutes(uncovered));
      conflicts.push({
        type: 'OUTSIDE_WORKING_HOURS',
        message: `Planlamanın ${minutes} dakikası çalışma saatleri dışına düşüyor`,
        workOrderId: null,
        workOrderNo: null,
      });
    }
  }

  return conflicts;
}

// ------------------------- Kapasite -------------------------

export interface CapacityInput {
  /** Günün çalışma pencereleri (UTC; şablon yoksa boş). */
  workingWindows: UtcWindow[];
  /** Teknisyenin günlük üst sınırı (dakika). */
  dailyCapacityMinutes: number;
  /** O güne denk gelen planlı iş emri pencereleri (UTC). */
  scheduledWindows: UtcWindow[];
  /** Günün UTC sınırları (kırpma için). */
  dayBounds: UtcWindow;
}

export interface CapacityResult {
  capacityMinutes: number;
  scheduledMinutes: number;
  utilizationPct: number;
}

/** Gün kapasitesi: şablon dakikaları (üst sınırla kırpılmış) ve yük. */
export function capacitySummary(input: CapacityInput): CapacityResult {
  const templateMinutes = totalMinutes(input.workingWindows);
  const capacityMinutes = input.workingWindows.length
    ? Math.min(Math.round(templateMinutes), input.dailyCapacityMinutes)
    : input.dailyCapacityMinutes;
  let scheduledMinutes = 0;
  for (const window of input.scheduledWindows) {
    scheduledMinutes += intersectionMinutes(window, input.dayBounds);
  }
  scheduledMinutes = Math.round(scheduledMinutes);
  const utilizationPct =
    capacityMinutes > 0 ? Math.round((scheduledMinutes / capacityMinutes) * 100) : 0;
  return { capacityMinutes, scheduledMinutes, utilizationPct };
}

// ------------------------- SLA -------------------------

export interface SlaState {
  breached: boolean;
  atRisk: boolean;
}

/** Terminal olmayan sürecin SLA durumu (aşım / risk altında). */
export function slaState(slaDueAt: Date | null, status: string, now: Date = new Date()): SlaState {
  if (!slaDueAt || (SLA_TERMINAL_STATUSES as readonly string[]).includes(status)) {
    return { breached: false, atRisk: false };
  }
  const remainingMinutes = (slaDueAt.getTime() - now.getTime()) / 60_000;
  return {
    breached: remainingMinutes < 0,
    atRisk: remainingMinutes >= 0 && remainingMinutes <= SLA_AT_RISK_MINUTES,
  };
}

// ------------------------- Yetenek eşleştirme -------------------------

export interface UserSkillLike {
  key: string;
  level: number;
}

export interface SkillMatchResult {
  matched: string[];
  missing: string[];
  /** 0..1 — eşleşen gerekli yetenek oranı (danışma puanı). */
  score: number;
}

/** Gerekli yetenek anahtarlarıyla teknisyen yeteneklerinin örtüşmesi. */
export function matchSkills(
  requiredKeys: readonly string[],
  userSkills: readonly UserSkillLike[],
): SkillMatchResult {
  const owned = new Set(userSkills.map((skill) => skill.key));
  const required = [...new Set(requiredKeys)];
  const matched = required.filter((key) => owned.has(key));
  return {
    matched,
    missing: required.filter((key) => !owned.has(key)),
    score: required.length === 0 ? 1 : matched.length / required.length,
  };
}

// ------------------------- Serbest slotlar -------------------------

/** Günün serbest slotları: çalışma pencereleri − planlı işler − izinler. */
export function freeSlotsForDay(input: {
  workingWindows: UtcWindow[];
  booked: UtcWindow[];
  timeOffs: UtcWindow[];
}): UtcWindow[] {
  return subtractWindows(input.workingWindows, [...input.booked, ...input.timeOffs]);
}
