import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from 'storybook/test';
import {
  AppShell,
  PageHeader,
  MetricCard,
  Panel,
  DataTable,
  StatusBadge,
  Avatar,
  ProgressBar,
  Button,
  type NavSection,
  type DataTableColumn,
} from '../index.js';
import { Icon } from '../icons.js';

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Çalışma alanı',
    items: [
      { id: 'overview', label: 'Genel Bakış', icon: 'overview', href: '#overview' },
      { id: 'work-orders', label: 'İş Emirleri', icon: 'work-orders', count: 12 },
      { id: 'dispatch', label: 'Planlama & Dispatch', icon: 'dispatch' },
      { id: 'customers', label: 'Müşteriler', icon: 'customers' },
      { id: 'assets', label: 'Makine & Ekipman', icon: 'assets' },
      { id: 'map', label: 'Harita & Saha', icon: 'map' },
    ],
  },
  {
    label: 'Operasyon',
    items: [
      { id: 'team', label: 'Ekip & Teknisyenler', icon: 'team' },
      { id: 'inventory', label: 'Depo & Parçalar', icon: 'warehouse' },
      { id: 'maintenance', label: 'Periyodik Bakım', icon: 'maintenance' },
      { id: 'quotes', label: 'Teklifler & Masraflar', icon: 'quotes' },
      { id: 'reports', label: 'Raporlar', icon: 'reports' },
    ],
  },
  {
    label: 'Yönetim',
    items: [
      { id: 'settings', label: 'Ayarlar', icon: 'settings' },
      { id: 'billing', label: 'Abonelik & Kullanım', icon: 'billing' },
    ],
  },
];

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

const meta = {
  title: 'Kabuk/AppShell',
  component: AppShell,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    navSections: NAV_SECTIONS,
    activeId: 'overview',
    user: { name: 'Ali Yılmaz', role: 'Firma Yöneticisi', initials: 'AY' },
    children: null,
  },
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;
function ShellContent() {
  return (
    <>
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

      <section className="tf-grid" aria-label="Günlük operasyon metrikleri">
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
      </section>

      <div className="tf-section-grid">
        <Panel
          title="Son iş emirleri"
          subtitle="Güncel servis operasyonları"
          actions={
            <a className="tf-link" href="#all">
              Tümünü görüntüle →
            </a>
          }
          footer="Demo verileri · Örnek operasyon ekranı"
        >
          <DataTable
            columns={COLUMNS}
            rows={ROWS}
            getKey={(row) => row.code}
            aria-label="Son iş emirleri"
          />
        </Panel>

        <div className="tf-stack tf-stack--two">
          <Panel
            title="SLA ve zaman uyarıları"
            subtitle="Aksiyon bekleyen işler"
            actions={
              <a className="tf-link" href="#sla">
                Gör →
              </a>
            }
          >
            <div style={{ padding: '4px 18px 12px' }}>
              {(
                [
                  ['red', '10:45', '#TF-0839 · Anadolu Tekstil', 'Yanıt süresi dolmak üzere'],
                  ['amber', '11:20', '#TF-0835 · Erdem Plastik', 'Atama yapılmadı'],
                  ['amber', '13:00', '#TF-0829 · Kent Otel', 'Bakım penceresi yaklaşıyor'],
                ] as const
              ).map(([dot, time, title, note]) => (
                <div key={title} className="tf-sla-item">
                  <span className={`tf-dot ${dot === 'red' ? 'tf-dot--red' : ''}`} />
                  <span className="tf-sla-time">{time}</span>
                  <span className="tf-sla-info">
                    <strong>{title}</strong>
                    <small>{note}</small>
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Saha ekibi"
            subtitle="Bugünkü iş yükü"
            actions={
              <a className="tf-link" href="#team">
                Ekip →
              </a>
            }
          >
            <div style={{ padding: '6px 18px 14px' }}>
              {(
                [
                  ['Mehmet Kaya', '3 iş · 1 sahada', 'MK', 'blue', 76],
                  ['Can Demir', '2 iş · Parça bekliyor', 'CD', 'green', 48],
                  ['Ayşe Tunç', '4 iş · 1 tamamlandı', 'AT', 'pink', 88],
                ] as const
              ).map(([name, note, initials, tone, value]) => (
                <div
                  key={name}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0' }}
                >
                  <Avatar initials={initials} tone={tone} />
                  <div>
                    <b style={{ fontSize: 13 }}>{name}</b>
                    <small style={{ display: 'block', color: 'var(--tf-subtle)', fontSize: 12 }}>
                      {note}
                    </small>
                  </div>
                  <ProgressBar value={value} label={`${name} iş yükü`} />
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

/**
 * design/preview.html'in bileşenlerle birebir yeniden üretimi.
 * (Veriler DEMO'dur — üretim veri yollarında sahte veri yoktur.)
 */
export const TasarimOnizlemesi: Story = {
  name: 'Yönetim Paneli Önizlemesi (1440px)',
  parameters: {
    viewport: { defaultViewport: 'desktop' },
    docs: { description: { story: 'design/preview.html yeniden üretimi — demo verilerle.' } },
  },
  render: () => (
    <AppShell
      navSections={NAV_SECTIONS}
      activeId="overview"
      user={{ name: 'Ali Yılmaz', role: 'Firma Yöneticisi', initials: 'AY' }}
      crumbs={[{ label: 'Atlas Teknik Servis' }, { label: 'Genel Bakış' }]}
    >
      <ShellContent />
    </AppShell>
  ),
};

/** Mobil kırılım: kenar çubuğu gizli, hamburger menü çekmecesi. */
export const MobilGorunum: Story = {
  name: 'Mobil Görünüm (390px)',
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  render: () => (
    <AppShell
      navSections={NAV_SECTIONS}
      activeId="overview"
      user={{ name: 'Ali Yılmaz', role: 'Firma Yöneticisi', initials: 'AY' }}
      crumbs={[{ label: 'Atlas Teknik Servis' }, { label: 'Genel Bakış' }]}
    >
      <ShellContent />
    </AppShell>
  ),
};

/** Etkileşim: hamburger menü açılır, çekmecede gezinme çalışır. */
export const Etkilesim: Story = {
  tags: ['test'],
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'mobile1' } },
  render: () => {
    const [navigated, setNavigated] = useState('');
    return (
      <AppShell
        navSections={NAV_SECTIONS}
        activeId="overview"
        user={{ name: 'Ali Yılmaz', role: 'Firma Yöneticisi', initials: 'AY' }}
        onNavigate={(item) => setNavigated(item.label)}
      >
        <p>{navigated ? `Gezindi: ${navigated}` : 'Kabuk etkileşim testi'}</p>
      </AppShell>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const menu = canvas.getByRole('button', { name: 'Menüyü aç' });
    await expect(menu).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(menu);
    const drawer = canvas.getByRole('dialog', { name: 'Menü' });
    await expect(drawer).toBeInTheDocument();

    // Gelecek-faz öğesi çekmecede tıklanabilir ve onNavigate çalışır.
    // (Masaüstü kenar çubuğu DOM'da kalır ama CSS ile gizlidir; sorgu çekmeceye kısıtlanır.)
    const drawerScope = within(drawer);
    await userEvent.click(drawerScope.getByRole('button', { name: /İş Emirleri/ }));
    await expect(canvas.getByText('Gezindi: İş Emirleri')).toBeInTheDocument();
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument();
  },
};
