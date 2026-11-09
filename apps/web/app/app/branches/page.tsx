import { redirect } from 'next/navigation';
import { getSession, apiCookieHeader } from '@/src/lib/session';
import { getWebEnv } from '@/src/load-env';
import {
  Alert,
  DataTable,
  PageHeader,
  Panel,
  type DataTableColumn,
} from '@teknikflow/ui-web/server';
import { NewBranchForm } from './new-branch-form';

export const metadata = { title: 'Şubeler — TeknikFlow' };

/**
 * Faz 03 — /app/branches: kiracı şubeleri (branches:manage).
 */

interface BranchRow {
  branchId: string;
  name: string;
  code: string;
  address: string | null;
}

const COLUMNS: Array<DataTableColumn<BranchRow>> = [
  {
    key: 'name',
    header: 'Şube',
    render: (row) => (
      <span className="tf-table__wo">
        {row.name}
        <div className="tf-table__sub">{row.code}</div>
      </span>
    ),
  },
  {
    key: 'address',
    header: 'Adres',
    render: (row) => (row.address ? row.address : <span className="tf-table__sub">—</span>),
  },
];

export default async function BranchesPage() {
  const session = await getSession();
  if (!session?.membership) {
    redirect('/login');
  }
  if (!session.permissions.includes('branches:manage')) {
    return (
      <Alert variant="warning" title="Bu bölüm için yetkiniz yok">
        Şube yönetimi yalnızca yönetici rollerine açıktır.
      </Alert>
    );
  }

  const { apiBaseUrl } = getWebEnv();
  const cookieHeader = await apiCookieHeader();
  const response = await fetch(`${apiBaseUrl}/api/v1/tenants/current/branches`, {
    headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);

  if (!response?.ok) {
    return (
      <Alert variant="danger" title="Şube listesi alınamadı">
        API'ye ulaşılamadı — bir süre sonra tekrar deneyin.
      </Alert>
    );
  }
  const branches = (await response.json()) as { data: BranchRow[] };

  return (
    <>
      <PageHeader
        eyebrow="Yönetim"
        title="Şubeler"
        subtitle="Servis bölgelerinizi ve operasyon noktalarınızı yönetin."
      />

      <div className="tf-section-grid">
        <Panel
          title="Şube listesi"
          subtitle={`${branches.data.length} şube`}
          footer="Kayıtlar kiracı kapsamında — RLS etkin"
        >
          <DataTable
            columns={COLUMNS}
            rows={branches.data}
            getKey={(row) => row.branchId}
            aria-label="Şube listesi"
          />
        </Panel>

        <div className="tf-stack tf-stack--two">
          <Panel title="Yeni şube" subtitle="Plan limiti kontrol edilir">
            <NewBranchForm />
          </Panel>
        </div>
      </div>
    </>
  );
}
