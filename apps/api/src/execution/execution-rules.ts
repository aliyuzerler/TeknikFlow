import type { ChecklistResponseType } from '@teknikflow/contracts';

/**
 * Faz 08 — saha yürütme saf kuralları (test edilebilir, DB'siz):
 * checklist yanıt tipi doğrulaması, işçilik süresi türetimi, visit
 * veri türetimi ve kanıt kapısı koşulları.
 */

/** Checklist maddesinin yanıt değeri tip uyumu — hata mesajı veya null. */
export function validateChecklistResponseValue(
  responseType: ChecklistResponseType,
  options: readonly string[] | null,
  value: unknown,
): string | null {
  if (value === null || value === undefined) return null; // temizleme
  switch (responseType) {
    case 'BOOLEAN':
      return typeof value === 'boolean' ? null : 'Evet/Hayır maddesi boolean yanıt ister';
    case 'NUMBER': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 'Sayı maddesi sonlu sayısal yanıt ister';
      }
      return null;
    }
    case 'TEXT':
      return typeof value === 'string' && value.length <= 2000
        ? null
        : 'Metin maddesi ≤2000 karakter yanıt ister';
    case 'SINGLE_SELECT': {
      if (typeof value !== 'string') return 'Tek seçim maddesi string yanıt ister';
      if (!options || !options.includes(value)) {
        return 'Yanıt maddenin seçeneklerinde değil';
      }
      return null;
    }
    case 'MULTI_SELECT': {
      if (!Array.isArray(value)) return 'Çok seçim maddesi dizi yanıt ister';
      if (value.some((entry) => typeof entry !== 'string')) {
        return 'Çok seçim yanıtları string dizisi olmalı';
      }
      const values = value as string[];
      if (new Set(values).size !== values.length) {
        return 'Çok seçim yanıtlarında tekrar olamaz';
      }
      if (!options || values.some((entry) => !options.includes(entry))) {
        return 'Yanıtlar maddenin seçeneklerinde değil';
      }
      return null;
    }
  }
}

/** İşçilik süresi (dk) — sunucu türetir; istemci değeri güvenilmez. */
export function laborDurationMinutes(startedAt: Date, endedAt: Date): number {
  const minutes = Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000);
  return Math.max(1, minutes);
}

/**
 * Geçiş gövdesindeki konumdan visit satırı verisi (saf).
 * Konum YOKSA: kaynak MANUAL, "Konum paylaşılmadı" — açık check-in yine
 * kaydedilir (izin reddi / cihaz fallback'i; kabul kriteri).
 */
export function visitDataFromLocation(
  location:
    | {
        latitude: number;
        longitude: number;
        accuracyMeters?: number | undefined;
        capturedAt: string;
        source: 'GPS' | 'MANUAL';
        manualReason?: string | undefined;
      }
    | undefined,
  visitType: 'CHECK_IN' | 'CHECK_OUT',
): {
  visitType: 'CHECK_IN' | 'CHECK_OUT';
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  source: 'GPS' | 'MANUAL';
  manualReason: string | null;
  capturedAt: Date | null;
} {
  if (!location) {
    return {
      visitType,
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      source: 'MANUAL',
      manualReason: 'Konum paylaşılmadı',
      capturedAt: null,
    };
  }
  return {
    visitType,
    latitude: location.latitude,
    longitude: location.longitude,
    accuracyMeters: location.source === 'GPS' ? (location.accuracyMeters ?? null) : null,
    source: location.source,
    manualReason: location.source === 'MANUAL' ? (location.manualReason ?? null) : null,
    capturedAt: new Date(location.capturedAt),
  };
}

/** Terminal durumlar — kanıt yazımı ve checklist/işçilik ekleme kapalı. */
export function isTerminalStatus(status: string): boolean {
  return status === 'CLOSED' || status === 'CANCELLED';
}

/** Kanıt kapısı: COMPLETED geçişi — zorunlu checklist yanıtlanmış mı? */
export function missingRequiredChecklist(
  items: ReadonlyArray<{ id: string; label: string; required: boolean; responseValue: unknown }>,
): Array<{ id: string; label: string }> {
  return items
    .filter(
      (item) => item.required && (item.responseValue === null || item.responseValue === undefined),
    )
    .map((item) => ({ id: item.id, label: item.label }));
}

/** Kanıt kapısı: CLOSED geçişi — en az bir MÜŞTERİ imzası var mı? */
export function hasCustomerSignatures(signatures: ReadonlyArray<{ signedBy: string }>): boolean {
  return signatures.some((signature) => signature.signedBy === 'CUSTOMER');
}
