'use client';

import { useId } from 'react';

export interface SegmentedOption<K extends string> {
  value: K;
  label: string;
  /** Seçenekken gösterilecek ikon adı (opsiyonel). */
  icon?: 'list' | 'clock' | 'work-orders';
}

export interface SegmentedControlProps<K extends string> {
  options: readonly SegmentedOption<K>[];
  value: K;
  onValueChange: (value: K) => void;
  /** Erişilebilir grup etiketi (ör. "Pano görünümü"). */
  label: string;
  /** İstemci-yalnız kullanım (RSC'ye fonksiyon geçilmez). */
  disabled?: boolean;
}

/**
 * Bölünmüş görünüm seçici — dispatch panosunun kanban/takvim/liste
 * geçişi. WAI-ARIA radiogram deseni: radyo grubu + her seçenek radyo
 * düğmesi; klavye ok tuşları doğal çalışır, tek sekme durağı.
 */
export function SegmentedControl<K extends string>({
  options,
  value,
  onValueChange,
  label,
  disabled = false,
}: SegmentedControlProps<K>) {
  const groupId = useId();
  return (
    <div className="tf-segmented" role="radiogroup" aria-label={label} data-disabled={disabled}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className="tf-segmented__option"
            htmlFor={`${groupId}-${option.value}`}
          >
            <input
              id={`${groupId}-${option.value}`}
              type="radio"
              name={groupId}
              className="tf-visually-hidden"
              value={option.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onValueChange(option.value)}
            />
            <span
              className={`tf-segmented__label ${checked ? 'tf-segmented__label--active' : ''}`}
              data-checked={checked}
            >
              {option.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
