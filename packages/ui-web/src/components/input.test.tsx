import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormField, Input, SearchInput } from './input.js';

describe('Input + FormField', () => {
  it('etiket, girdiye tıklayarak odak sağlar (label/htmlFor bağı)', async () => {
    const user = userEvent.setup();
    render(
      <FormField label="Müşteri adı">
        {({ id, 'aria-describedby': describedBy }) => (
          <Input id={id} aria-describedby={describedBy} />
        )}
      </FormField>,
    );
    await user.click(screen.getByLabelText('Müşteri adı'));
    expect(screen.getByLabelText('Müşteri adı')).toHaveFocus();
  });

  it('zorunlu alan (zorunlu) ekran okuyucuya duyurulur', () => {
    render(
      <FormField label="E-posta" required>
        {({ id }) => <Input id={id} />}
      </FormField>,
    );
    expect(screen.getByText('(zorunlu)')).toBeInTheDocument();
  });

  it('hata mesajı role=alert ile bağlı ve aria-describedby ile eşlenir', () => {
    render(
      <FormField label="Telefon" error="Bu alan 10 haneli olmalı">
        {({ id, 'aria-describedby': describedBy }) => (
          <Input id={id} aria-describedby={describedBy} invalid />
        )}
      </FormField>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Bu alan 10 haneli olmalı');
    const input = screen.getByLabelText('Telefon');
    expect(input).toHaveAttribute('aria-describedby', alert.id);
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('ipucu metni de aria-describedby zincirine girer', () => {
    render(
      <FormField label="Seri no" hint="Ekipman etiketinde bulunur" error="Zorunlu alan">
        {({ id, 'aria-describedby': describedBy }) => (
          <Input id={id} aria-describedby={describedBy} />
        )}
      </FormField>,
    );
    const input = screen.getByLabelText('Seri no');
    const described = input.getAttribute('aria-describedby') ?? '';
    const ids = described.split(' ');
    const hint = screen.getByText('Ekipman etiketinde bulunur');
    const error = screen.getByRole('alert');
    expect(ids).toContain(hint.id);
    expect(ids).toContain(error.id);
  });
});

describe('SearchInput', () => {
  function Harness() {
    const [value, setValue] = useState('');
    return <SearchInput aria-label="Genel arama" value={value} onChange={setValue} />;
  }

  it('yazarken değeri güncel tutar; temizle düğmesi değeri boşaltır', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('searchbox', { name: 'Genel arama' });
    await user.type(input, 'kompresör');
    expect(input).toHaveValue('kompresör');

    const clear = screen.getByRole('button', { name: 'Aramayı temizle' });
    await user.click(clear);
    expect(input).toHaveValue('');
  });

  it('değer boşken temizle düğmesi render edilmez', () => {
    render(<SearchInput aria-label="Ara" value="" onChange={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Aramayı temizle' })).not.toBeInTheDocument();
  });

  it('onChange her karakterde çağrılır', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SearchInput aria-label="Ara" value="abc" onChange={onChange} />);
    // value prop'u kontrolsüz akışı simüle eder; değişim olayını doğrula
    await user.type(screen.getByRole('searchbox', { name: 'Ara' }), 'd');
    expect(onChange).toHaveBeenCalledWith('abcd');
  });

  it('disabled iken girdi kullanılamaz', () => {
    render(<SearchInput aria-label="Ara" value="" onChange={() => undefined} disabled />);
    expect(screen.getByRole('searchbox', { name: 'Ara' })).toBeDisabled();
  });
});

describe('Input (ileri referans)', () => {
  it('ref girdiye iletilir', () => {
    function Probe() {
      const ref = useRef<HTMLInputElement>(null);
      return (
        <>
          <Input ref={ref} />
          <button type="button" onClick={() => ref.current?.focus()}>
            odakla
          </button>
        </>
      );
    }
    render(<Probe />);
    screen.getByRole('button', { name: 'odakla' }).click();
    expect(document.querySelector('input')).toHaveFocus();
  });
});
