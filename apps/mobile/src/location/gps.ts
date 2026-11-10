import type { GpsLocation } from '@teknikflow/contracts';

/**
 * Faz 08 — GPS kilometre taşı yakalama (ADR-0010).
 *
 * Saf çekirdek + enjekte edilen sağlayıcı: jest testleri expo-location
 * olmadan; üretim adapter'i (expo-location-provider.ts) yalnızca App
 * kabuğunda bağlanır. İzin reddi/çevrimdışı durumunda MANUEL onay +
 * zorunlu neden geri dönüşü sunulur (kabul kriteri).
 */

/** Sağlayıcıdan gelen ham konum düzeltmesi. */
export interface RawLocationFix {
  latitude: number;
  longitude: number;
  /** Metre cinsinden doğruluk yarıçapı (68. güven). */
  accuracyMeters: number;
  /** Cihaz saatiyle ölçüm anı (epoch ms). */
  timestampMs: number;
}

/** Ham düzeltmeyi sözleşme konumuna çevirir (kaynak: GPS). */
export function toGpsLocation(fix: RawLocationFix): GpsLocation {
  return {
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracyMeters: fix.accuracyMeters,
    capturedAt: new Date(fix.timestampMs).toISOString(),
    source: 'GPS',
  };
}

/** İzin reddi / konum yoksa manuel onay geri dönüşü (neden zorunlu). */
export function manualFallback(reason: string, at: Date = new Date()): GpsLocation {
  const trimmed = reason.trim();
  if (trimmed.length < 2) {
    throw new Error('Manuel onay nedeni en az 2 karakter olmalı');
  }
  return {
    capturedAt: at.toISOString(),
    source: 'MANUAL',
    manualReason: trimmed.slice(0, 200),
  };
}

export type LocationCaptureOutcome =
  | { kind: 'gps'; location: GpsLocation; accuracyMeters: number }
  | { kind: 'denied' }
  | { kind: 'unavailable'; message: string };

/** Konum sağlayıcı sözleşmesi (adapter'ler buna uyar). */
export type LocationProvider = () => Promise<
  { granted: true; fix: RawLocationFix | null } | { granted: false }
>;

/**
 * Anlık konum yakalama: izin reddi → denied; konum yoksa → unavailable;
 * başarı → sözleşme konumu. Doğruluk eşiği: kötü düzeltme (>200 m) yine
 * kabul edilir ama accuracy meta'sıyla taşınır (sunucu raporlar).
 */
export async function captureCurrentLocation(
  provider: LocationProvider,
): Promise<LocationCaptureOutcome> {
  const result = await provider();
  if (!result.granted) return { kind: 'denied' };
  if (!result.fix) {
    return { kind: 'unavailable', message: 'Konum sinyali alınamadı (kapalı alan?)' };
  }
  return {
    kind: 'gps',
    location: toGpsLocation(result.fix),
    accuracyMeters: result.fix.accuracyMeters,
  };
}
