import type { Meta, StoryObj } from '@storybook/react';
import { Breadcrumbs, PageHeader } from './page.js';
import { OfflineBanner, ProgressBar, SyncStatus, Avatar } from './feedback.js';
import { Button } from './button.js';
import { Logo } from '../brand/logo.js';
import { Icon } from '../icons.js';

const meta = {
  title: 'Yapı/Sayfa Yapıları ve Geri Bildirim',
  component: PageHeader,
  args: { title: 'Sayfa Başlığı' },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SayfaBasligi: Story = {
  render: () => (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <Breadcrumbs
        items={[{ label: 'Atlas Teknik Servis', href: '#' }, { label: 'Genel Bakış' }]}
      />
      <PageHeader
        eyebrow="PAZARTESİ, 9 KASIM 2026"
        title="Operasyon Genel Bakışı"
        subtitle="Bugün saha ekiplerinizde neler oluyor, birlikte takip edin."
        actions={
          <>
            <Button>＋ Yeni Talep</Button>
            <Button variant="primary">＋ İş Emri Oluştur</Button>
          </>
        }
      />
    </div>
  ),
};

export const Marka: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 28, alignItems: 'center', padding: 32, flexWrap: 'wrap' }}>
      <Logo size={34} />
      <Logo size={44} descriptor={undefined} />
      <div style={{ background: 'var(--tf-ink-950)', padding: 20, borderRadius: 12 }}>
        <Logo size={34} className="tf-logo--light" />
      </div>
    </div>
  ),
};

export const GeriBildirimler: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 18, maxWidth: 560, padding: 8 }}>
      <OfflineBanner online={false} />
      <OfflineBanner online pendingCount={3} />
      <div style={{ display: 'flex', gap: 10 }}>
        <SyncStatus state="synced" />
        <SyncStatus state="syncing" />
        <SyncStatus state="pending" pendingCount={5} />
        <SyncStatus state="error" />
      </div>
    </div>
  ),
};

export const AvatarVeIlerleme: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, padding: 8, maxWidth: 420 }}>
      {(
        [
          ['Mehmet Kaya', '3 iş · 1 sahada', 'MK', 'blue', 76],
          ['Can Demir', '2 iş · Parça bekliyor', 'CD', 'green', 48],
          ['Ayşe Tunç', '4 iş · 1 tamamlandı', 'AT', 'pink', 88],
        ] as const
      ).map(([name, meta, initials, tone, value]) => (
        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar initials={initials} tone={tone} />
          <div style={{ flex: 1 }}>
            <b style={{ fontSize: 13 }}>{name}</b>
            <div style={{ fontSize: 12, color: 'var(--tf-muted)' }}>{meta}</div>
          </div>
          <ProgressBar value={value} label={`${name} iş yükü`} />
        </div>
      ))}
    </div>
  ),
};

export const Ikoner: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: 16 }}>
      {(
        [
          'overview',
          'work-orders',
          'dispatch',
          'customers',
          'assets',
          'map',
          'team',
          'warehouse',
          'maintenance',
          'quotes',
          'reports',
          'settings',
          'billing',
          'search',
          'bell',
          'alert',
          'clock',
          'check',
          'refresh',
          'pin',
        ] as const
      ).map((name) => (
        <span key={name} title={name} style={{ display: 'grid', justifyItems: 'center', gap: 4 }}>
          <Icon name={name} size={20} />
          <small style={{ fontSize: 10, color: 'var(--tf-muted)' }}>{name}</small>
        </span>
      ))}
    </div>
  ),
};
