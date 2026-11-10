'use client';

import { useId, type CSSProperties } from 'react';

export interface QuantityInputProps {
  /** Kontrollü değer — boş alan '' ile temsil edilir. */
  value: string;
  onChange: (value: string) => void;
  /** Erişilebilir etiket (aria-label; görsel etiket FormField ile verilir). */
  label: string;
  /** Birim soneki (ad, lt, kutu...) — görsel + aria'da birleşir. */
  unit?: string;
  /** Miktar adım büyüklüğü (stepper). */
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  invalid?: boolean;
  style?: CSSProperties;
}

const QUANTITY_RE = /^\d*(?:[.,]\d{0,4})?$/;

/**
 * Faz 09 — miktar girdisi: 4 ondalık üst sınırı (sözleşme QuantityInput),
 * birim soneki ve adım düğmeleri. Klavye erişilebilir; yazımda virgül/nokta
 * kabul edilir — sözleşmeye nokta ile gönderilir (binary float kirli değeri
 * sözleşme reddeder).
 */
export function QuantityInput({
  value,
  onChange,
  label,
  unit,
  step = 1,
  min = 0,
  max = 1_000_000,
  disabled = false,
  invalid = false,
  style,
}: QuantityInputProps) {
  const stepUpId = useId();
  const numeric = value === '' ? undefined : Number(value.replace(',', '.'));
  const ariaValue = numeric === undefined || Number.isNaN(numeric) ? undefined : numeric;

  function clamp(next: number): string {
    const bounded = Math.min(max, Math.max(min, next));
    return String(Math.round(bounded * 10_000) / 10_000);
  }

  return (
    <span
      className={`tf-qty ${invalid ? 'tf-qty--invalid' : ''}`.trim()}
      style={style}
      data-testid="quantity-input"
    >
      <button
        type="button"
        id={stepUpId}
        className="tf-qty__btn"
        aria-label={`${label} azalt`}
        disabled={disabled || ariaValue === undefined}
        onClick={() => {
          const current = ariaValue ?? min;
          onChange(clamp(current - step));
        }}
      >
        −
      </button>
      <input
        className="tf-qty__control"
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={value}
        disabled={disabled}
        placeholder="0"
        onChange={(event) => {
          const raw = event.target.value;
          if (raw !== '' && !QUANTITY_RE.test(raw)) return;
          onChange(raw);
        }}
      />
      {unit ? <span className="tf-qty__unit">{unit}</span> : null}
      <button
        type="button"
        className="tf-qty__btn"
        aria-label={`${label} artır`}
        disabled={disabled || ariaValue === undefined}
        onClick={() => {
          const current = ariaValue ?? min;
          onChange(clamp(current + step));
        }}
      >
        +
      </button>
    </span>
  );
}
