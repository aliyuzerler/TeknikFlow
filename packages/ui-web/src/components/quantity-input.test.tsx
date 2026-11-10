import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuantityInput } from './quantity-input.js';

describe('QuantityInput', () => {
  it('değer ve birim gösterilir; erişilebilir etiket bağlanır', () => {
    render(
      <QuantityInput label="Tüketilen miktar" unit="ad" value="2.5" onChange={() => {}} />,
    );
    const input = screen.getByRole('textbox', { name: 'Tüketilen miktar' });
    expect(input).toHaveValue('2.5');
    expect(screen.getByText('ad')).toBeInTheDocument();
    expect(screen.getByTestId('quantity-input')).toBeInTheDocument();
  });

  it('artır/azalt düğmeleri adım atlar ve üst sınıra sıkıştırır', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <QuantityInput label="Miktar" value="9.9999" step={0.5} max={10} onChange={onChange} />,
    );
    await user.click(screen.getByRole('button', { name: 'Miktar artır' }));
    expect(onChange).toHaveBeenLastCalledWith('10');

    rerender(<QuantityInput label="Miktar" value="0.2" step={0.5} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Miktar azalt' }));
    expect(onChange).toHaveBeenLastCalledWith('0');
  });

  it('4 ondalıkı aşan yazımı reddeder; boş değer serbesttir', () => {
    const onChange = vi.fn();
    render(<QuantityInput label="Miktar" value="1.2345" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Miktar' });
    fireEvent.change(input, { target: { value: '1.23456' } });
    // 5. basamak regex reddi → onChange çağrılmaz.
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '2,5' } });
    // Virgül kabul edilir (sözleşmeye nokta ile gönderilir).
    expect(onChange).toHaveBeenLastCalledWith('2,5');
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('devre dışıyken girdi ve düğmeler kilitlenir', () => {
    render(<QuantityInput label="Miktar" value="1" disabled onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Miktar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Miktar artır' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Miktar azalt' })).toBeDisabled();
  });

  it('geçersiz durum aria-invalid taşır', () => {
    render(<QuantityInput label="Miktar" value="999" invalid onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Miktar' })).toHaveAttribute('aria-invalid');
  });
});
