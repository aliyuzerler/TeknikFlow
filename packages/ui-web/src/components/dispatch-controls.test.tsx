import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MeterBar } from './meter-bar.js';
import { SegmentedControl } from './segmented-control.js';

/**
 * TEST-06 — yeni paylaşılan bileşenlerin birim testleri.
 * MeterBar: meter rolü + değer duyurumu + kırpma semantiği.
 * SegmentedControl: radiogroup deseni + klavye/odak erişilebilirliği.
 */

describe('MeterBar', () => {
  it('meter rolü ve aria değerlerini taşır', () => {
    render(<MeterBar value={45} label="Gün yükü" valueText="216 / 480 dk · %45" />);
    const meter = screen.getByRole('meter', { name: 'Gün yükü' });
    expect(meter).toHaveAttribute('aria-valuenow', '45');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '216 / 480 dk · %45');
  });

  it('değer metni yoksa yüzde duyurur', () => {
    render(<MeterBar value={70} label="Kapasite" />);
    expect(screen.getByRole('meter', { name: 'Kapasite' })).toHaveAttribute(
      'aria-valuetext',
      '70%',
    );
  });

  it('negatif/aşırı değerler [0,100] aralığına kırpılır', () => {
    const { rerender } = render(<MeterBar value={140} label="Aşırı" />);
    expect(screen.getByRole('meter', { name: 'Aşırı' })).toHaveAttribute('aria-valuenow', '100');
    rerender(<MeterBar value={-5} label="Negatif" />);
    expect(screen.getByRole('meter', { name: 'Negatif' })).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'kanban', label: 'Kanban' },
    { value: 'takvim', label: 'Takvim' },
    { value: 'liste', label: 'Liste' },
  ] as const;

  it('radiogroup + radyo rolleri; seçili işaretli', () => {
    render(
      <SegmentedControl
        options={options}
        value="kanban"
        onValueChange={() => undefined}
        label="Pano görünümü"
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Pano görünümü' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Kanban' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Takvim' })).not.toBeChecked();
  });

  it('seçim değişikliği geri çağrıyı tetikler (fare ve klavye)', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={options}
        value="kanban"
        onValueChange={onChange}
        label="Görünüm"
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Takvim' }));
    expect(onChange).toHaveBeenCalledWith('takvim');
    // Klavye alternatifi: Enter/Space (radyo girdisi üzerinde).
    fireEvent.click(screen.getByRole('radio', { name: 'Liste' }));
    expect(onChange).toHaveBeenCalledWith('liste');
  });

  it('devre dışı grupta tüm radyolar kilitli', () => {
    render(
      <SegmentedControl
        options={options}
        value="kanban"
        onValueChange={() => undefined}
        label="Görünüm"
        disabled
      />,
    );
    for (const option of options) {
      expect(screen.getByRole('radio', { name: option.label })).toBeDisabled();
    }
  });
});
