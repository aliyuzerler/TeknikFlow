import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from 'storybook/test';
import { useState } from 'react';
import { SignaturePad, type SignaturePadStroke } from './signature-pad.js';

type StoryArgs = {
  label: string;
  height: number;
  disabled: boolean;
};

const meta = {
  title: 'Form/İmza Tuvali (SignaturePad)',
  component: SignaturePad,
  args: {
    label: 'Müşteri imzası',
    height: 180,
    disabled: false,
  },
  parameters: {
    a11y: {
      config: {
        rules: [
          // Canvas içinde metin alternatifi aria-label ile sağlanır.
          { id: 'canvas-name', enabled: true },
        ],
      },
    },
  },
} satisfies Meta<typeof SignaturePad>;

export default meta;
type Story = StoryObj<typeof meta>;

function Controlled(props: { label: string; height: number; disabled: boolean }) {
  const [strokes, setStrokes] = useState<SignaturePadStroke[]>([]);
  const pointCount = strokes.reduce((total, stroke) => total + stroke.length, 0);
  return (
    <div style={{ maxWidth: 480 }}>
      <SignaturePad
        label={props.label}
        height={props.height}
        disabled={props.disabled}
        onStrokesChange={setStrokes}
      />
      <p data-testid="nokta" style={{ marginTop: 10 }}>
        Toplam nokta: {pointCount} · çizgi: {strokes.length}
      </p>
    </div>
  );
}

export const Varsayilan: Story = {
  render: (args) => <Controlled {...(args as StoryArgs)} />,
};

export const DevreDisi: Story = {
  name: 'Devre dışı',
  args: { disabled: true },
  render: (args) => <Controlled {...(args as StoryArgs)} />,
};

export const KisaYukseklik: Story = {
  name: 'Kısa yükseklik (kompakt)',
  args: { height: 120 },
  render: (args) => <Controlled {...(args as StoryArgs)} />,
};

/** Etkileşim: tuvale çizim nokta sayacını artırır; temizle sıfırlar. */
export const CizimVeTemizleme: Story = {
  name: 'Etkileşim: çizim ve temizleme',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pad = canvas.getByTestId('tf-signature-canvas');
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: pad, coords: { x: 20, y: 40 } },
      { coords: { x: 80, y: 60 } },
      { coords: { x: 140, y: 90 } },
      { keys: '[/MouseLeft]' },
    ]);
    await expect(canvas.getByTestId('tf-signature-hint')).not.toHaveTextContent('0 nokta');
    await userEvent.click(canvas.getByRole('button', { name: /Temizle/i }));
    // Sayaç sıfır → ipucu yer tutucuya döner.
    await expect(canvas.getByTestId('tf-signature-hint')).toHaveTextContent(
      'Fare veya parmakla buraya imzalayın',
    );
    await expect(canvas.getByTestId('tf-signature-canvas')).toHaveAttribute('data-points', '0');
  },
};
