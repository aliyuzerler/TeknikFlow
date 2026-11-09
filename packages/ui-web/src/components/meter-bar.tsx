'use client';

export interface MeterBarProps {
  /** 0..100+ — yüzdesi aşan yükler de görünür kalır (kırpılmış çubuk + sayı). */
  value: number;
  /** Erişilebilir etiket (ör. "Emre Yılmaz gün yükü"). */
  label: string;
  /** Yük tonu — eşikleri çağıran belirler (varsayılan 'ok'). */
  tone?: 'ok' | 'info' | 'warning' | 'danger';
  /** Yanına yazılan değer metni (ör. "360 / 480 dk · %75"). */
  valueText?: string;
  /** Gösterge yüksekliği varyantı. */
  size?: 'sm' | 'md';
}

const TONE_CLASS = {
  ok: 'tf-meter__fill--ok',
  info: 'tf-meter__fill--info',
  warning: 'tf-meter__fill--warning',
  danger: 'tf-meter__fill--danger',
} as const;

/**
 * Kapasite/yük göstergesi — teknisyen doluluk, takım kapasitesi.
 *
 * role="meter" + aria-valuenow/min/max: ekran okuyucular yükü sayısal
 * duyurur; değer metni görsel eşlikçidir. %100 üstü yüklerde çubuk dolar
 * ama sayı gerçeği korur (yanlış "tamam" izlenimi vermez).
 */
export function MeterBar({ value, label, tone = 'ok', valueText, size = 'md' }: MeterBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={`tf-meter tf-meter--${size}`}>
      <div
        className="tf-meter__track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-valuetext={valueText ?? `${clamped}%`}
      >
        <div className={`tf-meter__fill ${TONE_CLASS[tone]}`} style={{ width: `${clamped}%` }} />
      </div>
      {valueText ? (
        <span className="tf-meter__text">
          <span className="tf-visually-hidden">{label}: </span>
          {valueText}
        </span>
      ) : null}
    </div>
  );
}
