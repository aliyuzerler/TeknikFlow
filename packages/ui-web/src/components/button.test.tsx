import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button.js';

describe('Button', () => {
  it('etiketini basar ve tıklamayı iletir', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>İş Emri Oluştur</Button>);
    await user.click(screen.getByRole('button', { name: 'İş Emri Oluştur' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled düğme tıklamayı YUTMAZ (etkisizdir)', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button onClick={onClick} disabled>
        Kilitli
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Kilitli' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('yükleme durumunda aria-busy taşır, etkisizdir ve spinner gösterir', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button onClick={onClick} loading>
        Kaydediliyor
      </Button>,
    );
    const button = screen.getByRole('button', { name: /Kaydediliyor/ });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.querySelector('[data-testid="tf-btn-spinner"]')).toBeInTheDocument();
  });

  it('variant sınıflarını uygular (primary/danger/ghost)', () => {
    const { rerender } = render(<Button variant="primary">A</Button>);
    expect(screen.getByRole('button', { name: 'A' })).toHaveClass('tf-btn--primary');
    rerender(<Button variant="danger">A</Button>);
    expect(screen.getByRole('button', { name: 'A' })).toHaveClass('tf-btn--danger');
    rerender(<Button variant="ghost">A</Button>);
    expect(screen.getByRole('button', { name: 'A' })).toHaveClass('tf-btn--ghost');
  });
});
