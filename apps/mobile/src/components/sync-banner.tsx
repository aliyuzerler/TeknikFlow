import { StyleSheet, Text, View } from 'react-native';
import type { SyncStatus } from '../sync/sync-context';
import { formatSyncedAt } from '../lib/format';
import { theme } from '../theme';

/**
 * Faz 07 — senkron durum şeridi (ADR-0004 §6). Durum dürüsttür:
 * offline/queued/syncing/synced/error; asla sahte "senkronize" gösterilmez.
 */

const CONTENT: Record<SyncStatus, { text: string; bg: string; fg: string }> = {
  idle: { text: 'Hazır', bg: theme.bgSubtle ?? theme.border, fg: theme.textStrong },
  syncing: { text: 'Senkronize ediliyor…', bg: theme.infoBg, fg: theme.info },
  synced: { text: 'Güncel', bg: theme.successBg, fg: theme.success },
  offline: { text: 'Çevrimdışı — önbellek gösteriliyor', bg: theme.warningBg, fg: theme.warning },
  error: { text: 'Senkron hatası', bg: theme.dangerBg, fg: theme.danger },
};

export function SyncBanner({
  status,
  lastSyncAt,
  pendingCount,
  error,
  testID,
}: {
  status: SyncStatus;
  lastSyncAt: string | null;
  pendingCount: number;
  error: string | null;
  testID?: string;
}) {
  const content = CONTENT[status];
  const parts = [content.text];
  if (status === 'synced' && lastSyncAt) parts.push(formatSyncedAt(lastSyncAt));
  if (pendingCount > 0) parts.push(`${pendingCount} işlem kuyrukta`);
  if (status === 'error' && error) parts.push(error);
  return (
    <View style={[styles.banner, { backgroundColor: content.bg }]} testID={testID} accessible>
      <Text style={[styles.text, { color: content.fg }]}>{parts.join(' · ')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radiusSm,
  },
  text: {
    fontSize: theme.textSm,
    fontWeight: '500',
  },
});
