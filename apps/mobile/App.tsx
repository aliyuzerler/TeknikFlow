import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from './src/theme';

/**
 * Faz 01 yalnızca iskelet taşır. Teknisyen gelen kutusu, çevrimdışı
 * senkronizasyon ve saha akışları Faz 07-08'de eklenir.
 * Not: sahte veri/mesaj gösterilmez — durum dürüstçe bildirilir.
 */
export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.logo}>TeknikFlow</Text>
        <Text style={styles.subtitle}>Teknisyen Mobil Uygulaması</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Faz 01 — Altyapı Temeli</Text>
        <Text style={styles.cardBody}>
          Uygulama iskeleti hazır. Görev gelen kutusu, çevrimdışı iş emirleri ve saha akışları Faz
          07 ile birlikte geliştirilecek.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.canvas,
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    paddingTop: 72,
    paddingHorizontal: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    fontSize: 28,
    fontWeight: '700',
    color: theme.ink900,
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: theme.muted,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 20,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.ink900,
    marginBottom: 8,
  },
  cardBody: {
    fontSize: 14,
    color: theme.muted,
    lineHeight: 21,
  },
});
