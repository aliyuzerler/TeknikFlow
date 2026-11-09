export type AvatarTone = 'blue' | 'green' | 'pink' | 'gray';

export interface AvatarProps {
  initials: string;
  tone?: AvatarTone;
  size?: 'md' | 'sm';
  className?: string;
}

/** Kullanıcı/teknisyen avatarı — baş harfler + ton. */
export function Avatar({ initials, tone = 'blue', size = 'md', className }: AvatarProps) {
  const classes = [
    'tf-avatar',
    tone !== 'blue' ? `tf-avatar--${tone}` : '',
    size === 'sm' ? 'tf-avatar--sm' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} aria-hidden="true">
      {initials}
    </span>
  );
}

export interface ProgressBarProps {
  value: number;
  max?: number;
  /** Ekran okuyucu için neyin ilerlediği (örn. "Mehmet Kaya iş yükü"). */
  label: string;
}

/** İnce ilerleme çubuğu — role=progressbar, aria değerleri tam. */
export function ProgressBar({ value, max = 100, label }: ProgressBarProps) {
  const clamped = Math.min(Math.max(value, 0), max);
  return (
    <span
      className="tf-progress"
      role="progressbar"
      aria-label={label}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <span className="tf-progress__bar" style={{ width: `${(clamped / max) * 100}%` }} />
    </span>
  );
}

export type SyncState = 'synced' | 'syncing' | 'pending' | 'error';

export interface SyncStatusProps {
  state: SyncState;
  pendingCount?: number;
}

const SYNC_LABEL: Record<SyncState, (pending?: number) => string> = {
  synced: () => 'Senkronize',
  syncing: () => 'Senkronize ediliyor',
  pending: (pending) => (pending ? `Kuyrukta: ${pending}` : 'Bekleyen değişiklik'),
  error: () => 'Senkronizasyon hatası',
};

/** Senkron durumu göstergesi — nokta + metin (renk tek başına anlatılmaz). */
export function SyncStatus({ state, pendingCount }: SyncStatusProps) {
  return (
    <span
      className={`tf-sync tf-sync--${state}`}
      role="status"
      aria-live="polite"
      aria-label={`Çevrimdışı senkron durumu: ${SYNC_LABEL[state](pendingCount)}`}
    >
      <span className="tf-sync__dot" aria-hidden="true" />
      {SYNC_LABEL[state](pendingCount)}
    </span>
  );
}

export interface OfflineBannerProps {
  online: boolean;
  pendingCount?: number;
}

/**
 * Çevrimdışı bandı — bağlantı yoksa uyarı, kuyruk birikirken bilgi verir.
 * Kritik uyarı: role=status + aria-live ile duyurulur.
 */
export function OfflineBanner({ online, pendingCount = 0 }: OfflineBannerProps) {
  if (online && pendingCount === 0) return null;
  return (
    <div
      className={`tf-offline-banner ${!online ? 'tf-offline-banner--error' : ''}`.trim()}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true">{online ? null : <OfflineGlyph />}</span>
      <span>
        {!online
          ? 'Çevrimdışısınız — değişiklikler cihazda saklanıyor, bağlantı gelince gönderilecek.'
          : `${pendingCount} değişiklik senkronize edilmeyi bekliyor.`}
      </span>
    </div>
  );
}

function OfflineGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentcolor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 13h5l1.5 3h5L16 13h5" />
      <path d="M5 5h14l2 8v6H3v-6z" />
      <path d="m4 4 16 16" />
    </svg>
  );
}
