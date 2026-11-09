import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import type { CachedWorkOrder } from '../cache/work-order-cache';
import type { WorkOrderCache } from '../cache/work-order-cache';
import type { SyncService, SyncOutcome } from './sync-service';

/**
 * Faz 07 — senkron durum görünürlüğü (ADR-0004 §6: local/queued/syncing/
 * synced/offline/error durumları dürüstçe gösterilir; asla sahte "senkron").
 *
 * Bağlantı gelir / uygulama önplana gelir → otomatik çekme; kullanıcı
 * pull-to-refresh ile de tetikleyebilir.
 */

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncContextValue {
  status: SyncStatus;
  lastSyncAt: string | null;
  pendingCount: number;
  /** Sunucu/İE çekme hatası (kullanıcıya banner'da gösterilir). */
  error: string | null;
  isOnline: boolean;
  refresh(): Promise<SyncOutcome>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export interface SyncProviderProps {
  service: SyncService;
  workOrderCache: WorkOrderCache;
  /** Oturum kimliği sağlayıcısı (yenilenmeyi tetiklemek için sorgulanır). */
  getIdentity(): Promise<{ userId: string; tenantId: string } | null>;
  children: React.ReactNode;
}

export function SyncProvider({
  service,
  workOrderCache,
  getIdentity,
  children,
}: SyncProviderProps) {
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const syncingRef = useRef(false);
  const identityRef = useRef(getIdentity);
  identityRef.current = getIdentity;

  // Netinfo aboneliği: bağlantı durumu + geri gelmede otomatik senkron.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      setIsOnline(online);
      if (online) void runRefresh();
      else setStatus('offline');
    });
    return () => unsubscribe();
  }, []);

  async function runRefresh(): Promise<SyncOutcome> {
    if (syncingRef.current) {
      return { ok: false, reason: 'network', message: 'Senkron zaten sürüyor' };
    }
    syncingRef.current = true;
    setStatus('syncing');
    try {
      const outcome = await service.pullWorkOrders();
      if (outcome.ok) {
        setStatus('synced');
        setError(null);
        const who = await identityRef.current();
        if (who) {
          setLastSyncAt(await workOrderCache.lastSyncAt(who.userId, who.tenantId));
        }
      } else {
        setStatus(outcome.reason === 'offline' ? 'offline' : 'error');
        setError(outcome.reason === 'offline' ? null : outcome.message);
      }
      setPendingCount(await service.pendingCount());
      return outcome;
    } finally {
      syncingRef.current = false;
    }
  }

  const actions = useMemo<SyncContextValue>(
    () => ({
      status,
      lastSyncAt,
      pendingCount,
      error,
      isOnline,
      refresh: runRefresh,
    }),
    [status, lastSyncAt, pendingCount, error, isOnline],
  );

  return <SyncContext.Provider value={actions}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync, SyncProvider içinde kullanılmalı');
  return ctx;
}

/** Gelen kutusu listesi okuma yardımcısı (ekranlar kullanır). */
export async function loadCachedWorkOrders(
  cache: WorkOrderCache,
  identity: { userId: string; tenantId: string } | null,
): Promise<CachedWorkOrder[]> {
  if (!identity) return [];
  return cache.list(identity.userId, identity.tenantId);
}
