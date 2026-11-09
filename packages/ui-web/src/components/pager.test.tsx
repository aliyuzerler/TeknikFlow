import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pager } from './pager.js';

describe('Pager', () => {
  it('çok sayfalı listede aralık bilgisini ve denetimleri gösterir', () => {
    render(<Pager page={2} pageSize={20} total={95} label="Test" />);
    expect(screen.getByText('21–40 / 95')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Önceki sayfa' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).toBeEnabled();
    expect(screen.getByText('2 / 5')).toHaveAttribute('aria-current', 'page');
  });

  it('tek sayfada hiçbir şey render etmez', () => {
    const { container } = render(<Pager page={1} pageSize={20} total={15} label="Test" />);
    expect(container.querySelector('.tf-pager')).toBeNull();
  });

  it('ilk sayfada önceki, son sayfada sonraki devre dışı', () => {
    const { rerender } = render(<Pager page={1} pageSize={10} total={30} label="T" />);
    expect(screen.getByRole('button', { name: 'Önceki sayfa' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).toBeEnabled();

    rerender(<Pager page={3} pageSize={10} total={30} label="T" />);
    expect(screen.getByRole('button', { name: 'Önceki sayfa' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).toBeDisabled();
  });

  it('onChange ile sayfa değişimi bildirilir', () => {
    const onChange = vi.fn();
    render(<Pager page={2} pageSize={10} total={30} label="T" onChange={onChange} />);
    screen.getByRole('button', { name: 'Sonraki sayfa' }).click();
    expect(onChange).toHaveBeenCalledWith(3);
    screen.getByRole('button', { name: 'Önceki sayfa' }).click();
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('hrefTemplate verildiğinde bağlantı üretir (devre dışıysa düğme kalır)', () => {
    render(<Pager page={1} pageSize={10} total={30} label="T" hrefTemplate="/x?page={page}" />);
    const next = screen.getByRole('link', { name: 'Sonraki sayfa' });
    expect(next).toHaveAttribute('href', '/x?page=2');
    // İlk sayfa devre dışı → link DEĞİL düğme.
    expect(screen.getByRole('button', { name: 'Önceki sayfa' })).toBeDisabled();
  });

  it('erişilebilir gezinme etiketi taşır', () => {
    render(<Pager page={1} pageSize={10} total={30} label="Müşteri listesi" />);
    expect(
      screen.getByRole('navigation', { name: 'Müşteri listesi sayfalama' }),
    ).toBeInTheDocument();
  });
});
