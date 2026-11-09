import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Logo, LogoMark } from './logo.js';
import { Icon, type IconName } from '../icons.js';

describe('LogoMark', () => {
  it('role=img + Türkçe erişilebilir ad taşır', () => {
    render(<LogoMark />);
    expect(screen.getByRole('img', { name: 'TeknikFlow markası' })).toBeInTheDocument();
  });

  it('istenilen ebat ve sınıfla render olur', () => {
    const { container } = render(<LogoMark size={44} className="bm" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '44');
    expect(svg).toHaveAttribute('height', '44');
  });
});

describe('Logo', () => {
  it('wordmark + tanım ile marka bloğu basar', () => {
    render(<Logo />);
    expect(screen.getByText('TeknikFlow')).toBeInTheDocument();
    expect(screen.getByText('SAHA SERVİS YÖNETİMİ')).toBeInTheDocument();
  });

  it('wordmark kapatılabilir (yalnız işaret)', () => {
    render(<Logo showWordmark={false} />);
    expect(screen.queryByText('TeknikFlow')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'TeknikFlow markası' })).toBeInTheDocument();
  });
});

describe('Icon', () => {
  it('süs ikonu aria-hidden ve 24 viewBox ile render olur', () => {
    const { container } = render(<Icon name="search" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
  });

  it('tüm ikon adları render edilir (eksik yol regressyonu yok)', () => {
    const names: IconName[] = [
      'overview',
      'work-orders',
      'dispatch',
      'customers',
      'assets',
      'map',
      'team',
      'warehouse',
      'maintenance',
      'quotes',
      'reports',
      'settings',
      'billing',
      'search',
      'bell',
      'menu',
      'close',
      'chevron-right',
      'plus',
      'alert',
      'clock',
      'users',
      'check',
      'refresh',
      'list',
      'pin',
      'inbox',
      'inbox-off',
    ];
    for (const name of names) {
      const { container } = render(<Icon name={name} />);
      const svg = container.querySelector('svg');
      expect(svg, `ikon render edilemedi: ${name}`).toBeTruthy();
      expect(
        svg?.querySelectorAll('path, rect, circle').length,
        `ikon yolu boş: ${name}`,
      ).toBeGreaterThan(0);
    }
  });
});
