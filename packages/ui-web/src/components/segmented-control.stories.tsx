import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from 'storybook/test';
import { useState } from 'react';
import { SegmentedControl, type SegmentedOption } from './segmented-control.js';

type View = 'kanban' | 'takvim' | 'liste';

const OPTIONS: readonly SegmentedOption<View>[] = [
  { value: 'kanban', label: 'Kanban' },
  { value: 'takvim', label: 'Takvim' },
  { value: 'liste', label: 'Liste' },
];

const meta = {
  title: 'Form/Görünüm Seçici (SegmentedControl)',
  component: SegmentedControl,
  args: {
    options: OPTIONS,
    value: 'kanban',
    label: 'Pano görünümü',
  },
} satisfies Meta<typeof SegmentedControl<View>>;

export default meta;
type Story = StoryObj<typeof meta>;

function Controlled(props: { value: View; label: string }) {
  const [view, setView] = useState<View>(props.value);
  return (
    <div>
      <SegmentedControl
        options={OPTIONS}
        value={view}
        onValueChange={setView}
        label={props.label}
      />
      <p data-testid="secili" style={{ marginTop: 12 }}>
        Seçili: {view}
      </p>
    </div>
  );
}

export const Varsayilan: Story = {
  args: { value: 'kanban', onValueChange: () => undefined },
  render: (args) => <Controlled value={args.value as View} label={args.label} />,
};

export const DevreDisi: Story = {
  name: 'Devre dışı',
  args: { value: 'takvim', disabled: true, onValueChange: () => undefined },
  render: (args) => (
    <SegmentedControl
      options={OPTIONS}
      value={args.value as View}
      onValueChange={() => undefined}
      label={args.label}
      disabled={args.disabled}
    />
  ),
};

export const Etkilesim: Story = {
  tags: ['test'],
  args: { value: 'kanban', onValueChange: () => undefined },
  render: () => <Controlled value="kanban" label="Pano görünümü" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Radiogroup etiketi ve radyo rolleri.
    const group = canvas.getByRole('radiogroup', { name: 'Pano görünümü' });
    await expect(group).toBeVisible();
    const kanban = canvas.getByRole('radio', { name: 'Kanban' });
    const takvim = canvas.getByRole('radio', { name: 'Takvim' });
    const liste = canvas.getByRole('radio', { name: 'Liste' });
    await expect(kanban).toBeChecked();
    await expect(takvim).not.toBeChecked();

    // Klavye alternatifi: radyo deseni ok tuşlarıyla çalışır.
    await userEvent.click(takvim);
    await expect(takvim).toBeChecked();
    await expect(canvas.getByText('Seçili: takvim')).toBeVisible();

    await userEvent.click(liste);
    await expect(liste).toBeChecked();
    await expect(canvas.getByText('Seçili: liste')).toBeVisible();

    // Ok tuşu ile geri dönülebilir (tek sekme durağı grubu terk etmez).
    await userEvent.keyboard('[ArrowLeft]');
    await expect(canvas.getByText('Seçili: takvim')).toBeVisible();
  },
};

/** Devre dışı grupta tüm radyolar tıklanamaz. */
export const DevreDisiErisilebilirlik: Story = {
  tags: ['test'],
  args: { value: 'kanban', disabled: true, onValueChange: () => undefined },
  render: () => (
    <SegmentedControl
      options={OPTIONS}
      value="kanban"
      onValueChange={() => undefined}
      label="Pano görünümü"
      disabled
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('radio', { name: 'Kanban' })).toBeDisabled();
    await expect(canvas.getByRole('radio', { name: 'Takvim' })).toBeDisabled();
    await expect(canvas.getByRole('radio', { name: 'Liste' })).toBeDisabled();
  },
};
