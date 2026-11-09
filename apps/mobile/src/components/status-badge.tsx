import { StyleSheet, Text, View } from 'react-native';
import type { WorkOrderView } from '@teknikflow/contracts';
import { theme } from '../theme';

/**
 * Faz 07 — durum/öncelik rozetleri. Sözlük, web sözleşmesindeki UI etiket
 * haritalarıyla aynı değerleri taşır (WORK_ORDER_STATUS_LABELS).
 */

const STATUS_LABELS: Record<WorkOrderView['status'], string> = {
  DRAFT: 'Taslak',
  PLANNED: 'Planlandı',
  ASSIGNED: 'Atandı',
  ACCEPTED: 'Kabul',
  EN_ROUTE: 'Yolda',
  ON_SITE: 'Yerinde',
  IN_PROGRESS: 'Devam',
  WAITING_PARTS: 'Parça bekleniyor',
  WAITING_CUSTOMER: 'Müşteri bekleniyor',
  COMPLETED: 'Tamamlandı',
  CLOSED: 'Kapatıldı',
  CANCELLED: 'İptal',
};

const STATUS_TONES: Record<WorkOrderView['status'], { bg: string; fg: string }> = {
  DRAFT: { bg: theme.bgSubtle ?? theme.border, fg: theme.textStrong },
  PLANNED: { bg: theme.infoBg, fg: theme.info },
  ASSIGNED: { bg: theme.blue100, fg: theme.blue700 },
  ACCEPTED: { bg: theme.blue100, fg: theme.blue700 },
  EN_ROUTE: { bg: theme.blue100, fg: theme.blue700 },
  ON_SITE: { bg: theme.successBg, fg: theme.success },
  IN_PROGRESS: { bg: theme.successBg, fg: theme.success },
  WAITING_PARTS: { bg: theme.warningBg, fg: theme.warning },
  WAITING_CUSTOMER: { bg: theme.warningBg, fg: theme.warning },
  COMPLETED: { bg: theme.successBg, fg: theme.success },
  CLOSED: { bg: theme.border, fg: theme.muted },
  CANCELLED: { bg: theme.dangerBg, fg: theme.danger },
};

const PRIORITY_LABELS: Record<WorkOrderView['priority'], string> = {
  URGENT: 'Acil',
  HIGH: 'Yüksek',
  MEDIUM: 'Normal',
  LOW: 'Düşük',
};

const PRIORITY_TONES: Record<WorkOrderView['priority'], { bg: string; fg: string }> = {
  URGENT: { bg: theme.dangerBg, fg: theme.danger },
  HIGH: { bg: theme.warningBg, fg: theme.warning },
  MEDIUM: { bg: theme.infoBg, fg: theme.info },
  LOW: { bg: theme.bgSubtle ?? theme.border, fg: theme.textStrong },
};

export function StatusBadge({
  status,
  priority,
}: {
  status?: WorkOrderView['status'];
  priority?: WorkOrderView['priority'];
}) {
  if (!status && !priority) return null;
  const kind = status ?? priority!;
  const tone = status ? STATUS_TONES[status] : PRIORITY_TONES[kind as WorkOrderView['priority']];
  const label = status ? STATUS_LABELS[status] : PRIORITY_LABELS[kind as WorkOrderView['priority']];
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]} accessibilityRole="text">
      <Text style={[styles.text, { color: tone.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: theme.textXs,
    fontWeight: '600',
  },
});
