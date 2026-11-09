import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { RefreshControl } from 'react-native';
import type { WorkOrderView } from '@teknikflow/contracts';
import { EmptyView, ErrorView, LoadingView } from '../components/screen-states';
import { SyncBanner } from '../components/sync-banner';
import { WorkOrderCard } from '../components/work-order-card';
import type { SyncContextValue } from '../sync/sync-context';
import type { WorkOrderCache } from '../cache/work-order-cache';
import { theme } from '../theme';

/**
 * Faz 07 — teknisyen gelen kutusu. Veri kaynağı YEREL ÖNBELLEK (offline-
 * first): liste her açılışta önbellekten kurulur; senkron sunucuyu çeker ve
 * önbelleği tazeler. Filtreler: Tümü / Aktif / Planlı / Tamamlanan.
 * Atama filtresi sunucuda zorunlu (mine=true) — view_all'suz teknisyen
 * zaten yalnız kendi işini görür.
 */

export type InboxFilter = 'all' | 'active' | 'planned' | 'done';

const FILTERS: Array<{ key: InboxFilter; label: string }> = [
  { key: 'all', label: 'Tümü' },
  { key: 'active', label: 'Aktif' },
  { key: 'planned', label: 'Planlı' },
  { key: 'done', label: 'Tamamlanan' },
];

const ACTIVE_STATUSES = new Set([
  'ASSIGNED',
  'ACCEPTED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
  'WAITING_PARTS',
  'WAITING_CUSTOMER',
]);
const PLANNED_STATUSES = new Set(['DRAFT', 'PLANNED']);
const DONE_STATUSES = new Set(['COMPLETED', 'CLOSED', 'CANCELLED']);

export function filterRows(rows: WorkOrderView[], filter: InboxFilter): WorkOrderView[] {
  if (filter === 'all') return rows;
  if (filter === 'active') return rows.filter((row) => ACTIVE_STATUSES.has(row.status));
  if (filter === 'planned') return rows.filter((row) => PLANNED_STATUSES.has(row.status));
  return rows.filter((row) => DONE_STATUSES.has(row.status));
}

export interface InboxScreenProps {
  cache: WorkOrderCache;
  identity: { userId: string; tenantId: string } | null;
  sync: SyncContextValue;
  onOpenWorkOrder(id: string): void;
  testIDPrefix?: string;
}

export function InboxScreen({
  cache,
  identity,
  sync,
  onOpenWorkOrder,
  testIDPrefix = 'inbox',
}: InboxScreenProps) {
  const [rows, setRows] = useState<WorkOrderView[] | null>(null);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const cached = identity ? await cache.list(identity.userId, identity.tenantId) : [];
      setLoadError(null);
      setRows(cached.map((row) => row.payload).sort(compareRows));
    } catch {
      setLoadError('Önbellek okunamadı');
    }
  }, [cache, identity]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    // Senkron tamamlandığında liste tazelenir (synced/eğer cache değiştiyse).
    if (sync.status === 'synced') void reload();
  }, [sync.status, reload]);

  const filtered = useMemo(() => (rows ? filterRows(rows, filter) : null), [rows, filter]);

  if (filtered === null) {
    return loadError ? (
      <ErrorView
        detail={loadError}
        onRetry={() => void reload()}
        testID={`${testIDPrefix}-error`}
      />
    ) : (
      <LoadingView testID={`${testIDPrefix}-loading`} />
    );
  }

  return (
    <View style={styles.container}>
      <SyncBanner
        status={sync.status}
        lastSyncAt={sync.lastSyncAt}
        pendingCount={sync.pendingCount}
        error={sync.error}
        testID={`${testIDPrefix}-sync-banner`}
      />

      <View style={styles.filterRow} accessibilityRole="tablist">
        {FILTERS.map((item) => (
          <Text
            key={item.key}
            style={[styles.filterChip, filter === item.key && styles.filterChipActive]}
            onPress={() => setFilter(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === item.key }}
            testID={`${testIDPrefix}-filter-${item.key}`}
          >
            {item.label}
          </Text>
        ))}
      </View>

      {filtered.length === 0 ? (
        <EmptyView
          title="Henüz iş yok"
          body={
            filter === 'all'
              ? 'Size atanmış iş emri bulunmuyor. Yeni iş atandığında burada görünür.'
              : 'Bu filtrede iş yok — diğer filtreleri deneyin.'
          }
          testID={`${testIDPrefix}-empty`}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.workOrderId}
          renderItem={({ item }) => (
            <WorkOrderCard
              order={item}
              onPress={onOpenWorkOrder}
              testID={`${testIDPrefix}-card-${item.workOrderNo}`}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={sync.status === 'syncing'}
              onRefresh={() => void sync.refresh()}
              tintColor={theme.blue600}
            />
          }
        />
      )}
    </View>
  );
}

function compareRows(a: WorkOrderView, b: WorkOrderView): number {
  // Planlı işler zamana göre; diğerleri önce SLA son tarihi, sonra numara.
  const priority = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
  if (a.priority !== b.priority) return priority[a.priority] - priority[b.priority];
  const aDue = a.slaDueAt ?? '9999';
  const bDue = b.slaDueAt ?? '9999';
  if (aDue !== bDue) return aDue.localeCompare(bDue);
  return a.workOrderNo.localeCompare(b.workOrderNo);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.canvas,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  filterChip: {
    fontSize: theme.textSm,
    fontWeight: '600',
    color: theme.textStrong,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  filterChipActive: {
    backgroundColor: theme.blue600,
    borderColor: theme.blue600,
    color: theme.onAccent,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
});
