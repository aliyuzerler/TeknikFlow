'use client';

import { useCallback, useMemo, useState } from 'react';
import type { DispatchBoardResponse, BoardWorkOrder } from '@teknikflow/contracts';
import {
  CONFLICT_TYPE_LABELS,
  PRIORITY_LABELS,
  WORK_ORDER_STATUS_LABELS,
} from '@teknikflow/contracts';
import {
  Alert,
  Button,
  MeterBar,
  SegmentedControl,
  SideDrawer,
  StatusBadge,
} from '@teknikflow/ui-web';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';
import {
  shiftDate,
  startOfWeek,
  tenantWallClockToUtc,
  utcToTenantWallClock,
} from '@/src/lib/dispatch-time';

/**
 * Faz 06 — dispatch panosu (istemci).
 *
 * Görünümler: kanban (teknisyen kolonları + planlama kuyruğu, HTML5
 * sürükle-bırak), takvim (hafta matrisi) ve liste. Sürükle-bırakın
 * KLAVYE ALTERNATİFİ: her kartta "Planla/Ata" düğmesi → atama paneli
 * (form + çakışma uyarısı + override). Pano GET'i çerezle; planlama
 * POST'u CSRF başlığıyla gider.
 */

type BoardView = 'kanban' | 'takvim' | 'liste';

const PRIORITY_TONES = { LOW: 'gray', MEDIUM: 'blue', HIGH: 'amber', URGENT: 'red' } as const;
const STATUS_TONES = {
  DRAFT: 'gray',
  PLANNED: 'blue',
  ASSIGNED: 'blue',
  ACCEPTED: 'blue',
  EN_ROUTE: 'blue',
  ON_SITE: 'blue',
  IN_PROGRESS: 'info',
  WAITING_PARTS: 'amber',
  WAITING_CUSTOMER: 'amber',
  COMPLETED: 'green',
  CLOSED: 'gray',
  CANCELLED: 'red',
} as const;

const VIEW_OPTIONS = [
  { value: 'kanban' as const, label: 'Kanban' },
  { value: 'takvim' as const, label: 'Takvim' },
  { value: 'liste' as const, label: 'Liste' },
];

const WEEKDAY_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

interface ConflictPayload {
  type: keyof typeof CONFLICT_TYPE_LABELS;
  message: string;
}

interface SchedulePanelState {
  workOrder: BoardWorkOrder;
  presetTechnicianId: string;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDayLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(year!, month! - 1, day!));
}

export function DispatchBoard({
  initialBoard,
  canDispatch,
  canOverride,
}: {
  initialBoard: DispatchBoardResponse;
  canDispatch: boolean;
  canOverride: boolean;
}) {
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [view, setView] = useState<BoardView>('kanban');
  const [date, setDate] = useState(initialBoard.date);
  const [board, setBoard] = useState(initialBoard);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [panel, setPanel] = useState<SchedulePanelState | null>(null);

  const reload = useCallback(
    async (nextDate?: string) => {
      const target = nextDate ?? date;
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/v1/dispatch/board?date=${encodeURIComponent(target)}`,
          {
            headers: { accept: 'application/json' },
            credentials: 'include',
            cache: 'no-store',
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { message?: string };
          setLoadError(body.message ?? 'Pano yüklenemedi');
          return;
        }
        setBoard((await response.json()) as DispatchBoardResponse);
      } catch {
        setLoadError('Ağa ulaşılamadı — pano yenilenemedi');
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, date],
  );

  const goToDate = useCallback(
    (nextDate: string) => {
      setDate(nextDate);
      void reload(nextDate);
    },
    [reload],
  );

  const weekDays = useMemo(() => {
    const monday = startOfWeek(date);
    return Array.from({ length: 7 }, (_, index) => shiftDate(monday, index));
  }, [date]);

  const openPanel = useCallback((workOrder: BoardWorkOrder, technicianId?: string) => {
    setPanel({ workOrder, presetTechnicianId: technicianId ?? '' });
  }, []);

  const closePanel = useCallback(() => setPanel(null), []);

  const onDropOnTechnician = useCallback(
    (event: React.DragEvent, userId: string) => {
      event.preventDefault();
      const workOrderId = event.dataTransfer.getData('text/plain');
      const workOrder =
        board.queue.find((wo) => wo.workOrderId === workOrderId) ??
        board.technicians
          .flatMap((column) => column.workOrders)
          .find((wo) => wo.workOrderId === workOrderId);
      if (workOrder) openPanel(workOrder, userId);
    },
    [board, openPanel],
  );

  const onSuccess = useCallback(() => {
    closePanel();
    void reload();
  }, [closePanel, reload]);

  return (
    <div className="tf-dispatch">
      {/* Pano başlığı: tarih gezintisi + görünüm seçici */}
      <div className="tf-dispatch__toolbar">
        <div className="tf-dispatch__datenav" role="group" aria-label="Pano tarihi">
          <Button variant="secondary" size="sm" onClick={() => goToDate(shiftDate(date, -1))}>
            ← Önceki gün
          </Button>
          <span className="tf-dispatch__date" aria-live="polite">
            {formatDayLabel(date)}
          </span>
          <Button variant="secondary" size="sm" onClick={() => goToDate(shiftDate(date, 1))}>
            Sonraki gün →
          </Button>
          <Button variant="ghost" size="sm" onClick={() => goToDate(initialBoard.date)}>
            Bugün
          </Button>
        </div>
        <SegmentedControl
          options={VIEW_OPTIONS}
          value={view}
          onValueChange={setView}
          label="Pano görünümü"
        />
      </div>

      {loadError ? (
        <Alert variant="danger" title="Pano yüklenemedi">
          {loadError}
        </Alert>
      ) : null}

      {/* SLA uyarıları */}
      {board.slaAlerts.length > 0 ? (
        <section className="tf-dispatch__sla" aria-label="SLA uyarıları">
          {board.slaAlerts.slice(0, 6).map((alert) => (
            <Alert
              key={alert.workOrderId}
              variant={alert.slaBreached ? 'danger' : 'warning'}
              title={`${alert.workOrderNo} — ${alert.subject}`}
            >
              {alert.customerName} · {PRIORITY_LABELS[alert.priority]} · SLA:{' '}
              {new Date(alert.slaDueAt).toLocaleString('tr-TR')} ·{' '}
              {alert.slaBreached ? 'süre aşıldı' : 'risk altında'} (
              {WORK_ORDER_STATUS_LABELS[alert.status]})
            </Alert>
          ))}
        </section>
      ) : null}

      {/* Çakışma uyarıları */}
      {board.conflicts.length > 0 ? (
        <section className="tf-dispatch__conflicts" aria-label="Plan çakışmaları">
          <h3 className="tf-panel__subtitle">Plan çakışmaları ({board.conflicts.length})</h3>
          <ul className="tf-dispatch__conflictlist">
            {board.conflicts.slice(0, 8).map((conflict, index) => (
              <li key={`${conflict.userId}-${conflict.workOrderId}-${index}`}>
                <StatusBadge tone={conflict.type === 'OVERLAP' ? 'red' : 'amber'}>
                  {CONFLICT_TYPE_LABELS[conflict.type]}
                </StatusBadge>
                <span>
                  {conflict.userName} · {conflict.message}
                  {conflict.workOrderNo ? ` (${conflict.workOrderNo})` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loading ? <p className="tf-panel__subtitle">Pano yenileniyor…</p> : null}

      {view === 'kanban' ? (
        <KanbanBoard
          board={board}
          canDispatch={canDispatch}
          onDropOnTechnician={onDropOnTechnician}
          onOpenPanel={openPanel}
        />
      ) : null}

      {view === 'takvim' ? (
        <CalendarBoard
          board={board}
          weekDays={weekDays}
          canDispatch={canDispatch}
          onOpenPanel={openPanel}
        />
      ) : null}

      {view === 'liste' ? (
        <ListBoard board={board} canDispatch={canDispatch} onOpenPanel={openPanel} />
      ) : null}

      {/* Takım kapasitesi toplamı */}
      {board.teams.length > 0 ? (
        <section className="tf-dispatch__teams" aria-label="Takım kapasitesi">
          <h3 className="tf-panel__subtitle">Takım kapasitesi</h3>
          <div className="tf-dispatch__teamgrid">
            {board.teams.map((team) => (
              <div key={team.teamId} className="tf-dispatch__teamcard">
                <span className="tf-dispatch__teamname">
                  {team.name}{' '}
                  <span className="tf-panel__subtitle">
                    ({team.code} · {team.memberCount} kişi)
                  </span>
                </span>
                <MeterBar
                  value={team.capacity.utilizationPct}
                  label={`${team.name} gün yükü`}
                  tone={
                    team.capacity.utilizationPct > 100
                      ? 'danger'
                      : team.capacity.utilizationPct > 85
                        ? 'warning'
                        : 'ok'
                  }
                  valueText={`${team.capacity.scheduledMinutes} / ${team.capacity.capacityMinutes} dk · %${team.capacity.utilizationPct}`}
                  size="sm"
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {panel ? (
        <SchedulePanel
          board={board}
          state={panel}
          apiBaseUrl={apiBaseUrl}
          csrf={csrf}
          canOverride={canOverride}
          onClose={closePanel}
          onSuccess={onSuccess}
        />
      ) : null}
    </div>
  );
}

// ------------------------- Kanban -------------------------

function KanbanBoard({
  board,
  canDispatch,
  onDropOnTechnician,
  onOpenPanel,
}: {
  board: DispatchBoardResponse;
  canDispatch: boolean;
  onDropOnTechnician: (event: React.DragEvent, userId: string) => void;
  onOpenPanel: (workOrder: BoardWorkOrder, technicianId?: string) => void;
}) {
  return (
    <div className="tf-dispatch__kanban">
      {/* Planlama kuyruğu */}
      <section
        className="tf-dispatch__col tf-dispatch__col--queue"
        aria-label="Planlama bekleyen işler"
        data-testid="dispatch-queue"
      >
        <header className="tf-dispatch__colhead">
          <span className="tf-dispatch__coltitle">Planlama bekleyen</span>
          <span className="tf-dispatch__colcount">{board.queue.length} iş</span>
        </header>
        <div className="tf-dispatch__colbody">
          {board.queue.length === 0 ? (
            <p className="tf-panel__subtitle">Bekleyen iş yok — her şey planlı.</p>
          ) : (
            board.queue.map((workOrder) => (
              <BoardCard
                key={workOrder.workOrderId}
                workOrder={workOrder}
                canDispatch={canDispatch}
                onOpenPanel={onOpenPanel}
              />
            ))
          )}
        </div>
      </section>

      {/* Teknisyen kolonları (sürükle-bırak hedefi; klavye yolu kart düğmesi) */}
      {board.technicians.map((column) => {
        const utilization = column.capacity.utilizationPct;
        return (
          <section
            key={column.userId}
            className="tf-dispatch__col"
            aria-label={`${column.displayName} günlük planı`}
            data-technician={column.userId}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDropOnTechnician(event, column.userId)}
          >
            <header className="tf-dispatch__colhead">
              <span className="tf-dispatch__coltitle">
                {column.displayName}
                {column.onTimeOff ? <StatusBadge tone="amber">İzinli</StatusBadge> : null}
              </span>
              {column.team ? (
                <span className="tf-dispatch__colteam">{column.team.name}</span>
              ) : null}
              <MeterBar
                value={utilization}
                label={`${column.displayName} gün yükü`}
                tone={utilization > 100 ? 'danger' : utilization > 85 ? 'warning' : 'ok'}
                valueText={`${column.capacity.scheduledMinutes}/${column.capacity.capacityMinutes} dk`}
                size="sm"
              />
            </header>
            <div className="tf-dispatch__colbody">
              {column.workOrders.length === 0 ? (
                <p className="tf-panel__subtitle">Bugün planlı iş yok.</p>
              ) : (
                column.workOrders.map((workOrder) => (
                  <BoardCard
                    key={workOrder.workOrderId}
                    workOrder={workOrder}
                    canDispatch={canDispatch}
                    onOpenPanel={onOpenPanel}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({
  workOrder,
  canDispatch,
  onOpenPanel,
}: {
  workOrder: BoardWorkOrder;
  canDispatch: boolean;
  onOpenPanel: (workOrder: BoardWorkOrder, technicianId?: string) => void;
}) {
  return (
    <article
      className="tf-dispatch__card"
      draggable={canDispatch}
      data-work-order={workOrder.workOrderId}
      aria-label={`${workOrder.workOrderNo}: ${workOrder.subject}`}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', workOrder.workOrderId);
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className="tf-dispatch__cardhead">
        <a className="tf-table__customer" href={`/app/work-orders/${workOrder.workOrderId}`}>
          {workOrder.workOrderNo}
        </a>
        <StatusBadge tone={PRIORITY_TONES[workOrder.priority]}>
          {PRIORITY_LABELS[workOrder.priority]}
        </StatusBadge>
      </div>
      <p className="tf-dispatch__cardsubject">{workOrder.subject}</p>
      <p className="tf-dispatch__cardmeta">
        {workOrder.customerName}
        {workOrder.scheduledStart
          ? ` · ${formatTime(workOrder.scheduledStart)}–${formatTime(workOrder.scheduledEnd)}`
          : ''}
      </p>
      <div className="tf-dispatch__cardfoot">
        <StatusBadge tone={STATUS_TONES[workOrder.status]}>
          {WORK_ORDER_STATUS_LABELS[workOrder.status]}
        </StatusBadge>
        {workOrder.slaBreached ? <StatusBadge tone="red">SLA aşıldı</StatusBadge> : null}
        {!workOrder.slaBreached && workOrder.slaAtRisk ? (
          <StatusBadge tone="amber">SLA riski</StatusBadge>
        ) : null}
        {canDispatch ? (
          <button
            type="button"
            className="tf-dispatch__cardaction"
            onClick={() => onOpenPanel(workOrder)}
          >
            Planla / Ata
            <span className="tf-visually-hidden">: {workOrder.workOrderNo}</span>
          </button>
        ) : null}
      </div>
    </article>
  );
}

// ------------------------- Takvim (hafta matrisi) -------------------------

function CalendarBoard({
  board,
  weekDays,
  canDispatch,
  onOpenPanel,
}: {
  board: DispatchBoardResponse;
  weekDays: string[];
  canDispatch: boolean;
  onOpenPanel: (workOrder: BoardWorkOrder, technicianId?: string) => void;
}) {
  return (
    <div className="tf-dispatch__calendar" role="grid" aria-label="Haftalık dispatch takvimi">
      <div className="tf-dispatch__calhead" role="row">
        <span className="tf-dispatch__calfirst" aria-hidden="true" />
        {weekDays.map((day, index) => (
          <span
            key={day}
            className={`tf-dispatch__calday ${day === board.date ? 'tf-dispatch__calday--today' : ''}`}
            role="columnheader"
            aria-label={formatDayLabel(day)}
          >
            {WEEKDAY_SHORT[index]} {day.slice(8)}
          </span>
        ))}
      </div>
      {board.technicians.map((column) => (
        <div className="tf-dispatch__calrow" role="row" key={column.userId}>
          <span className="tf-dispatch__caltech" role="rowheader">
            {column.displayName}
          </span>
          {weekDays.map((day) => {
            const dayJobs = column.workOrders.filter(
              (workOrder) =>
                utcToTenantWallClock(workOrder.scheduledStart ?? '', board.timezone)?.date === day,
            );
            return (
              <span className="tf-dispatch__calcell" role="gridcell" key={day}>
                {dayJobs.map((workOrder) => (
                  <button
                    key={workOrder.workOrderId}
                    type="button"
                    className={`tf-dispatch__calchip tf-dispatch__calchip--${workOrder.priority.toLowerCase()}`}
                    onClick={() =>
                      canDispatch ? onOpenPanel(workOrder, column.userId) : undefined
                    }
                    title={`${workOrder.workOrderNo} — ${workOrder.subject}`}
                  >
                    {formatTime(workOrder.scheduledStart)} {workOrder.workOrderNo}
                    <span className="tf-visually-hidden">: {workOrder.subject}</span>
                  </button>
                ))}
              </span>
            );
          })}
        </div>
      ))}
      {board.technicians.length === 0 ? (
        <p className="tf-panel__subtitle">Atanabilir teknisyen yok.</p>
      ) : null}
    </div>
  );
}

// ------------------------- Liste -------------------------

function ListBoard({
  board,
  canDispatch,
  onOpenPanel,
}: {
  board: DispatchBoardResponse;
  canDispatch: boolean;
  onOpenPanel: (workOrder: BoardWorkOrder, technicianId?: string) => void;
}) {
  const rows = [
    ...board.technicians.flatMap((column) =>
      column.workOrders.map((workOrder) => ({ workOrder, technician: column.displayName })),
    ),
    ...board.queue.map((workOrder) => ({ workOrder, technician: 'Planlama bekleyen' })),
  ];
  return (
    <div className="tf-dispatch__list" role="table" aria-label="Günlük iş listesi">
      <div className="tf-dispatch__listrow tf-dispatch__listrow--head" role="row">
        <span role="columnheader">İş emri</span>
        <span role="columnheader">Konu</span>
        <span role="columnheader">Teknisyen</span>
        <span role="columnheader">Saat</span>
        <span role="columnheader">Durum</span>
        <span role="columnheader">SLA</span>
      </div>
      {rows.length === 0 ? (
        <p className="tf-panel__subtitle">Bu gün için kayıt yok.</p>
      ) : (
        rows.map(({ workOrder, technician }) => (
          <div className="tf-dispatch__listrow" role="row" key={workOrder.workOrderId}>
            <span role="cell">
              <a className="tf-table__customer" href={`/app/work-orders/${workOrder.workOrderId}`}>
                {workOrder.workOrderNo}
              </a>
            </span>
            <span role="cell" className="tf-dispatch__listsubject">
              {workOrder.subject}
              <span className="tf-table__sub">{workOrder.customerName}</span>
            </span>
            <span role="cell">{technician}</span>
            <span role="cell">
              {workOrder.scheduledStart
                ? `${formatTime(workOrder.scheduledStart)}–${formatTime(workOrder.scheduledEnd)}`
                : '—'}
            </span>
            <span role="cell">
              <StatusBadge tone={STATUS_TONES[workOrder.status]}>
                {WORK_ORDER_STATUS_LABELS[workOrder.status]}
              </StatusBadge>
            </span>
            <span role="cell">
              {workOrder.slaBreached ? (
                <StatusBadge tone="red">Aşıldı</StatusBadge>
              ) : workOrder.slaAtRisk ? (
                <StatusBadge tone="amber">Risk</StatusBadge>
              ) : (
                '—'
              )}
              {canDispatch ? (
                <button
                  type="button"
                  className="tf-dispatch__cardaction"
                  onClick={() => onOpenPanel(workOrder)}
                >
                  Planla / Ata
                </button>
              ) : null}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

// ------------------------- Planlama paneli (klavye alternatifi) -------------------------

function SchedulePanel({
  board,
  state,
  apiBaseUrl,
  csrf,
  canOverride,
  onClose,
  onSuccess,
}: {
  board: DispatchBoardResponse;
  state: SchedulePanelState;
  apiBaseUrl: string;
  csrf: string | undefined;
  canOverride: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { workOrder } = state;
  const initial = utcToTenantWallClock(workOrder.scheduledStart ?? '', board.timezone);
  const [technicianId, setTechnicianId] = useState(state.presetTechnicianId);
  const [dateStr, setDateStr] = useState(initial?.date ?? board.date);
  const [startTime, setStartTime] = useState(initial?.time ?? '09:00');
  const [endTime, setEndTime] = useState(
    initial
      ? (utcToTenantWallClock(workOrder.scheduledEnd ?? '', board.timezone)?.time ?? '13:00')
      : '13:00',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictPayload[] | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [successNote, setSuccessNote] = useState<string | null>(null);

  const selectedTechnician = board.technicians.find((column) => column.userId === technicianId);

  // Yetenek eşleştirmesi (danışma): kategori zorunlu yetenekleri ↔ üye yetenekleri.
  const skillMatch = useMemo(() => {
    if (!selectedTechnician) return null;
    const owned = new Set(selectedTechnician.skills.map((skill) => skill.key));
    return {
      matched: workOrder.requiredSkillKeys.filter((key) => owned.has(key)),
      missing: workOrder.requiredSkillKeys.filter((key) => !owned.has(key)),
    };
  }, [selectedTechnician, workOrder.requiredSkillKeys]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setConflicts(null);
    const scheduledStart = tenantWallClockToUtc(dateStr, startTime, board.timezone);
    const scheduledEnd = tenantWallClockToUtc(dateStr, endTime, board.timezone);
    if (!scheduledStart || !scheduledEnd) {
      setError('Tarih ve saat alanlarını doldurun');
      return;
    }
    if (new Date(scheduledEnd) <= new Date(scheduledStart)) {
      setError('Bitiş saati başlangıçtan sonra olmalı');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/v1/dispatch/schedule/${workOrder.workOrderId}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(csrf ? { 'x-csrf-token': csrf } : {}),
          },
          credentials: 'include',
          body: JSON.stringify({
            ...(technicianId ? { assigneeUserId: technicianId } : {}),
            scheduledStart,
            scheduledEnd,
            ...(conflicts && canOverride && overrideReason.trim().length >= 10
              ? { overrideConflict: true, overrideReason: overrideReason.trim() }
              : {}),
          }),
          signal: AbortSignal.timeout(10_000),
        },
      ).catch(() => null);
      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
        conflicts?: ConflictPayload[];
        skillWarnings?: string[];
      };
      if (!response.ok) {
        if (response.status === 409 && body.conflicts) {
          setConflicts(body.conflicts);
          setError('Planlama çakışması — ayrıntılar aşağıda');
        } else {
          setError(body.message ?? 'Planlama başarısız');
        }
        return;
      }
      setSuccessNote(
        body.skillWarnings && body.skillWarnings.length > 0
          ? `Planlandı. Uyarı: teknisyenin eksik yetenekleri — ${body.skillWarnings.join(', ')}`
          : 'Planlandı.',
      );
      // Pano yenilenene dek kısa onay; sonra paneli kapat.
      setTimeout(onSuccess, 600);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SideDrawer open onClose={onClose} title={`Planla: ${workOrder.workOrderNo}`}>
      <form className="tf-dispatch__form" onSubmit={submit}>
        <p className="tf-dispatch__formsummary">
          <strong>{workOrder.subject}</strong>
          <br />
          {workOrder.customerName} · {PRIORITY_LABELS[workOrder.priority]} ·{' '}
          {WORK_ORDER_STATUS_LABELS[workOrder.status]}
          {workOrder.requiredSkillKeys.length > 0
            ? ` · Gerekli yetenek: ${workOrder.requiredSkillKeys.join(', ')}`
            : ''}
        </p>

        <label className="tf-dispatch__field">
          <span>Teknisyen</span>
          <select value={technicianId} onChange={(event) => setTechnicianId(event.target.value)}>
            <option value="">— Atama yapmadan yalnız planla —</option>
            {board.technicians.map((column) => (
              <option key={column.userId} value={column.userId}>
                {column.displayName}
                {column.onTimeOff ? ' (izinli)' : ''}
                {column.team ? ` · ${column.team.name}` : ''}
              </option>
            ))}
          </select>
        </label>

        {skillMatch && workOrder.requiredSkillKeys.length > 0 ? (
          <p className="tf-dispatch__skillmatch">
            {skillMatch.matched.length}/{workOrder.requiredSkillKeys.length} gerekli yetenek
            eşleşiyor
            {skillMatch.missing.length > 0 ? (
              <>
                {' '}
                — eksik: <StatusBadge tone="amber">{skillMatch.missing.join(', ')}</StatusBadge>
              </>
            ) : (
              <>
                {' '}
                — <StatusBadge tone="green">tam eşleşme</StatusBadge>
              </>
            )}
          </p>
        ) : null}

        <label className="tf-dispatch__field">
          <span>Tarih</span>
          <input
            type="date"
            value={dateStr}
            onChange={(event) => setDateStr(event.target.value)}
            required
          />
        </label>

        <div className="tf-dispatch__fieldrow">
          <label className="tf-dispatch__field">
            <span>Başlangıç</span>
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              required
            />
          </label>
          <label className="tf-dispatch__field">
            <span>Bitiş</span>
            <input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              required
            />
          </label>
        </div>
        <p className="tf-panel__subtitle">
          Saatler kiracı saat diliminde ({board.timezone}) yorumlanır.
        </p>

        {conflicts ? (
          <div className="tf-dispatch__conflictbox" role="alert">
            <h4>Çakışma bulguları</h4>
            <ul>
              {conflicts.map((conflict, index) => (
                <li key={index}>
                  <StatusBadge tone={conflict.type === 'OVERLAP' ? 'red' : 'amber'}>
                    {CONFLICT_TYPE_LABELS[conflict.type]}
                  </StatusBadge>{' '}
                  {conflict.message}
                </li>
              ))}
            </ul>
            {canOverride ? (
              <>
                <label className="tf-dispatch__field">
                  <span>Üzerine planlama nedeni (zorunlu, en az 10 karakter)</span>
                  <textarea
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    rows={3}
                    placeholder="ör. müşteri acil talebi — teknisyen yarım saat önce ayrılacak"
                  />
                </label>
                <Button
                  type="submit"
                  variant="danger"
                  disabled={busy || overrideReason.trim().length < 10}
                >
                  Çakışmaya rağmen planla
                </Button>
              </>
            ) : (
              <p className="tf-panel__subtitle">
                Çakışma üzerine planlama yetkiniz yok — başka teknisyen veya saat deneyin.
              </p>
            )}
          </div>
        ) : null}

        {error ? (
          <Alert variant="danger" title="Planlama başarısız">
            {error}
          </Alert>
        ) : null}
        {successNote ? (
          <Alert variant="success" title="Planlandı">
            {successNote}
          </Alert>
        ) : null}

        <div className="tf-dispatch__formactions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy || conflicts !== null}>
            {busy ? 'Kaydediliyor…' : 'Planı kaydet'}
          </Button>
        </div>
      </form>
    </SideDrawer>
  );
}
