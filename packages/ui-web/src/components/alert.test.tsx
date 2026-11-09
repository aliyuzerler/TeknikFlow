import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alert } from './alert.js';

describe('Alert', () => {
  it('dört varyant render olur ve başlık taşır', () => {
    const { rerender } = render(<Alert variant="info" title="Bilgi başlık" />);
    expect(screen.getByText('Bilgi başlık')).toBeInTheDocument();

    rerender(<Alert variant="success" title="Başarı başlık" />);
    expect(screen.getByText('Başarı başlık')).toBeInTheDocument();

    rerender(<Alert variant="warning" title="Uyarı başlık" />);
    expect(screen.getByText('Uyarı başlık')).toBeInTheDocument();

    rerender(<Alert variant="danger" title="Hata başlık" />);
    expect(screen.getByText('Hata başlık')).toBeInTheDocument();
  });

  it('danger/warning pasif → role=alert (ekran okuyucu bildirimi)', () => {
    const { container, rerender } = render(<Alert variant="danger" title="Hata" />);
    expect(container.querySelector('.tf-alert')).toHaveAttribute('role', 'alert');

    rerender(<Alert variant="warning" title="Uyarı" />);
    expect(container.querySelector('.tf-alert')).toHaveAttribute('role', 'alert');
  });

  it('info/success pasif → rol bildirimi YOK (gereksiz kesinti yok)', () => {
    const { container, rerender } = render(<Alert variant="info" title="Bilgi" />);
    expect(container.querySelector('.tf-alert')).not.toHaveAttribute('role', 'alert');

    rerender(<Alert variant="success" title="Başarı" />);
    expect(container.querySelector('.tf-alert')).not.toHaveAttribute('role', 'alert');
  });

  it('etkileşimli içerik (passive=false) → rol YOK', () => {
    const { container } = render(
      <Alert variant="danger" title="Etkileşimli" passive={false}>
        <button type="button">Tekrar dene</button>
      </Alert>,
    );
    expect(container.querySelector('.tf-alert')).not.toHaveAttribute('role', 'alert');
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeInTheDocument();
  });

  it('ikon + metin taşır (renk tek başına anlam taşımaz)', () => {
    const { container } = render(<Alert variant="warning" title="Kontrol" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('Kontrol')).toBeInTheDocument();
  });
});
