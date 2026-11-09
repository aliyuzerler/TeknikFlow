'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Button, FormField, Logo } from '@teknikflow/ui-web';

/**
 * Faz 03 — kimlik formu iskeleti (login/signup/davet kabulünde ortak).
 * İstemci tarafında yalnız temel UX doğrulaması; gerçek doğrulama API'de
 * (Zod) — istemci güvenilen yüzey DEĞİLDİR.
 */

export type AuthFormMode = 'login' | 'signup' | 'invite';

export interface AuthFormValues {
  email: string;
  password: string;
  displayName?: string;
  tenantName?: string;
}

export interface AuthFormOutcome {
  ok: boolean;
  /** API'nin insan-okur hatası (zarftan) ya da istemci hatası. */
  error?: string;
}

export interface AuthFormProps {
  mode: AuthFormMode;
  title: string;
  subtitle?: string;
  submitLabel: string;
  /** Doluysa: çoklu kiracı seçim listesi (login). */
  workspaces?: Array<{
    tenantSlug: string;
    tenantName: string;
    roleName: string;
  }>;
  onSelectWorkspace?: (tenantSlug: string) => void;
  /** Seçim listesi görünümünde form yoktur — onSubmit opsiyoneldir. */
  onSubmit?: (values: AuthFormValues) => Promise<AuthFormOutcome>;
  footer?: ReactNode;
  /** Davet akışında e-posta bilinir → sabit gösterilir. */
  fixedEmail?: string;
}

export function AuthForm({
  mode,
  title,
  subtitle,
  submitLabel,
  workspaces,
  onSelectWorkspace,
  onSubmit,
  footer,
  fixedEmail,
}: AuthFormProps) {
  const [email, setEmail] = useState(fixedEmail ?? '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isInvite = mode === 'invite';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!onSubmit) return;

    // Temel UX kontrolleri (güvenlik değil, dostça hız — gerçek denetim API'de).
    const needsStrongPassword = isInvite || mode === 'signup';
    const next: Record<string, string> = {};
    if (!isInvite && !fixedEmail && email.length < 5) next.email = 'E-posta gerekli';
    if (!isInvite && !fixedEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      next.email = next.email ?? 'Geçerli bir e-posta girin';
    }
    if (needsStrongPassword && password.length < 10) {
      next.password = 'En az 10 karakter';
    } else if (!needsStrongPassword && password.length < 1) {
      next.password = 'Parola gerekli';
    }
    if (mode === 'signup' && displayName.trim().length < 2) next.displayName = 'Ad soyad gerekli';
    if (mode === 'signup' && tenantName.trim().length < 2) next.tenantName = 'Firma adı gerekli';
    setFieldErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    const outcome = await onSubmit({
      email: fixedEmail ?? email.trim().toLowerCase(),
      password,
      displayName: displayName.trim() || undefined,
      tenantName: tenantName.trim() || undefined,
    });
    setBusy(false);
    if (!outcome.ok && outcome.error) {
      setError(outcome.error);
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-card__brand">
        <Logo size={40} />
      </div>
      <h1 className="auth-card__title">{title}</h1>
      {subtitle ? <p className="auth-card__subtitle">{subtitle}</p> : null}

      {workspaces && workspaces.length > 0 ? (
        <div className="auth-workspaces">
          <p className="auth-card__subtitle">Birden fazla çalışma alanınız var — seçin:</p>
          <ul className="auth-workspaces__list">
            {workspaces.map((workspace) => (
              <li key={workspace.tenantSlug}>
                <button
                  type="button"
                  className="auth-workspace"
                  onClick={() => onSelectWorkspace?.(workspace.tenantSlug)}
                >
                  <span className="auth-workspace__name">{workspace.tenantName}</span>
                  <span className="auth-workspace__role">{workspace.roleName}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          {error ? <Alert variant="danger" title={error} /> : null}

          {mode === 'signup' ? (
            <>
              <FormField label="Firma adı" required error={fieldErrors.tenantName}>
                {(ids) => (
                  <input
                    name="tenantName"
                    autoComplete="organization"
                    value={tenantName}
                    onChange={(e) => setTenantName(e.target.value)}
                    {...ids}
                  />
                )}
              </FormField>
              <FormField label="Ad soyad" required error={fieldErrors.displayName}>
                {(ids) => (
                  <input
                    name="displayName"
                    autoComplete="name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    {...ids}
                  />
                )}
              </FormField>
            </>
          ) : null}

          {!fixedEmail ? (
            <FormField label="E-posta" required error={fieldErrors.email}>
              {(ids) => (
                <input
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  {...ids}
                />
              )}
            </FormField>
          ) : null}

          <FormField
            label={isInvite ? 'Parola oluştur' : 'Parola'}
            required
            error={fieldErrors.password}
            hint={isInvite ? 'En az 10 karakter; harf ve rakam içermeli' : undefined}
          >
            {(ids) => (
              <input
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                {...ids}
              />
            )}
          </FormField>

          <Button type="submit" disabled={busy} className="auth-card__submit">
            {busy ? 'Lütfen bekleyin…' : submitLabel}
          </Button>
        </form>
      )}

      {footer ? <div className="auth-card__footer">{footer}</div> : null}
    </div>
  );
}
