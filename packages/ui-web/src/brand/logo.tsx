import { useId, type CSSProperties } from 'react';

/**
 * TeknikFlow marka işareti — iki paralel rota parçasının ileri hareketli bir
 * "T" yolunda birleşmesi (docs/BRAND.md). Anahtar/wrench klişesi YOKTUR.
 * Geçiş tonu marka mavisi → teal (marka kişiliği: yetkin, sakin, endüstriyel).
 */
export interface LogoMarkProps {
  size?: number;
  className?: string;
}

export function LogoMark({ size = 34, className }: LogoMarkProps) {
  const gradientId = useId().replace(/[^a-zA-Z0-9-]/g, '');
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 34 34"
      role="img"
      aria-label="TeknikFlow markası"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          {/* stop-color presentation özniteliği var() desteklemez; CSS ile verilir */}
          <stop offset="0" style={{ stopColor: 'var(--tf-brand-blue)' }} />
          <stop offset="1" style={{ stopColor: 'var(--tf-brand-teal)' }} />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="32" height="32" rx="10" fill={`url(#${gradientId})`} />
      {/* İleri akan T yolu: üst bar (ok ucuyla) + sap + paralel rota parçası */}
      <g
        stroke="var(--tf-surface)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M9.5 11.5h10" />
        <path d="M19.5 8.8l3 2.7-3 2.7" />
        <path d="M14.5 11.5v11" />
        <path d="M9.5 17h5" />
      </g>
    </svg>
  );
}

export interface LogoProps {
  size?: number;
  /** Marka metni ("TeknikFlow") gösterilsin mi? */
  showWordmark?: boolean;
  /** Wordmark altındaki küçük tanım (örn. "SAHA SERVİS YÖNETİMİ"). */
  descriptor?: string;
  className?: string;
  style?: CSSProperties;
}

export function Logo({
  size = 34,
  showWordmark = true,
  descriptor = 'SAHA SERVİS YÖNETİMİ',
  className,
  style,
}: LogoProps) {
  return (
    <span
      className={className ? `tf-logo ${className}` : 'tf-logo'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 11, ...style }}
    >
      <LogoMark size={size} />
      {showWordmark ? (
        <span className="tf-logo__text">
          <strong>TeknikFlow</strong>
          {descriptor ? <small>{descriptor}</small> : null}
        </span>
      ) : null}
    </span>
  );
}
