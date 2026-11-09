import type { ReactNode } from 'react';

export interface DetailItem {
  label: string;
  children: ReactNode;
}

export interface DetailListProps {
  /** Ekran okuyucu bağlamı (ör. "Müşteri bilgileri"). */
  label: string;
  items: DetailItem[];
  /** İki sütun (etiket|değer) düzeni — dar ekranda tek sütuna düşer. */
  columns?: 1 | 2;
}

/**
 * Tanım listesi (key/value) — detay sayfalarının bilgi blokları.
 * dl/dt/dd semantiğiyle erişilebilir; boş değer yerine "—" gösterir.
 */
export function DetailList({ label, items, columns = 2 }: DetailListProps) {
  return (
    <dl className={`tf-details ${columns === 1 ? 'tf-details--stack' : ''}`} aria-label={label}>
      {items.map((item) => (
        <div className="tf-details__row" key={item.label}>
          <dt className="tf-details__term">{item.label}</dt>
          <dd className="tf-details__desc">{item.children ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
