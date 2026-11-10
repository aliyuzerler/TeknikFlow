import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from 'storybook/test';
import { FormField } from './input.js';
import { QuantityInput } from './quantity-input.js';

const meta = {
  title: 'Temel/Miktar Girdisi (QuantityInput)',
  component: QuantityInput,
} satisfies Meta<typeof QuantityInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Varsayilan: Story = {
  args: { value: '1', label: 'Tüketilen miktar', onChange: () => undefined },
  render: () => {
    const [value, setValue] = useState('1');
    return (
      <FormField label="Tüketilen miktar" hint="En çok 4 ondalık">
        {() => (
          <QuantityInput label="Tüketilen miktar" unit="ad" value={value} onChange={setValue} />
        )}
      </FormField>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Tüketilen miktar' });
    await userEvent.clear(input);
    await userEvent.type(input, '2.5');
    await expect(input).toHaveValue('2.5');
  },
};

export const AdimDugmeleri: Story = {
  args: { value: '3', label: 'Sayılan miktar', onChange: () => undefined },
  render: () => {
    const [value, setValue] = useState('3');
    return (
      <FormField label="Sayılan miktar" hint="+ / − düğmeleri adım atlar">
        {() => (
          <QuantityInput label="Sayılan miktar" unit="kutu" value={value} onChange={setValue} />
        )}
      </FormField>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const artir = canvas.getByRole('button', { name: 'Sayılan miktar artır' });
    await userEvent.click(artir);
    const input = canvas.getByRole('textbox', { name: 'Sayılan miktar' });
    await expect(input).toHaveValue('4');
  },
};

export const GecersizVeDevreDisi: Story = {
  args: { value: '', label: 'Stok aşımı', onChange: () => undefined },
  render: () => {
    const [, setValue] = useState('');
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <FormField label="Stok aşımı" error="Miktar kullanılabilir bakiyeyi aşıyor">
          {() => (
            <QuantityInput label="Stok aşımı" unit="ad" value="999" onChange={setValue} invalid />
          )}
        </FormField>
        <FormField label="Kilitli kalem">
          {() => (
            <QuantityInput
              label="Kilitli kalem"
              unit="lt"
              value="1.5"
              onChange={setValue}
              disabled
            />
          )}
        </FormField>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const disabled = canvas.getByRole('textbox', { name: 'Kilitli kalem' });
    await expect(disabled).toBeDisabled();
  },
};

export const OndalikSiniri: Story = {
  args: { value: '', label: 'Ondalık sınırı', onChange: () => undefined },
  render: () => {
    const [value, setValue] = useState('');
    return (
      <FormField label="Ondalık sınırı" hint="5. basamak kabul edilmez (0.0001 adım)">
        {() => <QuantityInput label="Ondalık sınırı" unit="m" value={value} onChange={setValue} />}
      </FormField>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Ondalık sınırı' });
    await userEvent.type(input, '1.23456');
    // 5. basamak yazımda reddedilir — değer 4 ondalıkta kalır.
    await expect(input).toHaveValue('1.2345');
  },
};
