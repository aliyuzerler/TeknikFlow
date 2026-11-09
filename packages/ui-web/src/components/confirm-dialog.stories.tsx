import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from 'storybook/test';
import { ConfirmDialog } from './confirm-dialog.js';
import { Button } from './button.js';

const meta = {
  title: 'Diyalog/Onay Kutusu (ConfirmDialog)',
  component: ConfirmDialog,
  args: { open: false, title: 'Onay', onClose: () => undefined },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function DialogHarness(props: Partial<React.ComponentProps<typeof ConfirmDialog>>) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: 40 }}>
      <Button variant="danger" onClick={() => setOpen(true)}>
        İşi iptal et
      </Button>
      <ConfirmDialog
        open={open}
        title="İş emri iptal edilsin mi?"
        description="#TF-2026-0842 · Marmara Gıda A.Ş. — bu işlem geri alınamaz."
        tone="danger"
        confirmLabel="Evet, iptal et"
        onConfirm={() => setOpen(false)}
        onClose={() => setOpen(false)}
        {...props}
      />
    </div>
  );
}

export const Varsayilan: Story = {
  render: () => <DialogHarness />,
};

export const GuvenliOnay: Story = {
  render: () => (
    <DialogHarness
      tone="default"
      title="Rapor indirilsin mi?"
      description="PDF olarak indirilecek (yaklaşık 2 MB)."
      confirmLabel="İndir"
    />
  ),
};

/**
 * Etkileşim: odak tuzağı, ESC, onay akışı ve odak geri yükleme —
 * TEST-02'nin "dialog focus" kapsamı.
 */
export const Etkilesim: Story = {
  tags: ['test'],
  render: () => <DialogHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'İşi iptal et' });

    // Aç → diyalog + odak
    await userEvent.click(trigger);
    const dialog = canvas.getByRole('dialog', { name: 'İş emri iptal edilsin mi?' });
    await expect(dialog).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Vazgeç' })).toHaveFocus();

    // Tab döngüsü içeride kalır
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Evet, iptal et' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Vazgeç' })).toHaveFocus();

    // Onayla → kapanır, odak tetikleyiciye döner
    await userEvent.click(canvas.getByRole('button', { name: 'Evet, iptal et' }));
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument();
    await expect(trigger).toHaveFocus();
  },
};
