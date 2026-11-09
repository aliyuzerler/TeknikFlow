import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Yüzey kartı — tf-card gövdesi; içeriği çağıran belirler. */
export function Card({ children, className, ...rest }: CardProps) {
  return (
    <div className={`tf-card ${className ?? ''}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export interface PanelProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Başlık için h düzeyi (sayfa ana başlığıyla yarışmasın). */
  headingLevel?: 2 | 3;
}

/** Panel: başlık + (alt başlık) + eylem alanı + gövde + (alt bilgi). */
export function Panel({
  title,
  subtitle,
  actions,
  footer,
  children,
  className,
  headingLevel = 2,
}: PanelProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className={`tf-panel ${className ?? ''}`.trim()}>
      <div className="tf-panel__head">
        <div>
          <Heading className="tf-panel__title">{title}</Heading>
          {subtitle ? <p className="tf-panel__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="tf-panel__actions">{actions}</div> : null}
      </div>
      <div className="tf-panel__body">{children}</div>
      {footer ? <div className="tf-panel__footer">{footer}</div> : null}
    </section>
  );
}
