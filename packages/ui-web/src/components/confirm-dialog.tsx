import { useId, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '../hooks/use-focus-trap.js';
import { Button } from './button.js';
import { Icon } from '../icons.js';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Yıkıcı eylem (kırmızı vurgu + uyarı ikonu). */
  tone?: 'default' | 'danger';
  onConfirm?: () => void;
  onClose: () => void;
}

/**
 * Onay kutusu — odak tuzağı, ESC ile kapatma, odak geri yükleme.
 * Vazgeç düğmesi ilk odaklı olandır (yıkıcı eylemde varsayılan = güvenli yol).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Onayla',
  cancelLabel = 'Vazgeç',
  tone = 'default',
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useFocusTrap(open, dialogRef, onClose);

  if (!open) return null;

  return (
    <div className="tf-dialog__overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="tf-dialog"
      >
        <h2 className="tf-dialog__title" id={titleId}>
          {tone === 'danger' ? (
            <span className="tf-dialog__icon-danger">
              <Icon name="alert" size={20} style={{ marginRight: 6, verticalAlign: '-4px' }} />
            </span>
          ) : null}
          {title}
        </h2>
        {description ? (
          <p className="tf-dialog__desc" id={descriptionId}>
            {description}
          </p>
        ) : null}
        <div className="tf-dialog__actions">
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
