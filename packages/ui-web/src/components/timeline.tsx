import type { ReactNode } from 'react';

export type TimelineTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface TimelineItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** Ek bağlam satırı (aktör, zaman...) — sağda küçük metin. */
  meta?: ReactNode;
  tone?: TimelineTone;
}

export interface TimelineProps {
  /** Ekran okuyucu bağlamı (ör. "İş emri zaman çizelgesi"). */
  label: string;
  items: TimelineItem[];
  /** Kronolojik (asc) ya da en yeni önce (desc). */
  order?: 'asc' | 'desc';
  emptyMessage?: string;
}

/**
 * Olay akışı / zaman çizelgesi — iş emri yaşam döngüsü, müşteri geçmişi.
 * ol/li semantiğiyle erişilebilir; ton renkleri durum geçişlerini kodlar
 * (success: tamamlandı, warning: bekleme, danger: iptal...).
 */
export function Timeline({
  label,
  items,
  order = 'desc',
  emptyMessage = 'Henüz kayıt yok',
}: TimelineProps) {
  if (items.length === 0) {
    return (
      <p className="tf-timeline__empty" aria-label={label}>
        {emptyMessage}
      </p>
    );
  }
  const ordered = order === 'desc' ? [...items].reverse() : items;
  return (
    <ol className="tf-timeline" aria-label={label}>
      {ordered.map((item) => (
        <li
          className={`tf-timeline__item tf-timeline__item--${item.tone ?? 'neutral'}`}
          key={item.id}
        >
          <span className="tf-timeline__dot" aria-hidden="true" />
          <div className="tf-timeline__body">
            <div className="tf-timeline__head">
              <span className="tf-timeline__title">{item.title}</span>
              {item.meta ? <span className="tf-timeline__meta">{item.meta}</span> : null}
            </div>
            {item.description ? <div className="tf-timeline__desc">{item.description}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
