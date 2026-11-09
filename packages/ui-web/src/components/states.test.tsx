import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState, ErrorState, Skeleton } from './states.js';

describe('EmptyState', () => {
  it('başlık + açıklama basar; aksiyon düğmesi çalışır', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        title="Henüz müşteri yok"
        description="İlk müşterinizi ekleyerek başlayın."
        action={
          <button type="button" onClick={onAction}>
            Müşteri ekle
          </button>
        }
      />,
    );
    expect(
      screen.getByRole('heading', { level: 3, name: 'Henüz müşteri yok' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Müşteri ekle' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorState', () => {
  it('role=alert ile hata duyurur ve yeniden dene çağırır', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<ErrorState title="Veriler yüklenemedi" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Veriler yüklenemedi');
    await user.click(screen.getByRole('button', { name: /Tekrar dene/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('retry düğmesi etiketi özelleştirilebilir', () => {
    render(<ErrorState onRetry={() => undefined} retryLabel="Bağlantıyı yenile" />);
    expect(screen.getByRole('button', { name: 'Bağlantıyı yenile' })).toBeInTheDocument();
  });
});

describe('Skeleton', () => {
  it('ekran okuyucuya "Yükleniyor" duyurur, görsel süsü gizler', () => {
    render(<Skeleton />);
    expect(screen.getByRole('status', { name: 'Yükleniyor' })).toBeInTheDocument();
  });

  it('text varyantı istenen satır sayısını üretir', () => {
    const { container } = render(<Skeleton variant="text" lines={3} />);
    expect(container.querySelectorAll('.tf-skeleton')).toHaveLength(3);
  });

  it('circle varyantı dairesel boyut alır', () => {
    const { container } = render(<Skeleton variant="circle" width={40} height={40} />);
    const node = container.querySelector('.tf-skeleton') as HTMLElement;
    expect(node.style.borderRadius).toBe('50%');
  });
});
