/**
 * Faz 07 — jest ortam hazırlığı.
 *
 * Native modüller (expo-secure-store, @react-native-community/netinfo)
 * testte bellek-içi sahteyle değiştirilir; SAHTE YOKSA TEST DÜRÜSTÇE
 * KIRILIR — asla sessiz başarı üretilmez. Üretim yolu gerçek modülü
 * kullanır (SecureStore = Keychain/Keystore).
 */

// --- expo-secure-store: bellek-içi anahtar/değer ---
const mockSecureStoreMap = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStoreMap.set(key, value);
  }),
  getItemAsync: jest.fn(async (key: string) => mockSecureStoreMap.get(key) ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStoreMap.delete(key);
  }),
}));

// --- netinfo: varsayılan çevrimiçi; testler __setState ile durumu değiştirir ---
const mockNetInfoState = { isConnected: true, isInternetReachable: true };
const mockNetInfoListeners = new Set<(state: typeof mockNetInfoState) => void>();
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: typeof mockNetInfoState) => void) => {
      mockNetInfoListeners.add(listener);
      return () => mockNetInfoListeners.delete(listener);
    },
    fetch: async () => mockNetInfoState,
  },
  __setState: (state: Partial<typeof mockNetInfoState>) => {
    Object.assign(mockNetInfoState, state);
    for (const listener of mockNetInfoListeners) listener(mockNetInfoState);
  },
}));

// --- react-native-screens: navigasyon jest ortamında mock (RNTL testleri ekran düzeyinde) ---
jest.mock('react-native-screens', () => ({
  enableScreens: jest.fn(),
  shouldEnableActivityState: jest.fn(() => false),
}));

// --- Expo winter runtime önden ısıtma ---
// Expo, globalThis proxy'siyle (winter) URL/FormData/fetch gibi polyfill'leri
// İLK ERİŞİMDE require eder. Jest 30 "between tests" require guard'ı bu
// geç kurulumu test aralığında yakalar → kurulum aşamasında bir kez erişip
// kurulumu burada tamamlarız (setupFiles sırasında require serbesttir).
const winterGlobals = [
  'URL',
  'URLSearchParams',
  'FormData',
  'Blob',
  'File',
  'Request',
  'Response',
  'Headers',
  'fetch',
  'WebSocket',
  'abort',
] as const;
for (const name of winterGlobals) {
  try {
    void (globalThis as Record<string, unknown>)[name];
  } catch {
    // Polyfill kurulamıyorsa (ortamda yok) sorun değil — testler kendi
    // sahtelerini kurar.
  }
}

export {};
