import type { ReactNode } from 'react';
import { Icon } from '../icons.js';

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Sonraki adım eylemi (örn. "İlk müşteriyi ekle" düğmesi). */
  action?: ReactNode;
  icon?: ReactNode;
}

/** Boş durum — sonraki aksiyonla birlikte (DESIGN_SYSTEM: "empty state with next action"). */
export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="tf-empty">
      <span className="tf-empty__icon">{icon ?? <Icon name="inbox" size={22} />}</span>
      <h3 className="tf-empty__title">{title}</h3>
      {description ? <p className="tf-empty__desc">{description}</p> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

/** Hata durumu — yeniden dene eylemiyle (asla sessiz hata yok). */
export function ErrorState({
  title = 'Bir sorun oluştu',
  description = 'Veriler yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.',
  onRetry,
  retryLabel = 'Tekrar dene',
}: ErrorStateProps) {
  return (
    <div className="tf-error" role="alert">
      <span className="tf-error__icon">
        <Icon name="alert" size={22} />
      </span>
      <h3 className="tf-error__title">{title}</h3>
      <p className="tf-error__desc">{description}</p>
      {onRetry ? (
        <div>
          <button type="button" className="tf-btn" onClick={onRetry}>
            <Icon name="refresh" size={14} />
            {retryLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export interface SkeletonProps {
  variant?: 'rect' | 'text' | 'circle';
  width?: number | string;
  height?: number | string;
  /** text varyantında satır sayısı. */
  lines?: number;
}

/** Yükleme iskeleti — dekoratif; ekran okuyucuya "Yükleniyor" duyurur. */
export function Skeleton({ variant = 'rect', width, height, lines = 1 }: SkeletonProps) {
  const style =
    variant === 'circle'
      ? { width: width ?? 34, height: height ?? 34, borderRadius: '50%' }
      : {
          width: width ?? (variant === 'text' ? '100%' : 120),
          height: height ?? (variant === 'text' ? 12 : 20),
        };

  return (
    <span role="status" aria-label="Yükleniyor">
      {Array.from({ length: variant === 'text' ? lines : 1 }).map((_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="tf-skeleton"
          style={{
            ...style,
            display: variant === 'text' ? 'block' : 'inline-block',
            marginBottom: variant === 'text' ? 8 : 0,
          }}
        />
      ))}
    </span>
  );
}
