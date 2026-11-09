import type { ReactNode } from 'react';

export type MetricTone = 'blue' | 'green' | 'amber' | 'violet';

export interface MetricCardProps {
  /** Kartın neyi ölçtüğü (örn. "Açık iş emirleri"). */
  label: string;
  value: ReactNode;
  /** Büyük değerin yanındaki küçük ek (örn. " / 18"). */
  valueSuffix?: string;
  delta?: string;
  deltaTone?: 'up' | 'down' | 'flat';
  /** Değişim notu (örn. "geçen haftaya göre"). */
  deltaNote?: string;
  /** Uyarı tonlu alt not (örn. "2 kritik · 3 uyarı") — delta yerine kullanılır. */
  note?: string;
  icon?: ReactNode;
  tone?: MetricTone;
  className?: string;
}

/** Operasyonel metrik kartı (design/preview.html .metric birebir). */
export function MetricCard({
  label,
  value,
  valueSuffix,
  delta,
  deltaTone = 'up',
  deltaNote,
  note,
  icon,
  tone = 'blue',
  className,
}: MetricCardProps) {
  const iconClass =
    tone === 'blue' ? 'tf-metric__icon' : `tf-metric__icon tf-metric__icon--${tone}`;
  const deltaClass =
    deltaTone === 'up' ? 'tf-metric__delta' : `tf-metric__delta tf-metric__delta--${deltaTone}`;
  return (
    <div className={`tf-metric ${className ?? ''}`.trim()}>
      <div className="tf-metric__top">
        <span>{label}</span>
        {icon ? <span className={iconClass}>{icon}</span> : null}
      </div>
      <strong className="tf-metric__value">
        {value}
        {valueSuffix ? <span className="tf-metric__suffix">{valueSuffix}</span> : null}
      </strong>
      {delta ? (
        <div className={deltaClass}>
          {delta}
          {deltaNote ? <span className="tf-metric__delta-note">{deltaNote}</span> : null}
        </div>
      ) : null}
      {note ? <div className="tf-metric__note">{note}</div> : null}
    </div>
  );
}
