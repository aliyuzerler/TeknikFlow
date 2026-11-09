import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from 'storybook/test';
import { Pager } from './pager.js';

const meta = {
  title: 'Veri/Sayfalama (Pager)',
  component: Pager,
  args: { page: 2, pageSize: 20, total: 95, label: 'Müşteri listesi' },
} satisfies Meta<typeof Pager>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Varsayilan: Story = {};

export const TekSayfaGizli: Story = {
  name: 'Tek sayfa → denetim gizli',
  args: { page: 1, pageSize: 20, total: 12 },
};

export const SonSayfa: Story = {
  args: { page: 5, total: 95 },
};

export const HrefTabanli: Story = {
  name: 'Bağlantı tabanlı (RSC uyumlu)',
  args: { page: 1, total: 60, hrefTemplate: '/app/customers?page={page}' },
};

export const Etkilesim: Story = {
  tags: ['test'],
  args: { page: 1, pageSize: 10, total: 35 },
  render: (args) => (
    <Pager
      {...args}
      onChange={(p) => {
        (window as unknown as { __pagerPage?: number }).__pagerPage = p;
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Bilgi metni aralığı ve toplamı taşır.
    await expect(canvas.getByText('1–10 / 35')).toBeVisible();
    // İlk sayfada önceki devre dışı.
    const prev = canvas.getByRole('button', { name: 'Önceki sayfa' });
    await expect(prev).toBeDisabled();
    // Sonraki ile sayfa 2'ye geçiş.
    await canvas.getByRole('button', { name: 'Sonraki sayfa' }).click();
    await expect((window as unknown as { __pagerPage?: number }).__pagerPage).toBe(2);
    // Geçerli sayfa bildirimi.
    await expect(canvas.getByText('1 / 4')).toHaveAttribute('aria-current', 'page');
  },
};

/** Erişilebilirlik: gezinme bölgesi etiketli; sayı unaffected. */
export const Erisilebilirlik: Story = {
  tags: ['test'],
  render: () => <Pager page={1} pageSize={10} total={25} label="Varlık listesi" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = canvas.getByRole('navigation', { name: 'Varlık listesi sayfalama' });
    await expect(nav).toBeVisible();
  },
};
