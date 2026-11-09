import type { Meta, StoryObj } from '@storybook/react';
import { DataTable, type DataTableColumn } from './data-table.js';
import { StatusBadge } from './status-badge.js';
import { EmptyState, ErrorState, Skeleton } from './states.js';

const meta = {
  title: 'Yapı/Veri Tablosu (DataTable)',
  component: DataTable,
  args: {
    columns: [],
    rows: [],
    getKey: () => '',
  },
} satisfies Meta<typeof DataTable>;

export default meta;
type Story = StoryObj<typeof meta>;

interface WorkOrderRow {
  code: string;
  type: string;
  customer: string;
  equipment: string;
  technician: string;
  planned: string;
  status: { tone: 'blue' | 'amber' | 'green' | 'red'; label: string };
}

const ROWS: WorkOrderRow[] = [
  {
    code: '#TF-2026-0842',
    type: 'Arıza · Yüksek',
    customer: 'Marmara Gıda A.Ş.',
    equipment: 'Soğutma Kompresörü',
    technician: 'Mehmet K.',
    planned: '09:30',
    status: { tone: 'blue', label: 'Sahada' },
  },
  {
    code: '#TF-2026-0841',
    type: 'Periyodik bakım',
    customer: 'Kuzey Plaza',
    equipment: 'HVAC Santral-02',
    technician: 'Can D.',
    planned: '10:00',
    status: { tone: 'amber', label: 'Parça bekliyor' },
  },
  {
    code: '#TF-2026-0840',
    type: 'Montaj · Normal',
    customer: 'Eksen Makine',
    equipment: 'CNC Soğutma Ünitesi',
    technician: 'Ayşe T.',
    planned: '11:30',
    status: { tone: 'green', label: 'Tamamlandı' },
  },
  {
    code: '#TF-2026-0839',
    type: 'Arıza · Kritik',
    customer: 'Anadolu Tekstil',
    equipment: 'Hava Kompresörü',
    technician: 'Emre Y.',
    planned: '12:00',
    status: { tone: 'red', label: 'SLA riski' },
  },
  {
    code: '#TF-2026-0838',
    type: 'Kontrol · Düşük',
    customer: 'Mavi Lojistik',
    equipment: 'Jeneratör-01',
    technician: 'Selin A.',
    planned: '13:00',
    status: { tone: 'blue', label: 'Atandı' },
  },
];

const COLUMNS: Array<DataTableColumn<WorkOrderRow>> = [
  {
    key: 'code',
    header: 'İş emri',
    render: (row) => (
      <span className="tf-table__wo">
        {row.code}
        <div className="tf-table__sub">{row.type}</div>
      </span>
    ),
  },
  {
    key: 'customer',
    header: 'Müşteri / Ekipman',
    render: (row) => (
      <span>
        <span className="tf-table__customer">{row.customer}</span>
        <div className="tf-table__sub">{row.equipment}</div>
      </span>
    ),
  },
  { key: 'technician', header: 'Teknisyen' },
  { key: 'planned', header: 'Planlanan' },
  {
    key: 'status',
    header: 'Durum',
    render: (row) => <StatusBadge tone={row.status.tone}>{row.status.label}</StatusBadge>,
  },
];

export const Varsayilan: Story = {
  render: () => (
    <div style={{ maxWidth: 900 }}>
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        getKey={(row) => row.code}
        aria-label="Son iş emirleri"
      />
    </div>
  ),
};

export const BosDurum: Story = {
  render: () => (
    <div
      style={{
        maxWidth: 900,
        background: '#fff',
        borderRadius: 12,
        border: '1px solid var(--tf-border)',
      }}
    >
      <DataTable
        columns={COLUMNS}
        rows={[]}
        getKey={(row) => row.code}
        empty={
          <EmptyState
            title="Henüz iş emri yok"
            description="Servis talebi oluşturulduğunda iş emirleri burada listelenir."
          />
        }
      />
    </div>
  ),
};

export const Yukleniyor: Story = {
  render: () => (
    <div
      style={{
        maxWidth: 900,
        background: '#fff',
        borderRadius: 12,
        border: '1px solid var(--tf-border)',
        padding: 20,
      }}
    >
      <Skeleton variant="text" lines={1} width={180} height={16} />
      <div style={{ height: 12 }} />
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
          <Skeleton width={130} height={14} />
          <Skeleton width={210} height={14} />
          <Skeleton width={90} height={14} />
          <Skeleton width={60} height={14} />
          <Skeleton width={110} height={22} />
        </div>
      ))}
    </div>
  ),
};

export const HataDurumu: Story = {
  render: () => (
    <div
      style={{
        maxWidth: 900,
        background: '#fff',
        borderRadius: 12,
        border: '1px solid var(--tf-border)',
      }}
    >
      <ErrorState
        title="İş emirleri yüklenemedi"
        description="Sunucuya ulaşılamadı. Bağlantı geri gelince tekrar deneyin."
        onRetry={() => alert('Tekrar deneniyor (demo)')}
      />
    </div>
  ),
};
