import { redirect } from 'next/navigation';
import { getSession } from '@/src/lib/session';
import { SignupForm } from './signup-form';

export const metadata = { title: 'Kiracı Kaydı — TeknikFlow' };

/** Faz 03 — /signup: kiracı (firma) kaydı ve ilk owner hesabı. */
export default async function SignupPage() {
  const session = await getSession();
  if (session) {
    redirect('/app/overview');
  }
  return (
    <main className="auth-scene">
      <SignupForm />
    </main>
  );
}
