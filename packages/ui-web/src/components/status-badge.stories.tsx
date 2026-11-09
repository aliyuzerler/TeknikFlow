import type { Meta, StoryObj } from '@storybook/react';
import { StatusBadge } from './status-badge.js';
import { Icon } from '../icons.js';

const meta = {
  title: 'Temel/Durum Rozeti (StatusBadge)',
  component: StatusBadge,
  args: { children: 'Sahada' },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Varsayilan: Story = {
  args: { tone: 'blue' },
};

/** Marka sesi: eylem odaklı Türkçe durum etiketleri (docs/BRAND.md). */
export const TumTonlar: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <StatusBadge tone="blue">Atandı</StatusBadge>
      <StatusBadge tone="blue">Sahada</StatusBadge>
      <StatusBadge tone="amber">Parça bekliyor</StatusBadge>
      <StatusBadge tone="amber">Müşteri onayı bekliyor</StatusBadge>
      <StatusBadge tone="red">SLA riski</StatusBadge>
      <StatusBadge tone="green">Tamamlandı</StatusBadge>
      <StatusBadge tone="info">Bilgi</StatusBadge>
      <StatusBadge tone="gray">Taslak</StatusBadge>
    </div>
  ),
};

export const Ikonlu: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 10 }}>
      <StatusBadge tone="green" icon={<Icon name="check" size={12} />}>
        Tamamlandı
      </StatusBadge>
      <StatusBadge tone="amber" icon={<Icon name="clock" size={12} />}>
        Parça bekliyor
      </StatusBadge>
      <StatusBadge tone="red" icon={<Icon name="alert" size={12} />}>
        SLA riski
      </StatusBadge>
    </div>
  ),
};
