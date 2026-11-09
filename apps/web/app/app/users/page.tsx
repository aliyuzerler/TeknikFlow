import { redirect } from 'next/navigation';
import { getSession, apiCookieHeader } from '@/src/lib/session';
import { getWebEnv } from '@/src/load-env';
import {
  Alert,
  DataTable,
  PageHeader,
  Panel,
  StatusBadge,
  type DataTableColumn,
} from '@teknikflow/ui-web/server';
import { InviteForm } from './invite-form';

export const metadata = { title: 'Kullanıcılar & Roller — TeknikFlow' };

/**
 * Faz 03 — /app/users: kiracı üyeleri + davetler (users:manage).
 * Yetkisiz rol (teknisyen vb.) sunucu tarafında 403 alır → dostça uyarı.
 */

interface MemberRow {
  membershipId: string;
  displayName: string;
  email: string;
  roleName: string;
  membershipStatus: string;
  membershipStatusLabel: string;
  branchScopeLabel: string;
}

const MEMBER_COLUMNS: Array<DataTableColumn<MemberRow>> = [
  {
    key: 'name',
    header: 'Kullanıcı',
    render: (row) => (
      <span className="tf-table__wo">
        {row.displayName}
        <div className="tf-table__sub">{row.email}</div>
      </span>
    ),
  },
  { key: 'roleName', header: 'Rol' },
  { key: 'branchScopeLabel', header: 'Şube kapsamı' },
  {
    key: 'status',
    header: 'Durum',
    render: (row) => (
      <StatusBadge tone={row.membershipStatus === 'ACTIVE' ? 'green' : 'gray'}>
        {row.membershipStatusLabel}
      </StatusBadge>
    ),
  },
];

export default async function UsersPage() {
  const session = await getSession();
  if (!session?.membership) {
    redirect('/login');
  }
  if (!session.permissions.includes('users:manage')) {
    return (
      <Alert variant="warning" title="Bu bölüm için yetkiniz yok">
        Kullanıcı yönetimi yalnızca yönetici rollerine açıktır. Yetki talebi için firma sahibinizle
        iletişime geçin.
      </Alert>
    );
  }

  const { apiBaseUrl } = getWebEnv();
  const cookieHeader = await apiCookieHeader();

  const [membersResponse, invitationsResponse] = await Promise.all([
    fetch(`${apiBaseUrl}/api/v1/tenants/current/members`, {
      headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    }).catch(() => null),
    fetch(`${apiBaseUrl}/api/v1/tenants/current/invitations`, {
      headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    }).catch(() => null),
  ]);

  if (!membersResponse?.ok || !invitationsResponse?.ok) {
    return (
      <Alert variant="danger" title="Üye listesi alınamadı">
        API'ye ulaşılamadı — bir süre sonra tekrar deneyin.
      </Alert>
    );
  }

  const members = (await membersResponse.json()) as {
    data: Array<{
      membershipId: string;
      displayName: string;
      email: string;
      roleName: string;
      membershipStatus: string;
      branchScope: 'ALL' | string[];
    }>;
  };
  const invitations = (await invitationsResponse.json()) as {
    data: Array<{
      invitationId: string;
      email: string;
      roleName: string;
      status: string;
    }>;
  };

  const memberRows: MemberRow[] = members.data.map((m) => ({
    membershipId: m.membershipId,
    displayName: m.displayName,
    email: m.email,
    roleName: m.roleName,
    membershipStatus: m.membershipStatus,
    branchScopeLabel: m.branchScope === 'ALL' ? 'Tüm şubeler' : `${m.branchScope.length} şube`,
    membershipStatusLabel: statusLabel(m.membershipStatus),
  }));

  const openInvitations = invitations.data.filter((i) => i.status === 'OPEN');

  return (
    <>
      <PageHeader
        eyebrow="Yönetim"
        title="Kullanıcılar & Roller"
        subtitle="Ekip üyelerini yönetin, davet gönderin ve rolleri atayın."
      />

      <div className="tf-section-grid">
        <Panel
          title="Ekip üyeleri"
          subtitle={`${memberRows.length} üye`}
          footer={`Kiracı: ${session.membership.tenantName} · sunucu tarafı RBAC etkin`}
        >
          <DataTable
            columns={MEMBER_COLUMNS}
            rows={memberRows}
            getKey={(row) => row.membershipId}
            aria-label="Ekip üyeleri"
          />
        </Panel>

        <div className="tf-stack tf-stack--two">
          <Panel title="Yeni davet" subtitle="E-posta ile üye davet edin">
            <InviteForm />
          </Panel>

          <Panel title="Bekleyen davetler" subtitle={`${openInvitations.length} açık davet`}>
            {openInvitations.length === 0 ? (
              <p className="tf-panel__sub" style={{ padding: '0 18px 14px' }}>
                Bekleyen davet yok.
              </p>
            ) : (
              <div style={{ padding: '4px 18px 12px' }}>
                {openInvitations.map((invitation) => (
                  <div key={invitation.invitationId} className="tf-sla-item">
                    <span className="tf-dot tf-dot--green" />
                    <span className="tf-sla-info">
                      <strong>{invitation.email}</strong>
                      <small>{invitation.roleName}</small>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'Etkin';
    case 'INVITED':
      return 'Davetli';
    case 'SUSPENDED':
      return 'Askıda';
    default:
      return status;
  }
}
