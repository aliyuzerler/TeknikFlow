import * as ExpoLocation from 'expo-location';
import type { LocationProvider, RawLocationFix } from './gps';

/**
 * Faz 08 — expo-location üretim sağlayıcısı.
 *
 * Yalnızca burada native bağımlılık bilinir; ekranlar LocationProvider
 * soyutlamasıyla çalışır (testlerde sahte sağlayıcı).
 */

export const expoLocationProvider: LocationProvider = async () => {
  const permission = await ExpoLocation.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    return { granted: false };
  }
  const fix = await ExpoLocation.getCurrentPositionAsync({
    accuracy: ExpoLocation.Accuracy.Balanced,
  });
  const { latitude, longitude, accuracy, timestamp } = fix.coords as {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    timestamp?: number;
  };
  const raw: RawLocationFix = {
    latitude,
    longitude,
    accuracyMeters: accuracy ?? 0,
    timestampMs: timestamp ?? fix.timestamp ?? Date.now(),
  };
  return { granted: true, fix: raw };
};
