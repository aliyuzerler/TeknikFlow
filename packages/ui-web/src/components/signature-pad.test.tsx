import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignaturePad, sanitizeStrokes } from './signature-pad.js';

/**
 * TEST-08 §5 — SignaturePad: erişilebilir etiketler, temizle davranışı,
 * nokta toplama (jsdom'da canvas 2d bağlamı yok — dayanıklı çizim) ve
 * stroke temizleme yardımcısı.
 */

describe('SignaturePad', () => {
  it('etiket + ipucu + temizle düğmesi görünür', () => {
    render(<SignaturePad label="Müşteri imzası" />);
    expect(screen.getByText('Müşteri imzası')).toBeInTheDocument();
    expect(screen.getByTestId('tf-signature-hint')).toHaveTextContent(
      'Fare veya parmakla buraya imzalayın',
    );
    expect(screen.getByRole('button', { name: /Temizle/i })).toBeDisabled();
  });

  it('canvas aria-label taşır (0 nokta)', () => {
    render(<SignaturePad aria-label="Teknisyen imzası" />);
    expect(screen.getByRole('img', { name: /Teknisyen imzası — 0 nokta/i })).toBeInTheDocument();
  });

  it('temizle: onStrokesChange boş diziyle çağrılır', async () => {
    const user = userEvent.setup();
    const onStrokesChange = vi.fn();
    render(<SignaturePad onStrokesChange={onStrokesChange} />);

    // jsdom'da getBoundingClientRect sıfır → noktalar clamp edilir (dayanıklı).
    const pad = screen.getByTestId('tf-signature-canvas');
    await user.pointer([
      { keys: '[MouseLeft>]', target: pad, coords: { x: 30, y: 30 } },
      { coords: { x: 60, y: 45 } },
      { coords: { x: 90, y: 60 } },
      { keys: '[/MouseLeft]' },
    ]);
    expect(onStrokesChange).toHaveBeenCalledTimes(1);
    expect(onStrokesChange.mock.calls[0]![0]).toHaveLength(1);
    expect(onStrokesChange.mock.calls[0]![0]![0]).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: /Temizle/i }));
    expect(onStrokesChange).toHaveBeenLastCalledWith([]);
    // Sayaç sıfır → ipucu yer tutucuya döner.
    expect(screen.getByTestId('tf-signature-hint')).toHaveTextContent(
      'Fare veya parmakla buraya imzalayın',
    );
    expect(screen.getByRole('img', { name: /0 nokta/i })).toBeInTheDocument();
  });

  it('tek nokta stroke düşürülür (görünür iz yok)', async () => {
    const user = userEvent.setup();
    const onStrokesChange = vi.fn();
    render(<SignaturePad onStrokesChange={onStrokesChange} />);
    const pad = screen.getByTestId('tf-signature-canvas');
    await user.pointer([
      { keys: '[MouseLeft>]', target: pad, coords: { x: 30, y: 30 } },
      { keys: '[/MouseLeft]' },
    ]);
    expect(onStrokesChange).toHaveBeenNthCalledWith(1, []);
  });

  it('devre dışı: işaretçi olayları etkisiz', async () => {
    const user = userEvent.setup();
    const onStrokesChange = vi.fn();
    render(<SignaturePad disabled onStrokesChange={onStrokesChange} />);
    const pad = screen.getByTestId('tf-signature-canvas');
    await user.pointer([
      { keys: '[MouseLeft>]', target: pad, coords: { x: 30, y: 30 } },
      { coords: { x: 60, y: 45 } },
      { keys: '[/MouseLeft]' },
    ]);
    expect(onStrokesChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Temizle/i })).toBeDisabled();
  });
});

describe('sanitizeStrokes', () => {
  it("tek noktalı stroke'lar düşürülür", () => {
    const strokes = [
      [
        { x: 0.1, y: 0.2, t: 0 },
        { x: 0.2, y: 0.25, t: 40 },
      ],
      [{ x: 0.5, y: 0.5, t: 10 }],
    ];
    expect(sanitizeStrokes(strokes)).toHaveLength(1);
  });

  it('boş dizi aynen geçer', () => {
    expect(sanitizeStrokes([])).toEqual([]);
  });
});
