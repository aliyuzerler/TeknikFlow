import type { ReactNode } from 'react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  'aria-label'?: string;
}

/** Sayfa yolu — son öğe aria-current="page". */
export function Breadcrumbs({ items, 'aria-label': ariaLabel = 'Sayfa yolu' }: BreadcrumbsProps) {
  return (
    <nav className="tf-breadcrumbs" aria-label={ariaLabel}>
      <ol>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`}>
              {isLast || !item.href ? (
                <span aria-current={isLast ? 'page' : undefined}>{item.label}</span>
              ) : (
                <a href={item.href}>{item.label}</a>
              )}
              {!isLast ? (
                <span aria-hidden="true" style={{ color: 'var(--tf-separator)' }}>
                  /
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface PageHeaderProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  actions?: ReactNode;
}

/** Sayfa başlığı bloğu (eyebrow + h1 + alt yazı + eylemler). */
export function PageHeader({ title, eyebrow, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="tf-page-header">
      <div>
        {eyebrow ? <div className="tf-page-header__eyebrow">{eyebrow}</div> : null}
        <h1 className="tf-page-header__title">{title}</h1>
        {subtitle ? <p className="tf-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="tf-page-header__actions">{actions}</div> : null}
    </div>
  );
}
