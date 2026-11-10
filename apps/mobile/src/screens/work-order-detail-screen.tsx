import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ExecutionReportView, WorkOrderView } from '@teknikflow/contracts';
import { EmptyView, ErrorView, LoadingView } from '../components/screen-states';
import { StatusBadge } from '../components/status-badge';
import { ExecutionPanel } from '../components/execution-panel';
import { formatDateTime, formatScheduleWindow, slaLabel } from '../lib/format';
import type { ExecutionActions } from './execution-actions';
import { theme } from '../theme';

/**
 * Faz 07 — iş emri detayı (snapshot).
 * Faz 08 — saha yürütme paneli: kabul/yol/varış(GPS)/iş/bitiş eylemleri,
 * checklist, süre takibi, imza ve kanıt özeti (rapor). Eylemler outbox'a
 * girer; rapor çevrimiçiyse çekilir, çevrimdışıyken panel kuyruğa alır.
 */

export interface WorkOrderDetailScreenProps {
  getOrder(id: string): Promise<WorkOrderView | null>;
  workOrderId: string;
  onBack(): void;
  /** Faz 08: saha eylemleri (opsiyonel — testler basit kalabilir). */
  execution?: {
    actions: ExecutionActions;
    isOnline(): boolean;
    pendingCount(): Promise<number>;
    getReport(id: string): Promise<ExecutionReportView | null>;
  };
  testIDPrefix?: string;
}

export function WorkOrderDetailScreen({
  getOrder,
  workOrderId,
  onBack,
  execution,
  testIDPrefix = 'wo-detail',
}: WorkOrderDetailScreenProps) {
  const [order, setOrder] = useState<WorkOrderView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [report, setReport] = useState<ExecutionReportView | null>(null);
  const [pending, setPending] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);

  const online = execution?.isOnline() ?? false;

  useEffect(() => {
    void (async () => {
      const found = await getOrder(workOrderId);
      if (found) {
        setOrder(found);
        setState('ready');
      } else {
        setState('missing');
      }
    })();
  }, [workOrderId, refreshTick]);

  useEffect(() => {
    if (!execution) return;
    void (async () => {
      const [nextReport, nextPending] = await Promise.all([
        execution.isOnline() ? execution.getReport(workOrderId) : Promise.resolve(null),
        execution.pendingCount(),
      ]);
      setReport(nextReport);
      setPending(nextPending);
    })();
  }, [workOrderId, execution, refreshTick, online]);

  const onAfterAction = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  if (state === 'loading') return <LoadingView testID={`${testIDPrefix}-loading`} />;
  if (state === 'missing') {
    return (
      <EmptyView
        title="İş emri önbellekte yok"
        body="Bağlantı kurup tekrar senkronize edin — iş size atandığında görünür."
        testID={`${testIDPrefix}-missing`}
      />
    );
  }
  if (!order) {
    return <ErrorView testID={`${testIDPrefix}-error`} onRetry={onBack} />;
  }

  const sla = slaLabel(order);
  return (
    <ScrollView contentContainerStyle={styles.container} testID={testIDPrefix}>
      <Text
        style={styles.back}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Geri"
      >
        ← Geri
      </Text>

      <View style={styles.headerRow}>
        <Text style={styles.no}>{order.workOrderNo}</Text>
        <StatusBadge priority={order.priority} />
      </View>
      <Text style={styles.subject}>{order.subject}</Text>
      <StatusBadge status={order.status} />

      <Section title="Müşteri">
        <Row label="Müşteri" value={order.customerName} />
        {order.assetTag ? <Row label="Varlık" value={order.assetTag} /> : null}
        {order.locationName ? <Row label="Lokasyon" value={order.locationName} /> : null}
        <Row label="Şube" value={order.branchName ?? '—'} />
      </Section>

      <Section title="Planlama">
        <Row
          label="Pencere"
          value={formatScheduleWindow(order.scheduledStart, order.scheduledEnd)}
        />
        <Row label="Atanan" value={order.assignedToName ?? '—'} />
        <Row
          label="SLA"
          value={sla.text}
          valueTone={
            sla.tone === 'danger' ? 'danger' : sla.tone === 'warning' ? 'warning' : undefined
          }
        />
      </Section>

      <Section title="Açıklama">
        <Text style={styles.description}>{order.description ?? 'Açıklama girilmemiş.'}</Text>
      </Section>

      <Section title="Zaman çizelgesi">
        <Row label="Oluşturma" value={formatDateTime(order.createdAt)} />
        {order.acceptedAt ? <Row label="Kabul" value={formatDateTime(order.acceptedAt)} /> : null}
        {order.startedAt ? <Row label="Başlangıç" value={formatDateTime(order.startedAt)} /> : null}
        {order.completedAt ? (
          <Row label="Tamamlama" value={formatDateTime(order.completedAt)} />
        ) : null}
      </Section>

      {execution ? (
        <ExecutionPanel
          order={order}
          actions={execution.actions}
          report={report}
          online={online}
          pendingCount={pending}
          onAfterAction={onAfterAction}
          testIDPrefix={`${testIDPrefix}-execution`}
        />
      ) : null}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({
  label,
  value,
  valueTone,
}: {
  label: string;
  value: string;
  valueTone?: 'danger' | 'warning';
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          valueTone === 'danger' && styles.rowDanger,
          valueTone === 'warning' && styles.rowWarning,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
    backgroundColor: theme.canvas,
  },
  back: {
    fontSize: theme.textBase,
    color: theme.blue700,
    fontWeight: '600',
    marginBottom: 12,
    paddingVertical: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  no: {
    fontSize: theme.textLg,
    fontWeight: '700',
    color: theme.ink900,
  },
  subject: {
    marginTop: 6,
    marginBottom: 10,
    fontSize: theme.textXl,
    fontWeight: '600',
    color: theme.text,
    lineHeight: 26,
  },
  section: {
    marginTop: 16,
    backgroundColor: theme.surface,
    borderRadius: theme.radiusMd,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 14,
  },
  sectionTitle: {
    fontSize: theme.textSm,
    fontWeight: '700',
    color: theme.textStrong,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 12,
  },
  rowLabel: {
    fontSize: theme.textSm,
    color: theme.muted,
  },
  rowValue: {
    fontSize: theme.textSm,
    color: theme.text,
    fontWeight: '500',
    textAlign: 'right',
    flexShrink: 1,
  },
  rowDanger: {
    color: theme.danger,
    fontWeight: '700',
  },
  rowWarning: {
    color: theme.warning,
    fontWeight: '700',
  },
  description: {
    fontSize: theme.textBase,
    color: theme.text,
    lineHeight: 22,
  },
});
