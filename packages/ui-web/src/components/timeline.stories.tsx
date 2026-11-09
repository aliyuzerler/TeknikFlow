import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from 'storybook/test';
import { StatusBadge } from './status-badge.js';
import { Timeline, type TimelineItem } from './timeline.js';

const meta = {
  title: 'Veri/Zaman Çizelgesi (Timeline)',
  component: Timeline,
  args: {
    label: 'İş emri zaman çizelgesi',
    order: 'desc',
    emptyMessage: 'Henüz kayıt yok',
    items: [] as TimelineItem[],
  },
} satisfies Meta<typeof Timeline>;

export default meta;
type Story = StoryObj<typeof meta>;

const yasamDongusu: TimelineItem[] = [
  { id: 'e1', title: 'İş emri oluşturuldu', meta: 'Ali Yılmaz · 09:02', tone: 'neutral' },
  { id: 'e2', title: 'Planlandı', meta: 'Ali Yılmaz · 09:15', tone: 'info' },
  { id: 'e3', title: 'Atandı — Emre Yılmaz', meta: 'Ali Yılmaz · 09:20', tone: 'info' },
  {
    id: 'e4',
    title: 'Kabul edildi',
    meta: 'Emre Yılmaz · 10:05',
    tone: 'info',
    description: 'Teknisyen işi kabul etti.',
  },
  {
    id: 'e5',
    title: 'Parça bekleniyor',
    meta: 'Emre Yılmaz · 11:40',
    tone: 'warning',
    description: 'Eşanjör tedarik süresi 3 iş günü.',
  },
  { id: 'e6', title: 'Devam ediyor', meta: 'Emre Yılmaz · 14:10', tone: 'info' },
  { id: 'e7', title: 'Tamamlandı', meta: 'Emre Yılmaz · 16:30', tone: 'success' },
  { id: 'e8', title: 'Kapatıldı', meta: 'Ali Yılmaz · 17:00', tone: 'success' },
];

export const IsEmriZamanCizelgesi: Story = {
  name: 'İş emri yaşam döngüsü',
  render: (args) => <Timeline {...args} items={yasamDongusu} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // En yeni önce: "Kapatıldı" ilk kayıt.
    const items = canvas.getAllByRole('listitem');
    await expect(items[0]).toHaveTextContent('Kapatıldı');
    await expect(items.length).toBe(8);
    // Meta bilgisi görünür.
    await expect(canvas.getByText(/Emre Yılmaz · 16:30/)).toBeVisible();
  },
};

export const KronolojikSira: Story = {
  name: 'Kronolojik sıra (asc)',
  args: { order: 'asc' },
  render: (args) => <Timeline {...args} items={yasamDongusu} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const items = canvas.getAllByRole('listitem');
    await expect(items[0]).toHaveTextContent('İş emri oluşturuldu');
    await expect(items[items.length - 1]).toHaveTextContent('Kapatıldı');
  },
};

export const IptalVeBeklemeTonlari: Story = {
  name: 'İptal ve bekleme tonları',
  render: (args) => (
    <Timeline
      {...args}
      items={[
        {
          id: 'x1',
          title: 'İptal edildi — Parça temin edilemiyor',
          meta: 'Elif Demir · 12:00',
          tone: 'danger',
          description: 'Neden kodu: PARTS_UNAVAILABLE',
        },
        {
          id: 'x2',
          title: 'Müşteri bekleniyor',
          meta: 'Emre Yılmaz · 10:30',
          tone: 'warning',
        },
        {
          id: 'x3',
          title: (
            <span>Not eklendi — {<StatusBadge tone="blue">Müşteri görünür</StatusBadge>}</span>
          ),
          meta: 'Emre Yılmaz · 10:31',
          tone: 'neutral',
        },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/İptal edildi/)).toBeVisible();
    await expect(canvas.getByText('Müşteri görünür')).toBeVisible();
  },
};

export const BosDurum: Story = {
  name: 'Boş durum',
  render: (args) => <Timeline {...args} items={[]} emptyMessage="Bu iş emri için henüz olay yok" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Bu iş emri için henüz olay yok')).toBeVisible();
  },
};
