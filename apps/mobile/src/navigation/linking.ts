import { createNavigationContainerRef } from '@react-navigation/native';

/**
 * Faz 07 — bildirim yönlendirmesi (deep link). Bildirim tap → uygulama
 * ilgili iş emri detayına gider. Şema: tfmobile://wo/{id}
 * (bağlantı dizgisi sunucu/bildirim servisiyle paylaşılır).
 */

export type RootStackParamList = {
  Login: undefined;
  Inbox: undefined;
  WorkOrderDetail: { workOrderId: string };
  Account: undefined;
};

export const WORK_ORDER_LINK_PREFIXES = ['tfmobile://wo/'];

export function workOrderDeepLink(id: string): string {
  return `tfmobile://wo/${id}`;
}

/** Linking yapılandırması — React Navigation'a bağlanır. */
export const linking = {
  prefixes: WORK_ORDER_LINK_PREFIXES,
  config: {
    screens: {
      WorkOrderDetail: {
        path: 'wo/:workOrderId',
        parse: {
          workOrderId: (value: string) => value,
        },
      },
      Inbox: 'inbox',
    },
  },
} as const;

/** Bildirim bağlantısından iş emri kimliği çıkarır (geçersiz → null). */
export function parseWorkOrderLink(url: string): string | null {
  const match = /^tfmobile:\/\/wo\/([A-Za-z0-9-]+)$/.exec(url);
  return match ? (match[1] ?? null) : null;
}

export function createNavigation(): ReturnType<
  typeof createNavigationContainerRef<RootStackParamList>
> {
  return createNavigationContainerRef<RootStackParamList>();
}
