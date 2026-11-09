import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from 'storybook/test';
import { SideDrawer } from './side-drawer.js';
import { Button } from './button.js';

const meta = {
  title: 'Diyalog/Yan Panel (SideDrawer)',
  component: SideDrawer,
  args: { open: false, onClose: () => undefined, title: 'Panel', children: null },
} satisfies Meta<typeof SideDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: 40, minHeight: 320 }}>
      <Button onClick={() => setOpen(true)}>Filtreleri aç</Button>
      <SideDrawer open={open} onClose={() => setOpen(false)} title="Filtreler">
        <div style={{ display: 'grid', gap: 10 }}>
          <p style={{ margin: 0, color: 'var(--tf-muted)' }}>
            Panel içeriği — filtre, detay veya form alanları.
          </p>
          <Button variant="secondary">Sadece bugün</Button>
          <Button variant="secondary">SLA riski olanlar</Button>
        </div>
      </SideDrawer>
    </div>
  );
}

export const Varsayilan: Story = {
  render: () => <DrawerHarness />,
};

/**
 * Etkileşim: açma, odak tuzağı, ESC ile kapatma ve odak geri yükleme —
 * TEST-02'nin "keyboard navigation" kapsamı.
 */
export const Etkilesim: Story = {
  tags: ['test'],
  render: () => <DrawerHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Filtreleri aç' });

    await userEvent.click(trigger);
    const drawer = canvas.getByRole('dialog', { name: 'Filtreler' });
    await expect(drawer).toBeInTheDocument();
    // İlk odak: diyalogdaki ilk odaklanabilir öğe — kapat düğmesi (ConfirmDialog ile aynı kural).
    await expect(canvas.getByRole('button', { name: 'Paneli kapat' })).toHaveFocus();

    // Tab döngüsü panel içinde kalır
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Sadece bugün' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'SLA riski olanlar' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Paneli kapat' })).toHaveFocus();

    // ESC ile kapat → odak tetikleyiciye döner
    await userEvent.keyboard('{Escape}');
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument();
    await expect(trigger).toHaveFocus();
  },
};
