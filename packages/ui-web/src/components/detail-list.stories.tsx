import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from 'storybook/test';
import { DetailList, type DetailItem } from './detail-list.js';
import { StatusBadge } from './status-badge.js';

const meta = {
  title: 'Veri/Tanım Listesi (DetailList)',
  component: DetailList,
  args: {
    label: 'Müşteri bilgileri',
    columns: 2,
    items: [] as DetailItem[],
  },
} satisfies Meta<typeof DetailList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MusteriBilgileri: Story = {
  render: (args) => (
    <DetailList
      {...args}
      items={[
        { label: 'Müşteri', children: 'Marmara Gıda Fabrikası' },
        { label: 'Tür', children: 'Firma' },
        { label: 'Vergi No', children: '1234567801' },
        { label: 'Durum', children: <StatusBadge tone="green">Etkin</StatusBadge> },
        { label: 'Fatura Adresi', children: 'Gebze OSB, 200. Sk. No:14, Kocaeli' },
        { label: 'Ekipman', children: '3 varlık' },
      ]}
    />
  ),
};

export const BosDegerler: Story = {
  name: 'Boş değerler — tire gösterir',
  render: (args) => (
    <DetailList
      {...args}
      items={[
        { label: 'Seri No', children: null },
        { label: 'Garanti', children: undefined },
        { label: 'Model', children: 'CNC-500' },
      ]}
    />
  ),
};

export const TekSutun: Story = {
  name: 'Tek sütun (dar panel)',
  args: { columns: 1 },
  render: (args) => (
    <DetailList
      {...args}
      items={[
        { label: 'Adres', children: 'Büyükdere Cad. No:87, Levent, İstanbul' },
        { label: 'Koordinat', children: '41.0811, 29.0249' },
      ]}
    />
  ),
};

export const ErisilebilirlikKuralli: Story = {
  tags: ['test'],
  render: () => (
    <DetailList
      label="Varlık bilgileri"
      items={[
        { label: 'Etiket', children: 'AST-DM001' },
        { label: 'Üretici', children: 'Bock' },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // dl semantiği + bağlam etiketi (jsdom role=list eşlemesi yok).
    await expect(canvas.getByLabelText('Varlık bilgileri')).toBeVisible();
    await expect(canvas.getByText('AST-DM001')).toBeVisible();
    await expect(canvas.getByText('Bock')).toBeVisible();
    // dt/dd eşleşmesi: terim ve değer aynı satırda.
    const term = canvas.getByText('Etiket');
    await expect(term.nextElementSibling?.textContent).toBe('AST-DM001');
  },
};
