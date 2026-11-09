import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import '@teknikflow/design-tokens/tokens.css';
import '@teknikflow/ui-web/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'TeknikFlow — Saha Servis ve Operasyon Yönetimi',
  description:
    'TeknikFlow çok kiracılı teknik servis platformu — web paneli, tasarım sistemi ve operasyon kabuğu',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
