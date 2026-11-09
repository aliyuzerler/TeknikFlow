import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createMobileApiClient } from './src/api/client';
import { createOutboxRepo } from './src/cache/outbox-repo';
import { createSqliteCacheDriver } from './src/cache/sqlite-driver';
import { createWorkOrderCache } from './src/cache/work-order-cache';
import { AppNavigatorContainer } from './src/navigation/navigator';
import { SessionProvider, useSession } from './src/session/session-context';
import { createSecureStoreTokenStore } from './src/session/token-store';
import { SyncProvider } from './src/sync/sync-context';
import { createSyncService } from './src/sync/sync-service';

/**
 * Faz 07 — uygulama kökü: güvenli oturum + offline-first senkron + gezgin.
 *
 * API tabanı: EXPO_PUBLIC_API_URL (geliştirme: Android emülatörde
 * 10.0.2.2 = host loopback; gerçek cihazda LAN IP).
 */

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000';

export default function App(): React.JSX.Element {
  const tokens = useMemo(() => createSecureStoreTokenStore(), []);
  const driver = useMemo(() => createSqliteCacheDriver(), []);
  const cache = useMemo(() => createWorkOrderCache(driver), [driver]);
  const outbox = useMemo(() => createOutboxRepo(driver), [driver]);

  const api = useMemo(
    () =>
      createMobileApiClient({
        baseUrl: API_BASE_URL,
        tokens,
        onAuthLost: () => {
          void tokens.clear();
        },
      }),
    [tokens],
  );

  const syncService = useMemo(
    () =>
      createSyncService({
        api,
        workOrderCache: cache,
        outbox,
        isOnline: () => true, // SyncProvider netinfo'yu yönetir ve izler
        getIdentity: async () => identityHolder.current,
      }),
    [api, cache, outbox],
  );

  /** Oturum meta'sından türeyen kimlik — SessionRoot güncel tutar. */
  const identityHolder = useMemo(
    () => ({ current: null as { userId: string; tenantId: string } | null }),
    [],
  );

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SessionProvider api={api} tokens={tokens} onSignedOut={() => void syncService.clearLocal()}>
        <SyncProvider
          service={syncService}
          workOrderCache={cache}
          getIdentity={async () => identityHolder.current}
        >
          <SessionRoot api={api} cache={cache} identityHolder={identityHolder} />
        </SyncProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function SessionRoot({
  api,
  cache,
  identityHolder,
}: {
  api: ReturnType<typeof createMobileApiClient>;
  cache: ReturnType<typeof createWorkOrderCache>;
  identityHolder: { current: { userId: string; tenantId: string } | null };
}) {
  const session = useSession();

  // Kimlik: oturum meta'sı userId/tenantId taşır (offline açılışta da hazır).
  const identity =
    session.meta && session.meta.userId && session.meta.tenantId
      ? { userId: session.meta.userId, tenantId: session.meta.tenantId }
      : null;
  identityHolder.current = identity;

  return <AppNavigatorContainer api={api} cache={cache} identity={identity} />;
}
