import { redirect } from 'next/navigation';
import { getSession } from '@/src/lib/session';
import { LoginForm } from './login-form';

export const metadata = { title: 'Giriş — TeknikFlow' };

/**
 * Faz 03 — /login: oturum açma.
 * Zaten oturumlu kullanıcı doğrudan genel bakışa gider.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const session = await getSession();
  if (session) {
    redirect('/app/overview');
  }
  const params = await searchParams;
  return (
    <main className="auth-scene">
      <LoginForm preselectedSlug={params?.workspace} />
    </main>
  );
}
