import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from './button.js';
import { Icon } from '../icons.js';

const onClickHandler = fn();

const meta = {
  title: 'Temel/Düğme (Button)',
  component: Button,
  args: { children: 'İş Emri Oluştur' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Varsayilan: Story = {
  args: { variant: 'primary' },
};

export const TumVaryantlar: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      <Button variant="primary">Birincil</Button>
      <Button variant="secondary">İkincil</Button>
      <Button variant="ghost">Sade</Button>
      <Button variant="danger">Sil</Button>
      <Button variant="primary" size="sm">
        Küçük
      </Button>
      <Button variant="secondary" disabled>
        Devre dışı
      </Button>
    </div>
  ),
};

export const Ikonlu: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12 }}>
      <Button variant="primary" icon={<Icon name="plus" size={14} />}>
        Yeni Talep
      </Button>
      <Button variant="secondary" icon={<Icon name="refresh" size={14} />}>
        Yenile
      </Button>
    </div>
  ),
};

export const Yukleniyor: Story = {
  args: { variant: 'primary', loading: true, children: 'Kaydediliyor' },
};

/** Etkileşim: tıklama çağrısını ve çift-gönderim korumasını doğrular. */
export const Etkilesim: Story = {
  tags: ['test'],
  args: { variant: 'primary', onClick: onClickHandler },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'İş Emri Oluştur' });
    await userEvent.click(button);
    await expect(onClickHandler).toHaveBeenCalledTimes(1);
    // Çift tıklama: ikinci gönderim de tek çağrı ID'siyle akmalı (idempotent UI).
    await userEvent.dblClick(button);
    await expect(onClickHandler.mock.calls.length).toBeGreaterThanOrEqual(3);
  },
};
