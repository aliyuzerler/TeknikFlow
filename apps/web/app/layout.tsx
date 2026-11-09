import type { Metadata } from 'next';
import '@teknikflow/design-tokens/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'TeknikFlow — Kurulum Durumu',
  description:
    'TeknikFlow çok kiracılı teknik servis platformu — Faz 01: çalışma alanı ve altyapı durumu',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
