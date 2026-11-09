import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { WorkOrderView } from '@teknikflow/contracts';
import { formatScheduleWindow, slaLabel } from '../lib/format';
import { StatusBadge } from './status-badge';
import { theme } from '../theme';

/**
 * Faz 07 — gelen kutusu satırı. Tek dokunuş hedefi büyük (saha kullanımı);
 * durum + öncelik + SLA ton kodlu.
 */

export function WorkOrderCard({
  order,
  onPress,
  testID,
}: {
  order: WorkOrderView;
  onPress?: (id: string) => void;
  testID?: string;
}) {
  const sla = slaLabel(order);
  return (
    <Pressable
      style={styles.card}
      onPress={onPress ? () => onPress(order.workOrderId) : undefined}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`İş emri ${order.workOrderNo}: ${order.subject}, durum ${order.status}`}
    >
      <View style={styles.headerRow}>
        <Text style={styles.no}>{order.workOrderNo}</Text>
        <StatusBadge priority={order.priority} />
      </View>
      <Text style={styles.subject} numberOfLines={2}>
        {order.subject}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {order.customerName}
        {order.assetTag ? ` · ${order.assetTag}` : ''}
      </Text>
      <View style={styles.footerRow}>
        <StatusBadge status={order.status} />
        <Text
          style={[
            styles.sla,
            sla.tone === 'danger' && styles.slaDanger,
            sla.tone === 'warning' && styles.slaWarning,
          ]}
        >
          {sla.text}
        </Text>
      </View>
      {order.scheduledStart ? (
        <Text style={styles.schedule}>
          {formatScheduleWindow(order.scheduledStart, order.scheduledEnd)}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderRadius: theme.radiusMd,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 14,
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  no: {
    fontSize: theme.textSm,
    fontWeight: '700',
    color: theme.textStrong,
  },
  subject: {
    marginTop: 6,
    fontSize: theme.textBase,
    fontWeight: '600',
    color: theme.text,
  },
  meta: {
    marginTop: 2,
    fontSize: theme.textSm,
    color: theme.muted,
  },
  footerRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sla: {
    fontSize: theme.textXs,
    color: theme.muted,
  },
  slaDanger: {
    color: theme.danger,
    fontWeight: '600',
  },
  slaWarning: {
    color: theme.warning,
    fontWeight: '600',
  },
  schedule: {
    marginTop: 8,
    fontSize: theme.textSm,
    color: theme.textStrong,
  },
});
