import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './confirm-dialog.js';

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <ConfirmDialog
      open
      title="İş emri iptal edilsin mi?"
      description="Bu işlem kaydı geri alınamaz."
      onConfirm={onConfirm}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onConfirm, onClose };
}

describe('ConfirmDialog', () => {
  it('açıkken role=dialog + aria-modal + başlık bağları taşır', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(screen.getByText('Bu işlem kaydı geri alınamaz.')).toBeInTheDocument();
  });

  it('açılışta odak VAZGEÇ düğmesindedir (güvenli varsayılan)', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Vazgeç' })).toHaveFocus();
  });

  it('ESC kapatmayı çağırır', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab döngüsü diyalog içinde kalır', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'Onayla' })).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'Vazgeç' })).toHaveFocus();
  });

  it('onay düğmesi onConfirm çağırır', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Onayla' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('kapalıyken hiçbir şey render etmez', () => {
    render(<ConfirmDialog open={false} title="Görünmez" onClose={() => undefined} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('kapanınca odak açan öğeye geri döner (WCAG 2.1.2)', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            İptal et
          </button>
          <ConfirmDialog
            open={open}
            title="Emin misiniz?"
            onConfirm={() => setOpen(false)}
            onClose={() => setOpen(false)}
          />
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'İptal et' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vazgeç' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Vazgeç' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
