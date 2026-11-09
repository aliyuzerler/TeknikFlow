import type { SessionView, WorkOrderView } from '@teknikflow/contracts';

/**
 * Faz 07 — mobil biçimlendirme. Depolama UTC (ISO 8601); gösterim kiracı
 * yerel saat diliminde (Europe/Istanbul — kalıcı UTC+3). tr-TR etiketler.
 */

export const TENANT_TIME_ZONE = 'Europe/Istanbul';

const dateTimeFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: TENANT_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: TENANT_TIME_ZONE,
  day: '2-digit',
  month: 'long',
  weekday: 'long',
});

const timeFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: TENANT_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dateTimeFormatter.format(new Date(iso));
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dateFormatter.format(new Date(iso));
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return timeFormatter.format(new Date(iso));
}

/** Planlama penceresi: "09 Mar, 14:00 – 16:00" ya da tarih değişirse iki gün. */
export function formatScheduleWindow(start: string | null, end: string | null): string {
  if (!start || !end) return 'Planlanmadı';
  const sameDay = dateFormatter.format(new Date(start)) === dateFormatter.format(new Date(end));
  if (sameDay) {
    return `${dateFormatter.format(new Date(start))} ${timeFormatter.format(new Date(start))} – ${timeFormatter.format(new Date(end))}`;
  }
  return `${formatDateTime(start)} – ${formatDateTime(end)}`;
}

/** SLA: terminal durumlarda aşım yok; kalan süre ile risk etiketi. */
export function slaLabel(
  order: Pick<WorkOrderView, 'slaDueAt' | 'status' | 'slaBreached'>,
  now = new Date(),
): {
  tone: 'danger' | 'warning' | 'success' | 'none';
  text: string;
} {
  const terminal = ['COMPLETED', 'CLOSED', 'CANCELLED'];
  if (!order.slaDueAt || terminal.includes(order.status)) {
    return { tone: 'none', text: 'SLA —' };
  }
  const due = new Date(order.slaDueAt);
  const remainingMinutes = Math.round((due.getTime() - now.getTime()) / 60_000);
  if (remainingMinutes < 0) {
    return { tone: 'danger', text: `SLA aşımı ${formatDateTime(order.slaDueAt)}` };
  }
  if (remainingMinutes <= 240) {
    return { tone: 'warning', text: `SLA risk — ${Math.max(0, remainingMinutes)} dk kaldı` };
  }
  return { tone: 'success', text: `SLA ${formatDateTime(order.slaDueAt)}` };
}

/** Liste göstergesi için yenileme zamanı ("12:45'te senkronize edildi"). */
export function formatSyncedAt(iso: string | null | undefined): string {
  if (!iso) return 'Hiç senkronize edilmedi';
  return `${timeFormatter.format(new Date(iso))} senkronize edildi`;
}

export function sessionKindLabel(kind: SessionView['kind']): string {
  return kind === 'MOBILE' ? 'Mobil' : 'Web';
}
