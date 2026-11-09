'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthForm } from '@/src/components/auth-form';
import { signup } from '@teknikflow/api-client';
import { getClientApiBaseUrl } from '@/src/lib/client-env';

/** Faz 03 — kiracı kaydı (onboarding başlangıcı). */
export function SignupForm() {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();

  return (
    <AuthForm
      mode="signup"
      title="Firmanızı kaydedin"
      subtitle="14 gün ücretsiz deneme. Kredi kartı gerekmez."
      submitLabel="Kiracı oluştur ve başla"
      onSubmit={async (values) => {
        if (!values.tenantName || !values.displayName) {
          return { ok: false, error: 'Firma adı ve ad soyad gerekli' };
        }
        const result = await signup(
          { baseUrl: apiBaseUrl },
          {
            tenantName: values.tenantName,
            user: {
              displayName: values.displayName,
              email: values.email,
              password: values.password,
            },
          },
        );
        if (!result.ok) {
          if (result.error.code === 'EMAIL_TAKEN') {
            return { ok: false, error: 'Bu e-posta ile bir hesap zaten var — giriş yapın' };
          }
          return { ok: false, error: result.error.message };
        }
        router.push('/app/overview');
        router.refresh();
        return { ok: true };
      }}
      footer={
        <span className="auth-footer__text">
          Zaten hesabınız var mı? <Link href="/login">Giriş yapın</Link>
        </span>
      }
    />
  );
}
