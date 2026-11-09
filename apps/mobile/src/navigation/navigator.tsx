import {
  NavigationContainer,
  type NavigationContainerRef,
  useNavigation,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { createRef } from 'react';
import type { WorkOrderView } from '@teknikflow/contracts';
import type { MobileApiClient } from '../api/client';
import type { WorkOrderCache } from '../cache/work-order-cache';
import { AccountScreen } from '../screens/account-screen';
import { InboxScreen } from '../screens/inbox-screen';
import { LoginScreen } from '../screens/login-screen';
import { WorkOrderDetailScreen } from '../screens/work-order-detail-screen';
import { useSession } from '../session/session-context';
import { useSync } from '../sync/sync-context';
import { theme } from '../theme';
import { linking, type RootStackParamList } from './linking';

/**
 * Faz 07 — kök gezgin. Oturum durumuna göre giriş ya da uygulama akışı;
 * booting'de dürüst yükleme ekranı. Bildirim yönlendirmesi linking ile
 * (tfmobile://wo/{id} → WorkOrderDetail).
 */

export type RootStackProps = NativeStackNavigationProp<RootStackParamList>;
const Stack = createNativeStackNavigator<RootStackParamList>();

/** Bildirim/deep-link yönlendirmesi için kapsayıcı referansı. */
export const navigationRef = createRef<NavigationContainerRef<RootStackParamList>>();

export interface RootNavigatorProps {
  api: MobileApiClient;
  cache: WorkOrderCache;
  identity: { userId: string; tenantId: string } | null;
}

export function RootNavigator({ api, cache, identity }: RootNavigatorProps) {
  const session = useSession();

  if (session.status === 'booting') {
    return <BootScreen />;
  }

  if (session.status !== 'signed-in') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
      </Stack.Navigator>
    );
  }

  const getOrder = async (id: string): Promise<WorkOrderView | null> => {
    const cached = await cache.get(identity?.userId ?? '', id);
    return cached?.payload ?? null;
  };

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Inbox">
      <Stack.Screen name="Inbox">
        {() => <InboxWithNav cache={cache} identity={identity} />}
      </Stack.Screen>
      <Stack.Screen name="WorkOrderDetail">
        {({ route }) => (
          <WorkOrderDetailScreen
            getOrder={getOrder}
            workOrderId={(route.params as { workOrderId: string }).workOrderId}
            onBack={() => navigationRef.current?.goBack()}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Account">{() => <AccountScreen api={api} />}</Stack.Screen>
    </Stack.Navigator>
  );
}

/** Gelen kutusu — navigasyonu ekran yerine burada bağla (RNTL testi props ile). */
function InboxWithNav({
  cache,
  identity,
}: {
  cache: WorkOrderCache;
  identity: RootNavigatorProps['identity'];
}) {
  const sync = useSync();
  const navigation = useNavigation<RootStackProps>();
  return (
    <InboxScreen
      cache={cache}
      identity={identity}
      sync={sync}
      onOpenWorkOrder={(workOrderId) => navigation.navigate('WorkOrderDetail', { workOrderId })}
    />
  );
}

export function BootScreen() {
  return (
    <View style={styles.boot} accessible accessibilityLabel="Uygulama açılıyor">
      <Text style={styles.logo}>TeknikFlow</Text>
      <ActivityIndicator color={theme.blue600} style={styles.spinner} />
    </View>
  );
}

export function AppNavigatorContainer(props: RootNavigatorProps) {
  return (
    <NavigationContainer linking={linking} ref={navigationRef}>
      <RootNavigator {...props} />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.canvas,
  },
  logo: {
    fontSize: 28,
    fontWeight: '700',
    color: theme.ink900,
    letterSpacing: -0.5,
  },
  spinner: {
    marginTop: 16,
  },
});
