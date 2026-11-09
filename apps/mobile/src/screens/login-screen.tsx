import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { WorkspaceSummary } from '@teknikflow/contracts';
import { useSession } from '../session/session-context';
import { theme } from '../theme';

/**
 * Faz 07 — giriş ekranı. Parola alanı güvenli giriştir (secureTextEntry);
 * çoklu üyelikte çalışma alanı seçimi sunulur; hata mesajları API zarfından
 * (giriş hatası kiracı sayımına izin vermez — genel mesaj sunucudan gelir).
 */

export function LoginScreen({ testIDPrefix = 'login' }: { testIDPrefix?: string }) {
  const { actions, workspaces, lastError, status } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submitting = status === 'signing-in';

  if (workspaces) {
    return (
      <WorkspaceChooser
        workspaces={workspaces}
        submitting={submitting}
        onSelect={(slug) => {
          void actions.login({ email, password, tenantSlug: slug });
        }}
        onCancel={actions.dismissWorkspaces}
        testIDPrefix={testIDPrefix}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>TeknikFlow</Text>
        <Text style={styles.subtitle}>Teknisyen uygulaması — hesabınızla giriş yapın</Text>

        {lastError ? (
          <View
            style={styles.errorBox}
            testID={`${testIDPrefix}-error`}
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.errorText}>{lastError}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>E-posta</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="ornek@sirket.com"
          placeholderTextColor={theme.placeholder}
          testID={`${testIDPrefix}-email`}
          editable={!submitting}
          accessibilityLabel="E-posta"
        />

        <Text style={styles.label}>Parola</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          placeholder="••••••••"
          placeholderTextColor={theme.placeholder}
          testID={`${testIDPrefix}-password`}
          editable={!submitting}
          accessibilityLabel="Parola"
          onSubmitEditing={() => void actions.login({ email, password })}
        />

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={() => void actions.login({ email, password })}
          disabled={submitting || email.length === 0 || password.length === 0}
          testID={`${testIDPrefix}-submit`}
          accessibilityRole="button"
          accessibilityLabel="Giriş yap"
        >
          <Text style={styles.buttonText}>{submitting ? 'Giriş yapılıyor…' : 'Giriş yap'}</Text>
        </Pressable>

        <Text style={styles.hint}>
          Oturum bilgileri cihazın güvenli deposunda saklanır; parola sunucu dışına gönderilmez.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function WorkspaceChooser({
  workspaces,
  submitting,
  onSelect,
  onCancel,
  testIDPrefix,
}: {
  workspaces: WorkspaceSummary[];
  submitting: boolean;
  onSelect(slug: string): void;
  onCancel(): void;
  testIDPrefix: string;
}) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.logo}>Çalışma alanı seçin</Text>
      <Text style={styles.subtitle}>
        Birden çok işletmede üyeliğiniz var — hangisinde çalışacaksınız?
      </Text>
      {workspaces.map((workspace) => (
        <Pressable
          key={workspace.tenantId}
          style={styles.workspaceCard}
          onPress={() => onSelect(workspace.tenantSlug)}
          disabled={submitting}
          testID={`${testIDPrefix}-workspace-${workspace.tenantSlug}`}
          accessibilityRole="button"
          accessibilityLabel={`${workspace.tenantName} alanına gir`}
        >
          <Text style={styles.workspaceName}>{workspace.tenantName}</Text>
          <Text style={styles.workspaceRole}>{workspace.roleName}</Text>
        </Pressable>
      ))}
      <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Seçimi iptal et">
        <Text style={styles.cancelText}>Geri dön</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.canvas },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: theme.canvas,
  },
  logo: {
    fontSize: 28,
    fontWeight: '700',
    color: theme.ink900,
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 24,
    fontSize: theme.textSm,
    color: theme.muted,
  },
  errorBox: {
    backgroundColor: theme.dangerBg,
    borderRadius: theme.radiusSm,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    color: theme.danger,
    fontSize: theme.textSm,
    fontWeight: '500',
  },
  label: {
    fontSize: theme.textSm,
    fontWeight: '600',
    color: theme.textStrong,
    marginBottom: 6,
  },
  input: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: theme.textBase,
    color: theme.text,
    marginBottom: 14,
  },
  button: {
    backgroundColor: theme.blue600,
    borderRadius: theme.radiusMd,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: theme.onAccent,
    fontSize: theme.textBase,
    fontWeight: '700',
  },
  hint: {
    marginTop: 18,
    fontSize: theme.textXs,
    color: theme.subtle,
    lineHeight: 18,
  },
  workspaceCard: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    padding: 16,
    marginBottom: 10,
  },
  workspaceName: {
    fontSize: theme.textBase,
    fontWeight: '600',
    color: theme.text,
  },
  workspaceRole: {
    marginTop: 2,
    fontSize: theme.textSm,
    color: theme.muted,
  },
  cancelText: {
    marginTop: 8,
    textAlign: 'center',
    color: theme.blue700,
    fontSize: theme.textSm,
    fontWeight: '600',
    padding: 12,
  },
});
