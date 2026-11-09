import type { ReactNode } from 'react';

export type BadgeTone = 'blue' | 'green' | 'amber' | 'red' | 'info' | 'gray';

export interface StatusBadgeProps {
  /** Renk tonu — ETİKET METNİ olmadan durum asla tek başına renkle anlatılmaz. */
  tone?: BadgeTone;
  /** Opsiyonel küçük ikon (renk körlüğü güvenliği için ikinci kanal). */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Durum rozeti — docs/DESIGN_SYSTEM.md: "Renk asla tek başına durum göstergesi
 * olamaz; durumu etiket ve/veya ikonla eşleştir." Bu bileşen metinsiz
 * render edilmez (children zorunlu) ve nokta + metin birlikte taşınır.
 */
export function StatusBadge({ tone = 'blue', icon, children, className }: StatusBadgeProps) {
  const classes = ['tf-badge', `tf-badge--${tone}`, className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={classes}>
      {icon ? (
        <span className="tf-badge__icon">{icon}</span>
      ) : (
        <span className="tf-badge__dot" aria-hidden="true" />
      )}
      <span>{children}</span>
    </span>
  );
}
