import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

/**
 * Faz 07 — yükleme/boş/hata durumları (AGENTS.md tasarım ilkeleri: açık
 * durumlar; sahte veri yok — hata dürüstçe bildirilir).
 */

export function LoadingView({
  label = 'Yükleniyor…',
  testID,
}: {
  label?: string;
  testID?: string;
}) {
  return (
    <View style={styles.center} testID={testID} accessible accessibilityLabel={label}>
      <ActivityIndicator color={theme.blue600} size="large" />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

export function EmptyView({
  title,
  body,
  testID,
}: {
  title: string;
  body?: string;
  testID?: string;
}) {
  return (
    <View style={styles.center} testID={testID} accessible>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  );
}

export function ErrorView({
  title = 'Bir sorun oluştu',
  detail,
  onRetry,
  testID,
}: {
  title?: string;
  detail?: string | null;
  onRetry?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.center} testID={testID} accessible>
      <Text style={[styles.title, { color: theme.danger }]}>{title}</Text>
      {detail ? <Text style={styles.body}>{detail}</Text> : null}
      {onRetry ? (
        <Text style={styles.retry} onPress={onRetry} accessibilityRole="button">
          Tekrar dene
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  title: {
    fontSize: theme.textLg,
    fontWeight: '600',
    color: theme.text,
    textAlign: 'center',
  },
  body: {
    fontSize: theme.textSm,
    color: theme.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  text: {
    marginTop: 8,
    fontSize: theme.textSm,
    color: theme.muted,
  },
  retry: {
    marginTop: 12,
    fontSize: theme.textBase,
    fontWeight: '600',
    color: theme.blue700,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
});
