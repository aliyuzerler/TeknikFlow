import {
  useId,
  forwardRef,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Icon } from '../icons.js';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/** Tek satır metin girdisi (tf-input kabuğu içinde). */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className, ...rest },
  ref,
) {
  return (
    <span className={`tf-input ${invalid ? 'tf-input--invalid' : ''} ${className ?? ''}`.trim()}>
      <input
        ref={ref}
        className="tf-input__control"
        aria-invalid={invalid || undefined}
        {...rest}
      />
    </span>
  );
});

export interface FormFieldProps {
  label: string;
  /** Girdi denetimi — kimliği otomatik eşlenir (htmlFor/aria-describedby). */
  children: (ids: { id: string; 'aria-describedby': string | undefined }) => ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
}

/**
 * Etiket + ipucu + hata bağlı form alanı kabuğu.
 * children bir render fonksiyonudur; id'leri girdiye aktarınca
 * erişilebilirlik bağları (label→input, error→input) otomatik kurulur.
 */
export function FormField({ label, children, hint, error, required, className }: FormFieldProps) {
  const id = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={`tf-field ${className ?? ''}`.trim()}>
      <label className="tf-field__label" htmlFor={id}>
        {label}
        {required ? (
          <span className="tf-field__req" aria-hidden="true">
            *
          </span>
        ) : null}
        {required ? <span className="tf-visually-hidden">(zorunlu)</span> : null}
      </label>
      {children({ id, 'aria-describedby': describedBy || undefined })}
      {hint ? (
        <p className="tf-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="tf-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface SearchInputProps {
  /** Ekran okuyucu etiketi — yer tutucu metnin yerine geçer. */
  'aria-label': string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Arama girdisi: büyüteç ikonu + temizle düğmesi. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
  style,
  ...rest
}: SearchInputProps) {
  return (
    <span
      className={`tf-input ${disabled ? 'tf-input--disabled' : ''} ${className ?? ''}`.trim()}
      style={style}
    >
      <Icon name="search" size={16} style={{ color: 'var(--tf-placeholder)', flexShrink: 0 }} />
      <input
        type="search"
        className="tf-input__control"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      />
      {value.length > 0 && !disabled ? (
        <button
          type="button"
          className="tf-input__clear"
          aria-label="Aramayı temizle"
          onClick={() => onChange('')}
        >
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </span>
  );
}
