import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './status-badge.js';
import { Icon } from '../icons.js';

describe('StatusBadge', () => {
  it('durumu METİN olarak taşır — renk tek başına gösterge olamaz', () => {
    render(<StatusBadge tone="green">Tamamlandı</StatusBadge>);
    expect(screen.getByText('Tamamlandı')).toBeInTheDocument();
  });

  it('ikonsuz render’da nokta süsü aria-hidden taşır', () => {
    const { container } = render(<StatusBadge tone="blue">Sahada</StatusBadge>);
    const dot = container.querySelector('.tf-badge__dot');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });

  it('ikon verildiğinde ikon kanalı da render olur (renk körlüğü güvenliği)', () => {
    render(
      <StatusBadge tone="amber" icon={<Icon name="clock" size={12} />}>
        Parça bekliyor
      </StatusBadge>,
    );
    expect(screen.getByText('Parça bekliyor')).toBeInTheDocument();
    expect(containerHasIcon()).toBe(true);
    function containerHasIcon() {
      return document.querySelector('.tf-badge__icon') !== null;
    }
  });

  it('ton sınıfını uygular', () => {
    render(<StatusBadge tone="red">SLA riski</StatusBadge>);
    expect(screen.getByText('SLA riski').closest('.tf-badge')).toHaveClass('tf-badge--red');
  });
});
