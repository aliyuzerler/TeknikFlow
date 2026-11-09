import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Yükleme durumu: görünür spinner, aria-busy ve otomatik devre dışı. */
  loading?: boolean;
  /** Sol süs ikonu (anlam metinde taşınmalı). */
  icon?: ReactNode;
  fullWidth?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'tf-btn--primary',
  secondary: '',
  ghost: 'tf-btn--ghost',
  danger: 'tf-btn--danger',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    fullWidth = false,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const classes = [
    'tf-btn',
    VARIANT_CLASS[variant],
    size === 'sm' ? 'tf-btn--sm' : '',
    fullWidth ? 'tf-btn--full' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="tf-btn__spin" aria-hidden="true" data-testid="tf-btn-spinner" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});
