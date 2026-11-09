import type { Meta, StoryObj } from '@storybook/react';
import { Card, Panel } from './card.js';
import { MetricCard } from './metric-card.js';
import { Icon } from '../icons.js';
import { StatusBadge } from './status-badge.js';

const meta = {
  title: 'Yapı/Kart ve Panel',
  component: Card,
  args: { children: 'Kart içeriği' },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Kart: Story = {
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <Card style={{ padding: 20 }}>
        <strong>Servis sözleşmesi</strong>
        <p style={{ color: 'var(--tf-muted)', margin: '6px 0 0' }}>
          Yıllık periyodik bakım — 12 ziyaret, SLA 8 saat.
        </p>
      </Card>
    </div>
  ),
};

export const PanelOrnegi: Story = {
  render: () => (
    <div style={{ maxWidth: 640 }}>
      <Panel
        title="Son iş emirleri"
        subtitle="Güncel servis operasyonları"
        actions={
          <a className="tf-link" href="#tumunu-gor">
            Tümünü görüntüle →
          </a>
        }
        footer="Demo verileri · Örnek operasyon ekranı"
      >
        <p style={{ padding: '12px 18px', margin: 0, color: 'var(--tf-muted)' }}>
          Panel gövdesi — tablo, liste veya herhangi bir içerik.
        </p>
      </Panel>
    </div>
  ),
};

export const MetrikKartlari: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0,1fr))',
        gap: 14,
        maxWidth: 1100,
      }}
    >
      <MetricCard
        label="Açık iş emirleri"
        value={48}
        delta="↑ 12%"
        deltaNote="geçen haftaya göre"
        icon={<Icon name="work-orders" size={16} />}
      />
      <MetricCard
        label="Bugünkü ziyaretler"
        value={26}
        delta="18 planlandı"
        deltaNote="· 8 devam ediyor"
        tone="green"
        icon={<Icon name="pin" size={16} />}
      />
      <MetricCard
        label="SLA riski"
        value={5}
        note="2 kritik · 3 uyarı"
        tone="amber"
        icon={<Icon name="clock" size={16} />}
      />
      <MetricCard
        label="Aktif teknisyen"
        value={14}
        valueSuffix=" / 18"
        delta="78%"
        deltaNote="saha kapasitesi"
        tone="violet"
        icon={<Icon name="users" size={16} />}
      />
    </div>
  ),
};

export const PaneldeRozetler: Story = {
  render: () => (
    <div style={{ maxWidth: 640 }}>
      <Panel title="Durum rozetleri panelde" subtitle="Renk + metin + ikon üçlüsü">
        <div style={{ display: 'flex', gap: 10, padding: '14px 18px', flexWrap: 'wrap' }}>
          <StatusBadge tone="blue">Sahada</StatusBadge>
          <StatusBadge tone="amber">Parça bekliyor</StatusBadge>
          <StatusBadge tone="green">Tamamlandı</StatusBadge>
          <StatusBadge tone="red">SLA riski</StatusBadge>
        </div>
      </Panel>
    </div>
  ),
};
