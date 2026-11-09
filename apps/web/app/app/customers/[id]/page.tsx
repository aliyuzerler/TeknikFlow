import { notFound } from 'next/navigation';
import { getSession, apiCookieHeader } from '@/src/lib/session';
import { getWebEnv } from '@/src/load-env';
import {
  DataTable,
  DetailList,
  PageHeader,
  Panel,
  StatusBadge,
  type DataTableColumn,
} from '@teknikflow/ui-web/server';
import { AddContactButton } from './add-contact';
import { AddLocationButton } from './add-location';
import { AddAssetButton } from './add-asset';

export const metadata = { title: 'Müşteri — TeknikFlow' };

/**
 * Faz 04 — /app/customers/[id]: müşteri detayı.
 * Kişiler, lokasyonlar, ekipman ve zaman çizelgesi tek sayfada;
 * her bölüm sunucu tarafında kiracı kapsamıyla sorgulanır (404 → notFound).
 */

interface CustomerDetail {
  customerId: string;
  name: string;
  customerType: 'COMPANY' | 'INDIVIDUAL';
  taxId: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  billingAddress: string | null;
}

interface ContactRow {
  contactId: string;
  name: string;
  email: string;
  phone: string | null;
}

interface LocationRow {
  locationId: string;
  name: string | null;
  address: string;
  city: string | null;
  assetCount: number;
}

interface AssetRow {
  assetId: string;
  assetTag: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  serviceLocationName: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'RETIRED';
  criticality: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface EventRow {
  eventId: string;
  eventType: string;
  assetTag: string | null;
  occurredAt: string;
}

const CONTACT_COLUMNS: Array<DataTableColumn<ContactRow>> = [
  { key: 'name', header: 'Kişi' },
  { key: 'email', header: 'E-posta' },
  {
    key: 'phone',
    header: 'Telefon',
    render: (row) => row.phone ?? '—',
  },
];

const LOCATION_COLUMNS: Array<DataTableColumn<LocationRow>> = [
  {
    key: 'name',
    header: 'Lokasyon',
    render: (row) => (
      <span className="tf-table__wo">
        {row.name ?? 'Adlandırılmamış'}
        <div className="tf-table__sub">{row.city ?? '—'}</div>
      </span>
    ),
  },
  { key: 'address', header: 'Adres' },
  { key: 'assetCount', header: 'Ekipman' },
];

const ASSET_COLUMNS: Array<DataTableColumn<AssetRow>> = [
  {
    key: 'assetTag',
    header: 'Etiket',
    render: (row) => <span className="tf-table__wo">{row.assetTag}</span>,
  },
  {
    key: 'equipment',
    header: 'Ekipman',
    render: (row) => (
      <span>
        <span className="tf-table__customer">{row.manufacturer ?? '—'}</span>
        <div className="tf-table__sub">
          {row.model ?? '—'}
          {row.serialNumber ? ` · SN: ${row.serialNumber}` : ''}
        </div>
      </span>
    ),
  },
  {
    key: 'location',
    header: 'Lokasyon',
    render: (row) => row.serviceLocationName ?? '—',
  },
  {
    key: 'criticality',
    header: 'Kritiklik',
    render: (row) => criticalityBadge(row.criticality),
  },
  {
    key: 'status',
    header: 'Durum',
    render: (row) => statusBadge(row.status),
  },
];

function criticalityBadge(level: 'LOW' | 'MEDIUM' | 'HIGH') {
  if (level === 'HIGH') return <StatusBadge tone="red">Yüksek</StatusBadge>;
  if (level === 'MEDIUM') return <StatusBadge tone="amber">Orta</StatusBadge>;
  return <StatusBadge tone="gray">Düşük</StatusBadge>;
}

function statusBadge(status: 'ACTIVE' | 'INACTIVE' | 'RETIRED') {
  if (status === 'ACTIVE') return <StatusBadge tone="green">Aktif</StatusBadge>;
  if (status === 'INACTIVE') return <StatusBadge tone="amber">Pasif</StatusBadge>;
  return <StatusBadge tone="gray">Emekli</StatusBadge>;
}

async function fetchJson<T>(path: string, cookieHeader?: string): Promise<T | null> {
  const { apiBaseUrl } = getWebEnv();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json()) as T;
}

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.membership) return null;

  const { id } = await params;
  const cookieHeader = await apiCookieHeader();

  const customer = await fetchJson<CustomerDetail>(`/api/v1/customers/${id}`, cookieHeader);
  if (!customer) notFound();

  const [contacts, locations, assets, timeline] = await Promise.all([
    fetchJson<{ data: ContactRow[] }>(`/api/v1/customers/${id}/contacts`, cookieHeader),
    fetchJson<{ data: LocationRow[] }>(`/api/v1/customers/${id}/locations`, cookieHeader),
    fetchJson<{ data: AssetRow[] }>(`/api/v1/assets?customerId=${id}&pageSize=50`, cookieHeader),
    fetchJson<{ data: EventRow[] }>(`/api/v1/customers/${id}/timeline`, cookieHeader),
  ]);

  const canManage = session.permissions.includes('customers:manage');
  const canManageAssets = session.permissions.includes('assets:manage');

  const eventLabels: Record<string, string> = {
    'customer.created': 'Müşteri oluşturuldu',
    'customer.updated': 'Müşteri güncellendi',
    'customer.archived': 'Müşteri arşivlendi',
    'customer.imported': 'İçe aktarıldı',
    'contact.created': 'Kişi eklendi',
    'contact.updated': 'Kişi güncellendi',
    'contact.deleted': 'Kişi silindi',
    'location.created': 'Lokasyon eklendi',
    'location.updated': 'Lokasyon güncellendi',
    'location.deleted': 'Lokasyon silindi',
    'asset.created': 'Ekipman eklendi',
    'asset.updated': 'Ekipman güncellendi',
    'asset.status_changed': 'Ekipman durumu değişti',
    'asset.location_changed': 'Ekipman lokasyonu değişti',
    'asset.document_added': 'Doküman eklendi',
    'asset.document_removed': 'Doküman kaldırıldı',
  };

  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title={customer.name}
        subtitle={customer.customerType === 'COMPANY' ? 'Firma müşterisi' : 'Bireysel müşteri'}
      />

      <div className="tf-section-grid">
        <Panel title="Müşteri bilgileri">
          <div style={{ padding: '16px 18px' }}>
            <DetailList
              label="Müşteri bilgileri"
              items={[
                { label: 'Vergi No', children: customer.taxId ?? '—' },
                {
                  label: 'Durum',
                  children:
                    customer.status === 'ACTIVE' ? (
                      <StatusBadge tone="green">Etkin</StatusBadge>
                    ) : (
                      <StatusBadge tone="gray">Arşiv</StatusBadge>
                    ),
                },
                { label: 'Fatura Adresi', children: customer.billingAddress ?? '—' },
                { label: 'Kişi', children: `${contacts?.data.length ?? 0}` },
                { label: 'Lokasyon', children: `${locations?.data.length ?? 0}` },
                { label: 'Ekipman', children: `${assets?.data.length ?? 0}` },
              ]}
            />
          </div>
        </Panel>

        <Panel title="Zaman çizelgesi" subtitle="Son olaylar">
          <div style={{ padding: '4px 18px 12px' }}>
            {(timeline?.data ?? []).slice(0, 12).map((event) => (
              <div key={event.eventId} className="tf-sla-item">
                <span
                  className={`tf-dot ${event.eventType.includes('deleted') || event.eventType.includes('archived') ? 'tf-dot--red' : 'tf-dot--green'}`}
                />
                <span className="tf-sla-time">
                  {new Date(event.occurredAt).toLocaleDateString('tr-TR')}
                </span>
                <span className="tf-sla-info">
                  <strong>
                    {eventLabels[event.eventType] ?? event.eventType}
                    {event.assetTag ? ` · ${event.assetTag}` : ''}
                  </strong>
                  <small>{new Date(event.occurredAt).toLocaleTimeString('tr-TR')}</small>
                </span>
              </div>
            ))}
            {(timeline?.data ?? []).length === 0 ? (
              <p className="tf-panel__subtitle">Olay kaydı yok.</p>
            ) : null}
          </div>
        </Panel>
      </div>

      <div style={{ marginTop: 16 }} />

      <div className="tf-section-grid">
        <Panel
          title="İlgili kişiler"
          subtitle={`${contacts?.data.length ?? 0} kişi`}
          actions={canManage ? <AddContactButton customerId={id} /> : undefined}
        >
          {(contacts?.data ?? []).length === 0 ? (
            <p className="tf-panel__subtitle" style={{ padding: '18px' }}>
              Kayıtlı kişi yok.
            </p>
          ) : (
            <DataTable
              columns={CONTACT_COLUMNS}
              rows={contacts?.data ?? []}
              getKey={(row) => row.contactId}
              aria-label="İlgili kişiler"
            />
          )}
        </Panel>

        <Panel
          title="Servis lokasyonları"
          subtitle={`${locations?.data.length ?? 0} lokasyon`}
          actions={canManage ? <AddLocationButton customerId={id} /> : undefined}
        >
          {(locations?.data ?? []).length === 0 ? (
            <p className="tf-panel__subtitle" style={{ padding: '18px' }}>
              Kayıtlı lokasyon yok.
            </p>
          ) : (
            <DataTable
              columns={LOCATION_COLUMNS}
              rows={locations?.data ?? []}
              getKey={(row) => row.locationId}
              aria-label="Servis lokasyonları"
            />
          )}
        </Panel>
      </div>

      <div style={{ marginTop: 16 }} />

      <Panel
        title="Ekipmanlar"
        subtitle={`${assets?.data.length ?? 0} varlık`}
        actions={
          canManageAssets ? (
            <AddAssetButton customerId={id} locations={locations?.data ?? []} />
          ) : undefined
        }
      >
        {(assets?.data ?? []).length === 0 ? (
          <p className="tf-panel__subtitle" style={{ padding: '18px' }}>
            Bu müşteriye kayıtlı ekipman yok.
          </p>
        ) : (
          <DataTable
            columns={ASSET_COLUMNS}
            rows={assets?.data ?? []}
            getKey={(row) => row.assetId}
            aria-label="Ekipman listesi"
          />
        )}
      </Panel>
    </>
  );
}
