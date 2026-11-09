import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SideDrawer } from './side-drawer.js';

function renderDrawer() {
  const onClose = vi.fn();
  render(
    <SideDrawer open onClose={onClose} title="Filtreler">
      <button type="button">Sadece bugün</button>
    </SideDrawer>,
  );
  return { onClose };
}

describe('SideDrawer', () => {
  it('açıkken role=dialog + başlık + kapat düğmesi sunar', () => {
    renderDrawer();
    const dialog = screen.getByRole('dialog', { name: 'Filtreler' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Paneli kapat' })).toBeInTheDocument();
  });

  it('açılışta odak paneldeki ilk öğededir (kapat düğmesi)', () => {
    renderDrawer();
    expect(screen.getByRole('button', { name: 'Paneli kapat' })).toHaveFocus();
  });

  it('ESC onClose çağırır', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab döngüsü panel içinde kalır (kapat ↔ içerik)', async () => {
    const user = userEvent.setup();
    renderDrawer();
    const content = screen.getByRole('button', { name: 'Sadece bugün' });
    const close = screen.getByRole('button', { name: 'Paneli kapat' });
    expect(close).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(content).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(close).toHaveFocus();
  });

  it('kapat düğmesi onClose çağırır ve odak tetikleyiciye döner', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Filtreleri aç
          </button>
          <SideDrawer open={open} onClose={() => setOpen(false)} title="Filtreler">
            <p>İçerik</p>
          </SideDrawer>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Filtreleri aç' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Filtreler' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Paneli kapat' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
