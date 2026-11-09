import type { ReactNode } from 'react';
import { Icon } from '../icons.js';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  variant: AlertVariant;
  /** Kısa, eyleme dönük başlık. */
  title: string;
  children?: ReactNode;
  /**
   * Etkileşimli içerik (düğme/bağlantı) varsa false — o zaman rol bildirimi
   * yapılmaz (rol=alert ekran okuyucuda geçiş yapar).
   */
  passive?: boolean;
}

const VARIANT_CLASS: Record<AlertVariant, string> = {
  info: 'tf-alert tf-alert--info',
  success: 'tf-alert tf-alert--success',
  warning: 'tf-alert tf-alert--warning',
  danger: 'tf-alert tf-alert--danger',
};

const VARIANT_ICON: Record<AlertVariant, Parameters<typeof Icon>[0]['name']> = {
  info: 'clock',
  success: 'check',
  warning: 'alert',
  danger: 'alert',
};

/**
 * Satır içi bildirim (callout) — form hataları, izin reddi, sistem durumu.
 * Renk YALNIZ zamanmaz: metin + ikon taşır (WCAG 1.4.1).
 */
export function Alert({ variant, title, children, passive = true }: AlertProps) {
  return (
    <div
      className={VARIANT_CLASS[variant]}
      role={passive && (variant === 'danger' || variant === 'warning') ? 'alert' : undefined}
    >
      <span className="tf-alert__icon">
        <Icon name={VARIANT_ICON[variant]} size={18} />
      </span>
      <div className="tf-alert__body">
        <strong className="tf-alert__title">{title}</strong>
        {children ? <div className="tf-alert__content">{children}</div> : null}
      </div>
    </div>
  );
}
