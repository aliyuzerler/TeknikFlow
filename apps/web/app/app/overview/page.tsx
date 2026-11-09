'use client';

import type { DataTableColumn } from '@teknikflow/ui-web';
import {
  Avatar,
  Button,
  DataTable,
  Icon,
  MetricCard,
  PageHeader,
  Panel,
  ProgressBar,
  StatusBadge,
} from '@teknikflow/ui-web';
import {
  DEMO_EYEBROW,
  DEMO_SLA_ITEMS,
  DEMO_TEAM,
  DEMO_WORK_ORDERS,
  type DemoWorkOrder,
} from '@/src/lib/demo-dashboard';

/**
 * GENEL BAKIŞ — Faz 02'deki tasarım önizlemesinin içerik bölümü.
 *
 * Kabuk (kenar çubuğu/üst çubuk) Faz 03'te app/layout.tsx'e taşındı ve
 * OTURUMDAN türetilir. İçerik verileri kasıtlı olarak DEMO'dur
 * (src/lib/demo-dashboard.ts — üretim veri yollarında sahte veri yoktur);
 * iş modelleri (Faz 04+) gerçek API verisiyle değiştirecektir.
 */
const COLUMNS: Array<DataTableColumn<DemoWorkOrder>> = [
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

export default function OverviewDesignPreviewPage() {
  return (
    <>
      <PageHeader
        eyebrow={DEMO_EYEBROW}
        title="Operasyon Genel Bakışı"
        subtitle="Bugün saha ekiplerinizde neler oluyor, birlikte takip edin."
        actions={
          <>
            <Button>＋ Yeni Talep</Button>
            <Button variant="primary">＋ İş Emri Oluştur</Button>
          </>
        }
      />

      <section className="tf-grid" aria-label="Günlük operasyon metrikleri (demo)">
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
          actions={<span className="tf-link">Tümünü görüntüle →</span>}
          footer="Demo verileri · Tasarım önizlemesi — gerçek veriler Faz 03+ ile API'den gelir"
        >
          <DataTable
            columns={COLUMNS}
            rows={DEMO_WORK_ORDERS}
            getKey={(row) => row.code}
            aria-label="Son iş emirleri (demo)"
          />
        </Panel>

        <div className="tf-stack tf-stack--two">
          <Panel
            title="SLA ve zaman uyarıları"
            subtitle="Aksiyon bekleyen işler"
            actions={<span className="tf-link">Gör →</span>}
          >
            <div style={{ padding: '4px 18px 12px' }}>
              {DEMO_SLA_ITEMS.map((item) => (
                <div key={item.title} className="tf-sla-item">
                  <span className={`tf-dot ${item.dot === 'red' ? 'tf-dot--red' : ''}`} />
                  <span className="tf-sla-time">{item.time}</span>
                  <span className="tf-sla-info">
                    <strong>{item.title}</strong>
                    <small>{item.note}</small>
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Saha ekibi"
            subtitle="Bugünkü iş yükü"
            actions={<span className="tf-link">Ekip →</span>}
          >
            <div style={{ padding: '6px 18px 14px' }}>
              {DEMO_TEAM.map((member) => (
                <div
                  key={member.name}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0' }}
                >
                  <Avatar initials={member.initials} tone={member.tone} />
                  <div>
                    <b style={{ fontSize: 13 }}>{member.name}</b>
                    <small style={{ display: 'block', color: 'var(--tf-subtle)', fontSize: 12 }}>
                      {member.note}
                    </small>
                  </div>
                  <ProgressBar value={member.load} label={`${member.name} iş yükü`} />
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
