'use client';

import { Icon } from '../icons.js';

export interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  /**
   * Serileştirilebilir bağlantı şablonu: "{page}" yer tutucusu sayfa sayısına
   * çevrilir (ör. "/app/customers?page={page}&q=abc"). Sunucu bileşenlerinden
   * fonksiyon props'u geçilemez — bu yüzden şablon dizgisi.
   */
  hrefTemplate?: string;
  /** Yalnız istemci kullanımında: programatik sayfa değişikliği. */
  onChange?: (page: number) => void;
  /** Erişilebilir bağlam etiketi (ör. "Müşteri listesi"). */
  label: string;
}

/**
 * Sayfalama denetimi — tabloların altındaki gezinme.
 *
 * 'use client': köşe düğmeleri onClick taşır (RSC'ye fonksiyon geçilmez);
 * hrefTemplate verilirse bağlantı tabanlı çalışır (sunucu sayfalarından
 * güvenle kullanılabilir — tüm props'lar serileştirilebilir).
 * Sayfa sayısı tekse tüm denetim gizlenir.
 */
export function Pager({ page, pageSize, total, hrefTemplate, onChange, label }: PagerProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const hrefFor = (nextPage: number): string | undefined =>
    hrefTemplate ? hrefTemplate.replace('{page}', String(nextPage)) : undefined;

  const base = 'tf-pager__btn';
  const prevDisabled = page <= 1;
  const nextDisabled = page >= pageCount;

  function button(targetPage: number, disabled: boolean, ariaLabel: string, flip: boolean) {
    const content = (
      <>
        <Icon
          name="chevron-right"
          size={14}
          style={flip ? { transform: 'rotate(180deg)' } : undefined}
        />
        <span className="tf-visually-hidden">{ariaLabel}</span>
      </>
    );
    const href = disabled ? undefined : hrefFor(targetPage);
    if (href) {
      return (
        <a className={base} href={href} aria-label={ariaLabel}>
          {content}
        </a>
      );
    }
    return (
      <button
        type="button"
        className={`${base} ${disabled ? `${base}--disabled` : ''}`}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => onChange?.(targetPage)}
      >
        {content}
      </button>
    );
  }

  return (
    <nav className="tf-pager" aria-label={`${label} sayfalama`}>
      <span className="tf-pager__info">
        {from}–{to} / {total}
      </span>
      <span className="tf-pager__controls">
        {button(page - 1, prevDisabled, 'Önceki sayfa', true)}
        <span className="tf-pager__current" aria-current="page">
          {page} / {pageCount}
        </span>
        {button(page + 1, nextDisabled, 'Sonraki sayfa', false)}
      </span>
    </nav>
  );
}
