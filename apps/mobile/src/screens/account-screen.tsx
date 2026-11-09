import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SessionView } from '@teknikflow/contracts';
import { ErrorView, LoadingView } from '../components/screen-states';
import type { MobileApiClient } from '../api/client';
import { formatDateTime, sessionKindLabel } from '../lib/format';
import { useSession } from '../session/session-context';
import { theme } from '../theme';

/**
 * Faz 07 — hesap ekranı: kimlik + cihaz/oturum yönetimi + çıkış.
 * "Tüm oturumları iptal et" (revoke-all) mobil refresh ailesini de
 * düşürür — kaybolan cihaz senaryosunun kabul yolu.
 */

export interface AccountScreenProps {
  api: MobileApiClient;
  testIDPrefix?: string;
}

export function AccountScreen({ api, testIDPrefix = 'account' }: AccountScreenProps) {
  const { meta, actions } = useSession();
  const [sessions, setSessions] = useState<SessionView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    setBusy(true);
    const result = await api.listSessions();
    setBusy(false);
    if (result.ok) {
      setSessions(result.data.data);
      setLoadError(null);
    } else {
      setLoadError(result.error.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function confirmRevokeAll(): void {
    Alert.alert(
      'Tüm oturumları iptal et',
      'Web ve mobil oturumların tamamı kapanır. Devam edilsin mi?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'İptal et',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const result = await api.revokeAllSessions();
              if (result.ok) {
                // Bu cihazın ailesi de düşer → yerel oturum kapanır.
                await actions.forceSignOut();
              } else {
                setLoadError(result.error.message);
              }
            })();
          },
        },
      ],
    );
  }

  function confirmSignOut(): void {
    Alert.alert('Çıkış yap', 'Yerel veriler (önbellek) silinecek. Devam edilsin mi?', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Çıkış', style: 'destructive', onPress: () => void actions.logout() },
    ]);
  }

  if (!meta) {
    return <LoadingView testID={`${testIDPrefix}-loading`} />;
  }

  return (
    <ScrollView contentContainerStyle={styles.container} testID={testIDPrefix}>
      <View style={styles.card}>
        <Text style={styles.name}>{meta.displayName}</Text>
        <Text style={styles.line}>{meta.email}</Text>
        <Text style={styles.line}>
          {meta.tenantName} · {meta.roleKey}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Oturumlar</Text>
        {loadError ? (
          <ErrorView title="Oturumlar yüklenemedi" detail={loadError} onRetry={() => void load()} />
        ) : null}
        {sessions === null && !loadError ? <LoadingView label="Oturumlar yükleniyor…" /> : null}
        {sessions?.map((session) => (
          <View
            key={session.sessionId}
            style={styles.sessionRow}
            testID={`${testIDPrefix}-session-${session.kind}`}
          >
            <Text style={styles.sessionTitle}>
              {sessionKindLabel(session.kind)}
              {session.current ? ' · bu cihaz' : ''}
            </Text>
            <Text style={styles.sessionMeta}>
              Son: {formatDateTime(session.lastUsedAt)}
              {session.revokedAt ? ' · iptal edilmiş' : ''}
            </Text>
          </View>
        ))}
      </View>

      <Pressable
        style={styles.secondaryButton}
        onPress={confirmRevokeAll}
        disabled={busy}
        testID={`${testIDPrefix}-revoke-all`}
        accessibilityRole="button"
        accessibilityLabel="Tüm oturumları iptal et"
      >
        <Text style={styles.secondaryText}>Tüm oturumları iptal et</Text>
      </Pressable>

      <Pressable
        style={styles.dangerButton}
        onPress={confirmSignOut}
        disabled={busy}
        testID={`${testIDPrefix}-signout`}
        accessibilityRole="button"
        accessibilityLabel="Çıkış yap"
      >
        <Text style={styles.dangerText}>Çıkış yap</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
    backgroundColor: theme.canvas,
  },
  card: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    padding: 14,
    marginBottom: 12,
  },
  name: {
    fontSize: theme.textLg,
    fontWeight: '700',
    color: theme.text,
  },
  line: {
    marginTop: 4,
    fontSize: theme.textSm,
    color: theme.muted,
  },
  sectionTitle: {
    fontSize: theme.textSm,
    fontWeight: '700',
    color: theme.textStrong,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  sessionRow: {
    paddingVertical: 6,
  },
  sessionTitle: {
    fontSize: theme.textBase,
    color: theme.text,
    fontWeight: '500',
  },
  sessionMeta: {
    fontSize: theme.textXs,
    color: theme.muted,
    marginTop: 2,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    borderRadius: theme.radiusMd,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  secondaryText: {
    color: theme.textStrong,
    fontWeight: '600',
    fontSize: theme.textBase,
  },
  dangerButton: {
    backgroundColor: theme.dangerBg,
    borderRadius: theme.radiusMd,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dangerText: {
    color: theme.danger,
    fontWeight: '700',
    fontSize: theme.textBase,
  },
});
