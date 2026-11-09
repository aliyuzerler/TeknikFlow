import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from 'storybook/test';
import { MeterBar } from './meter-bar.js';

const meta = {
  title: 'Veri/Kapasite Göstergesi (MeterBar)',
  component: MeterBar,
  args: {
    value: 45,
    label: 'Emre Yılmaz gün yükü',
    valueText: '216 / 480 dk · %45',
  },
} satisfies Meta<typeof MeterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Varsayilan: Story = {};

export const TamDoluluk: Story = {
  name: 'Tam doluluk (%100)',
  args: { value: 100, tone: 'ok', valueText: '480 / 480 dk · %100' },
};

export const AsiriYuk: Story = {
  name: 'Aşırı yük (%140) — çubuk doyar, sayı gerçeği korur',
  args: { value: 140, tone: 'danger', valueText: '672 / 480 dk · %140' },
};

export const RiskEsigni: Story = {
  name: 'Uyarı tonu (%85)',
  args: { value: 85, tone: 'warning', valueText: '408 / 480 dk · %85' },
};

export const KucukBoy: Story = {
  name: 'Küçük boy (takım kartı)',
  args: { value: 60, size: 'sm', tone: 'info', valueText: '1.440 / 2.400 dk · %60' },
};

export const Metinsiz: Story = {
  name: 'Değer metni yok — yalnız gösterge',
  args: { value: 30, valueText: undefined },
};

export const Etkilesim: Story = {
  tags: ['test'],
  args: { value: 75, tone: 'warning', valueText: '360 / 480 dk · %75' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // role=meter duyurumu ve değerleri.
    const meter = canvas.getByRole('meter', { name: 'Emre Yılmaz gün yükü' });
    await expect(meter).toBeVisible();
    await expect(meter).toHaveAttribute('aria-valuenow', '75');
    await expect(meter).toHaveAttribute('aria-valuemin', '0');
    await expect(meter).toHaveAttribute('aria-valuemax', '100');
    await expect(meter).toHaveAttribute('aria-valuetext', '360 / 480 dk · %75');
    // Değer metni görünür.
    await expect(canvas.getByText('360 / 480 dk · %75')).toBeVisible();
  },
};

/** Aşırı yük: aria-valuenow 100'e kırpılır ama metin gerçeği taşır. */
export const AsiriYukErisilebilirlik: Story = {
  tags: ['test'],
  args: { value: 140, tone: 'danger', valueText: '672 / 480 dk · %140' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const meter = canvas.getByRole('meter', { name: 'Emre Yılmaz gün yükü' });
    await expect(meter).toHaveAttribute('aria-valuenow', '100');
    await expect(meter).toHaveAttribute('aria-valuetext', '672 / 480 dk · %140');
  },
};
