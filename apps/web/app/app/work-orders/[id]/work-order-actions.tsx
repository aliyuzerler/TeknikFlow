'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, FormField, Panel, SideDrawer } from '@teknikflow/ui-web';
import {
  CANCELLATION_REASON_LABELS,
  WORK_ORDER_STATUS_LABELS,
  type CancellationReason,
  type WorkOrderStatus,
} from '@teknikflow/contracts';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/**
 * Faz 05 — iş emri eylem paneli: durum makinesi geçişleri.
 *
 * Düğme görünürlüğü izin + atama durumundan TÜRETİLİR (sunucu tarafı
 * denetim yetkilendirmenin kendisidir — buradaki gizleme yalnız UX).
 * Yetki sınıfları work-order-state.ts ile aynı kurallarla yansıtılır:
 * PLANNING=create|dispatch, DISPATCH=dispatch, EXECUTION=complete&&(all|assignee),
 * CLOSE=complete&&all, CANCEL=create|dispatch.
 */

type Authority = 'PLANNING' | 'DISPATCH' | 'EXECUTION' | 'CLOSE' | 'CANCEL';

const TRANSITIONS: Array<{
  from: WorkOrderStatus;
  to: WorkOrderStatus;
  action: string;
  authority: Authority;
}> = [
  { from: 'DRAFT', to: 'PLANNED', action: 'PLAN', authority: 'PLANNING' },
  { from: 'DRAFT', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
  { from: 'PLANNED', to: 'ASSIGNED', action: 'ASSIGN', authority: 'DISPATCH' },
  { from: 'PLANNED', to: 'DRAFT', action: 'BACK_TO_DRAFT', authority: 'PLANNING' },
  { from: 'PLANNED', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
  { from: 'ASSIGNED', to: 'ACCEPTED', action: 'ACCEPT', authority: 'EXECUTION' },
  { from: 'ASSIGNED', to: 'PLANNED', action: 'UNASSIGN', authority: 'DISPATCH' },
  { from: 'ASSIGNED', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
  { from: 'ACCEPTED', to: 'EN_ROUTE', action: 'START_TRAVEL', authority: 'EXECUTION' },
  { from: 'ACCEPTED', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
  { from: 'EN_ROUTE', to: 'ON_SITE', action: 'ARRIVE', authority: 'EXECUTION' },
  { from: 'EN_ROUTE', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
  { from: 'ON_SITE', to: 'IN_PROGRESS', action: 'START_WORK', authority: 'EXECUTION' },
  { from: 'ON_SITE', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
  { from: 'IN_PROGRESS', to: 'WAITING_PARTS', action: 'HOLD_PARTS', authority: 'EXECUTION' },
  { from: 'IN_PROGRESS', to: 'WAITING_CUSTOMER', action: 'HOLD_CUSTOMER', authority: 'EXECUTION' },
  { from: 'IN_PROGRESS', to: 'COMPLETED', action: 'COMPLETE', authority: 'EXECUTION' },
  { from: 'IN_PROGRESS', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
  { from: 'WAITING_PARTS', to: 'IN_PROGRESS', action: 'RESUME', authority: 'EXECUTION' },
  { from: 'WAITING_PARTS', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
  { from: 'WAITING_CUSTOMER', to: 'IN_PROGRESS', action: 'RESUME', authority: 'EXECUTION' },
  { from: 'WAITING_CUSTOMER', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
  { from: 'COMPLETED', to: 'IN_PROGRESS', action: 'REOPEN', authority: 'EXECUTION' },
  { from: 'COMPLETED', to: 'CLOSED', action: 'CLOSE', authority: 'CLOSE' },
];

const ACTION_LABELS: Record<string, string> = {
  PLAN: 'Planla',
  BACK_TO_DRAFT: 'Taslağa çevir',
  ASSIGN: 'Teknisyen ata',
  UNASSIGN: 'Atamayı kaldır',
  ACCEPT: 'İşi kabul et',
  START_TRAVEL: 'Yola çık',
  ARRIVE: 'Varış bildir',
  START_WORK: 'İşe başla',
  HOLD_PARTS: 'Parça bekle',
  HOLD_CUSTOMER: 'Müşteri bekle',
  RESUME: 'Devam et',
  COMPLETE: 'Tamamla',
  REOPEN: 'Yeniden aç',
  CLOSE: 'Kapat',
  CANCEL: 'İptal et',
};

interface AssignableUser {
  userId: string;
  displayName: string;
  roleName: string;
}

export function WorkOrderActions({
  workOrderId,
  status,
  version,
  permissions,
  isAssignee,
  branches,
}: {
  workOrderId: string;
  status: WorkOrderStatus;
  version: number;
  permissions: string[];
  isAssignee: boolean;
  branches: Array<{ branchId: string; name: string }>;
}) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Çekmeceler / diyaloglar.
  const [planOpen, setPlanOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [scheduledStart, setScheduledStart] = useState('');
  const [scheduledEnd, setScheduledEnd] = useState('');
  const [planBranchId, setPlanBranchId] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[] | null>(null);
  const [reasonCode, setReasonCode] = useState<CancellationReason>('CUSTOMER_REQUEST');
  const [cancelNote, setCancelNote] = useState('');

  const has = (permission: string) => permissions.includes(permission);
  const create = has('work_orders:create');
  const dispatch = has('work_orders:dispatch');
  const complete = has('work_orders:complete');
  const viewAll = has('work_orders:view_all');

  function hasAuthority(authority: Authority): boolean {
    switch (authority) {
      case 'PLANNING':
        return create || dispatch;
      case 'DISPATCH':
        return dispatch;
      case 'EXECUTION':
        return complete && (viewAll || isAssignee);
      case 'CLOSE':
        return complete && viewAll;
      case 'CANCEL':
        return create || dispatch;
    }
  }

  const available = TRANSITIONS.filter((t) => t.from === status && hasAuthority(t.authority));

  async function transition(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/work-orders/${workOrderId}/transition`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ ...body, expectedVersion: version }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      if (!response) {
        setError('Ağa ulaşılamadı');
        return false;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
      };
      if (!response.ok) {
        if (payload.code === 'VERSION_CONFLICT') {
          setError('İş emri başka biri tarafından güncellendi — sayfa yenileniyor.');
          router.refresh();
        } else if (payload.code === 'INVALID_TRANSITION') {
          setError('Bu geçiş artık izinli değil — sayfa yenileniyor.');
          router.refresh();
        } else {
          setError(payload.message ?? 'Geçiş başarısız');
        }
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function handleSimpleTransition(to: WorkOrderStatus) {
    await transition({ to });
  }

  async function handlePlan(event: React.FormEvent) {
    event.preventDefault();
    if (scheduledStart && scheduledEnd && new Date(scheduledEnd) <= new Date(scheduledStart)) {
      setError('Bitiş zamanı başlangıçtan sonra olmalı');
      return;
    }
    const ok = await transition({
      to: 'PLANNED',
      ...(scheduledStart ? { scheduledStart: new Date(scheduledStart).toISOString() } : {}),
      ...(scheduledEnd ? { scheduledEnd: new Date(scheduledEnd).toISOString() } : {}),
      ...(planBranchId ? { branchId: planBranchId } : {}),
    });
    if (ok) setPlanOpen(false);
  }

  async function handleAssign(event: React.FormEvent) {
    event.preventDefault();
    if (!assigneeUserId) {
      setError('Teknisyen seçin');
      return;
    }
    const ok = await transition({ to: 'ASSIGNED', assigneeUserId });
    if (ok) setAssignOpen(false);
  }

  async function handleCancelConfirm() {
    const ok = await transition({
      to: 'CANCELLED',
      reasonCode,
      ...(cancelNote.trim() ? { note: cancelNote.trim() } : {}),
    });
    if (ok) setCancelOpen(false);
  }

  // Atama çekmecesi açılınca atanabilir kullanıcıları çek.
  useEffect(() => {
    if (!assignOpen || assignableUsers) return;
    fetch(`${apiBaseUrl}/api/v1/work-orders/assignable-users`, {
      headers: { accept: 'application/json' },
      credentials: 'include',
      signal: AbortSignal.timeout(6000),
    })
      .then((response) =>
        response.ok ? (response.json() as Promise<{ data: AssignableUser[] }>) : null,
      )
      .then((body) => {
        if (body) setAssignableUsers(body.data);
      })
      .catch(() => {
        setError('Teknisyen listesi alınamadı');
      });
  }, [assignOpen, assignableUsers, apiBaseUrl]);

  if (available.length === 0 && status !== 'CLOSED' && status !== 'CANCELLED') {
    return (
      <Panel title="Eylemler" headingLevel={2}>
        <p className="tf-panel__subtitle">
          Bu iş emri için şu anda kullanabileceğiniz bir eylem yok.
        </p>
      </Panel>
    );
  }
  if (available.length === 0) return null;

  return (
    <Panel title="Eylemler" headingLevel={2}>
      {error ? (
        <Alert variant="danger" title="İşlem başarısız">
          {error}
        </Alert>
      ) : null}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {available.map((transitionRule) => {
          const label = ACTION_LABELS[transitionRule.action] ?? transitionRule.to;
          const variant =
            transitionRule.action === 'CANCEL'
              ? 'secondary'
              : transitionRule.action === 'CLOSE' || transitionRule.action === 'COMPLETE'
                ? 'primary'
                : 'secondary';
          if (transitionRule.action === 'PLAN') {
            return (
              <Button
                key={transitionRule.action}
                variant="primary"
                disabled={busy}
                onClick={() => setPlanOpen(true)}
              >
                {label}
              </Button>
            );
          }
          if (transitionRule.action === 'ASSIGN') {
            return (
              <Button
                key={transitionRule.action}
                variant="primary"
                disabled={busy}
                onClick={() => setAssignOpen(true)}
              >
                {label}
              </Button>
            );
          }
          if (transitionRule.action === 'CANCEL') {
            return (
              <Button
                key={transitionRule.action}
                variant="secondary"
                disabled={busy}
                onClick={() => setCancelOpen(true)}
              >
                {label}
              </Button>
            );
          }
          return (
            <Button
              key={transitionRule.action}
              variant={variant}
              disabled={busy}
              onClick={() => handleSimpleTransition(transitionRule.to)}
            >
              {label}
            </Button>
          );
        })}
      </div>
      <p className="tf-panel__subtitle" style={{ marginTop: 10 }}>
        Durum: {WORK_ORDER_STATUS_LABELS[status]} · sürüm {version}
      </p>

      {/* Planlama çekmecesi */}
      <SideDrawer open={planOpen} onClose={() => setPlanOpen(false)} title="İş emrini planla">
        <form onSubmit={handlePlan} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FormField label="Planlanan başlangıç">
            {(ids) => (
              <input
                {...ids}
                type="datetime-local"
                value={scheduledStart}
                onChange={(e) => setScheduledStart(e.target.value)}
                style={{ width: '100%' }}
              />
            )}
          </FormField>
          <FormField label="Planlanan bitiş">
            {(ids) => (
              <input
                {...ids}
                type="datetime-local"
                value={scheduledEnd}
                onChange={(e) => setScheduledEnd(e.target.value)}
                style={{ width: '100%' }}
              />
            )}
          </FormField>
          <FormField label="Şube">
            {(ids) => (
              <select
                {...ids}
                value={planBranchId}
                onChange={(e) => setPlanBranchId(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">Şube yok</option>
                {branches.map((branch) => (
                  <option key={branch.branchId} value={branch.branchId}>
                    {branch.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setPlanOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              Planlamayı kaydet
            </Button>
          </div>
        </form>
      </SideDrawer>

      {/* Atama çekmecesi */}
      <SideDrawer open={assignOpen} onClose={() => setAssignOpen(false)} title="Teknisyen ata">
        <form onSubmit={handleAssign} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FormField label="Teknisyen">
            {(ids) => (
              <select
                {...ids}
                value={assigneeUserId}
                onChange={(e) => setAssigneeUserId(e.target.value)}
                required
                style={{ width: '100%' }}
              >
                <option value="">Seçin</option>
                {(assignableUsers ?? []).map((user) => (
                  <option key={user.userId} value={user.userId}>
                    {user.displayName} — {user.roleName}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {assignableUsers === null ? (
            <p className="tf-panel__subtitle">Teknisyen listesi yükleniyor…</p>
          ) : null}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setAssignOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !assigneeUserId}>
              Atamayı yap
            </Button>
          </div>
        </form>
      </SideDrawer>

      {/* İptal çekmecesi */}
      <SideDrawer open={cancelOpen} onClose={() => setCancelOpen(false)} title="İş emrini iptal et">
        <p className="tf-panel__subtitle" style={{ marginTop: 0 }}>
          Bu eylem geri alınamaz — iş emri kapanır ve zaman çizelgesine iptal kaydı düşer.
        </p>
        <FormField label="İptal nedeni">
          {(ids) => (
            <select
              {...ids}
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value as CancellationReason)}
              style={{ width: '100%' }}
            >
              {(Object.keys(CANCELLATION_REASON_LABELS) as CancellationReason[]).map((key) => (
                <option key={key} value={key}>
                  {CANCELLATION_REASON_LABELS[key]}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="Not" hint="Opsiyonel">
          {(ids) => (
            <textarea
              {...ids}
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value)}
              rows={2}
              maxLength={500}
              style={{ width: '100%' }}
            />
          )}
        </FormField>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button type="button" variant="secondary" onClick={() => setCancelOpen(false)}>
            Vazgeç
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={handleCancelConfirm}>
            {busy ? 'İptal ediliyor…' : 'İş emrini iptal et'}
          </Button>
        </div>
      </SideDrawer>
    </Panel>
  );
}
