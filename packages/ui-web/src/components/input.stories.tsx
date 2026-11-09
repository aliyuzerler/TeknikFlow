import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from 'storybook/test';
import { FormField, Input, SearchInput } from './input.js';

const meta = {
  title: 'Temel/Girdi (Input / FormField)',
  component: Input,
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Varsayilan: Story = {
  render: () => (
    <FormField label="Müşteri adı" hint="Yasal şirket ünvanı">
      {({ id, 'aria-describedby': describedBy }) => (
        <Input id={id} aria-describedby={describedBy} placeholder="Marmara Gıda A.Ş." />
      )}
    </FormField>
  ),
};

export const DogrulamaHatasi: Story = {
  render: () => (
    <FormField label="Telefon" required error="Bu alan 10 haneli olmalı" hint="Örn. 0532 000 00 00">
      {({ id, 'aria-describedby': describedBy }) => (
        <Input id={id} aria-describedby={describedBy} invalid value="532" />
      )}
    </FormField>
  ),
};

export const Arama: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return (
      <SearchInput
        aria-label="İş emri arama"
        value={value}
        onChange={setValue}
        placeholder="İş emri, müşteri veya ekipman ara"
        style={{ width: 320 }}
      />
    );
  },
};

/** Etkileşim: yazma, temizleme ve aria bağlarının çalıştığını doğrular. */
export const Etkilesim: Story = {
  tags: ['test'],
  render: () => {
    const [value, setValue] = useState('');
    return (
      <FormField label="Ekipman seri no" hint="Etikette bulunur">
        {({ id, 'aria-describedby': describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </FormField>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('Ekipman seri no');
    await userEvent.type(input, 'TF-8842');
    await expect(input).toHaveValue('TF-8842');
    // ipucu, aria-describedby üzerinden bağlıdır
    await expect(input).toHaveAccessibleDescription(/Etikette bulunur/);
  },
};

/** Etkileşim: arama temizleme düğmesi. */
export const AramaEtkilesim: Story = {
  tags: ['test'],
  render: () => {
    const [value, setValue] = useState('kompresör');
    return <SearchInput aria-label="Demo arama" value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Aramayı temizle' }));
    await expect(canvas.getByRole('searchbox')).toHaveValue('');
  },
};
