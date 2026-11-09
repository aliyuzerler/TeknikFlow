import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionView, WorkspaceSummary } from '@teknikflow/contracts';
import type { MobileApiClient } from '../api/client';
import type { SecureTokenStore, SessionMeta } from './token-store';

/**
 * Faz 07 — oturum bağlamı (tenant farkında; ADR-0002 mobil akışı).
 *
 * Durumlar: booting → (signed-out | signed-in). Bootstrap: depodan token
 * oku → erişim tokenı geçerliyse me(); değilse refresh; refresh de
 * geçersizse temizle. AĞ HATASI token geçersizliği DEĞİLDİR — son meta
 * ile çevrimdışı oturum sürer (uygulama yeniden açma kabulü).
 */

export type SessionStatus = 'booting' | 'signed-out' | 'signing-in' | 'signed-in';

export interface SessionState {
  status: SessionStatus;
  meta: SessionMeta | null;
  /** Çoklu üyelik: seçim bekleniyor. */
  workspaces: WorkspaceSummary[] | null;
  /** Bootstrap/paket işlemlerinde son hata (giriş ekranına taşınır). */
  lastError: string | null;
}

export interface SessionActions {
  login(input: { email: string; password: string; tenantSlug?: string }): Promise<boolean>;
  logout(): Promise<void>;
  /** Oturumu yerel olarak düşürür (auth kaybedildi callback'i). */
  forceSignOut(): Promise<void>;
  dismissWorkspaces(): void;
  clearError(): void;
}

export interface SessionContextValue extends SessionState {
  actions: SessionActions;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function errorMessage(error: { kind: string; message: string }): string {
  if (error.kind === 'network' || error.kind === 'timeout') {
    return 'Sunucuya ulaşılamadı — bağlantınızı kontrol edin';
  }
  if (error.kind === 'contract') {
    return 'Sunucu yanıtı beklenmedik — uygulamayı güncelleyin';
  }
  // HTTP: zarf mesajı (INVALID_CREDENTIALS, RATE_LIMITED vb. kullanıcı-dostu).
  return error.message;
}

function metaFromMe(me: {
  user: { userId: string; displayName: string; email: string };
  membership: { tenantId: string; tenantName: string; roleKey: string };
}): SessionMeta {
  return {
    userId: me.user.userId,
    tenantId: me.membership.tenantId,
    displayName: me.user.displayName,
    email: me.user.email,
    tenantName: me.membership.tenantName,
    roleKey: me.membership.roleKey,
  };
}

export interface SessionProviderProps {
  api: MobileApiClient;
  tokens: SecureTokenStore;
  /** Oturum kapandığında yerel veriyi temizler (cache temizliği App'ten). */
  onSignedOut?: () => void | Promise<void>;
  children: React.ReactNode;
}

export function SessionProvider({ api, tokens, onSignedOut, children }: SessionProviderProps) {
  const [state, setState] = useState<SessionState>({
    status: 'booting',
    meta: null,
    workspaces: null,
    lastError: null,
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const clearLocal = async (): Promise<void> => {
    await tokens.clear();
    if (onSignedOut) await onSignedOut();
  };

  // Bootstrap: token varsa oturumu doğrula; yoksa giriş ekranı.
  useEffect(() => {
    void (async () => {
      const refreshToken = await tokens.getRefreshToken();
      const accessToken = await tokens.getAccessToken();
      if (!refreshToken || !accessToken) {
        await tokens.clear();
        if (mounted.current)
          setState({ status: 'signed-out', meta: null, workspaces: null, lastError: null });
        return;
      }

      // 1) Son bilinen kimlik — ağ yoksa bile gösterilir (dürüst çevrimdışı açılış).
      const cachedMeta = await tokens.getMeta();

      // 2) me() ile doğrula; 401/contract → refresh yolu.
      const me = await api.me();
      if (me.ok) {
        const meta = metaFromMe(me.data);
        await tokens.saveMeta(meta);
        if (mounted.current) {
          setState({ status: 'signed-in', meta, workspaces: null, lastError: null });
        }
        return;
      }

      if (me.error.kind === 'network' || me.error.kind === 'timeout') {
        // Çevrimdışı açılış: oturum korunur (sunucu doğrulaması bağlantıda tamamlanır).
        if (mounted.current) {
          setState({ status: 'signed-in', meta: cachedMeta, workspaces: null, lastError: null });
        }
        return;
      }

      // 401: client refresh'i zaten denedi ve başaramadı → tokenlar geçersiz.
      await clearLocal();
      if (mounted.current) {
        setState({ status: 'signed-out', meta: null, workspaces: null, lastError: null });
      }
    })();
  }, []);

  const actions = useMemo<SessionActions>(
    () => ({
      async login(input) {
        setState((s) => ({ ...s, status: 'signing-in', lastError: null }));
        const result = await api.login(input);
        if (!result.ok) {
          setState((s) => ({
            ...s,
            status: 'signed-out',
            lastError: errorMessage(result.error),
          }));
          return false;
        }
        if ('selectionRequired' in result.data) {
          const workspaces = result.data.workspaces;
          setState((s) => ({ ...s, status: 'signed-out', workspaces }));
          return false;
        }
        const data = result.data;
        await tokens.saveTokens({
          accessToken: data.accessToken,
          accessTokenExpiresAt: data.accessTokenExpiresAt,
          refreshToken: data.refreshToken,
          refreshTokenExpiresAt: data.refreshTokenExpiresAt,
        });
        const meta: SessionMeta = {
          userId: data.user.userId,
          tenantId: data.membership.tenantId,
          displayName: data.user.displayName,
          email: data.user.email,
          tenantName: data.membership.tenantName,
          roleKey: data.membership.roleKey,
        };
        await tokens.saveMeta(meta);
        setState({ status: 'signed-in', meta, workspaces: null, lastError: null });
        return true;
      },

      async logout() {
        const refreshToken = await tokens.getRefreshToken();
        if (refreshToken) {
          // Best-effort: sunucu erişilemezse de yerel oturum kapanır;
          // refresh token sunucuda aktif kalır (sonraki girişte çakışmaz).
          await api.logout(refreshToken);
        }
        await clearLocal();
        setState({ status: 'signed-out', meta: null, workspaces: null, lastError: null });
      },

      async forceSignOut() {
        await clearLocal();
        setState({ status: 'signed-out', meta: null, workspaces: null, lastError: null });
      },

      dismissWorkspaces() {
        setState((s) => ({ ...s, workspaces: null }));
      },

      clearError() {
        setState((s) => ({ ...s, lastError: null }));
      },
    }),
    [],
  );

  const value = useMemo<SessionContextValue>(() => ({ ...state, actions }), [state, actions]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession, SessionProvider içinde kullanılmalı');
  return ctx;
}

/** Ekranlar için tür dostu yardımcılar. */
export function isSessionView(value: SessionView): boolean {
  return value.kind === 'MOBILE' || value.kind === 'WEB';
}
