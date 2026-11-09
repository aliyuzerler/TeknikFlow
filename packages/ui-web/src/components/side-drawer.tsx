import { useId, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '../hooks/use-focus-trap.js';
import { Icon } from '../icons.js';

export interface SideDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  side?: 'left' | 'right';
}

/**
 * Yan panel (drawer) — odak tuzağı, ESC ile kapatma, kapat düğmesi,
 * odak geri yükleme. Mobil gezinme ve detay panelleri için ortak temel.
 */
export function SideDrawer({ open, onClose, title, children, side = 'right' }: SideDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(open, drawerRef, onClose);

  if (!open) return null;

  return (
    <>
      <div className="tf-drawer__overlay" aria-hidden="true" onClick={onClose} />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`tf-drawer ${side === 'left' ? 'tf-drawer--left' : ''}`.trim()}
      >
        <div className="tf-drawer__head">
          <h2 className="tf-drawer__title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="tf-drawer__close"
            aria-label="Paneli kapat"
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="tf-drawer__body">{children}</div>
      </div>
    </>
  );
}
