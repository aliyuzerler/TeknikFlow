import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from 'storybook/test';
import { Alert } from './alert.js';
import { Button } from './button.js';

const meta = {
  title: 'Durumlar/Satır İçi Bildirim (Alert)',
  component: Alert,
  args: { variant: 'info', title: 'Bildirim', passive: true },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bilgi: Story = {
  args: {
    variant: 'info',
    title: 'Seçim kaydedildi',
    children: 'Değişiklikler tüm ekip üyelerine uygulanacak.',
  },
};

export const Basari: Story = {
  args: {
    variant: 'success',
    title: 'Davet gönderildi',
    children: 'Kullanıcı daveti kabul ettiğinde üye listesinde görünecek.',
  },
};

export const Uyari: Story = {
  args: {
    variant: 'warning',
    title: 'Plan limiti yaklaşıyor',
    children: 'Kullanıcı kotanızın %80’ine ulaştınız.',
  },
};

export const Hata: Story = {
  args: {
    variant: 'danger',
    title: 'E-posta veya parola hatalı',
    children: 'Girdiğiniz bilgileri kontrol edip tekrar deneyin.',
  },
};

/** Etkileşimli içerik (passive=false): rol bildirimi yapılmaz. */
export const EtkilesimliIcerik: Story = {
  args: {
    variant: 'warning',
    title: 'Oturumunuz başka bir cihazda kapatıldı',
    passive: false,
  },
  render: (args) => (
    <Alert {...args}>
      <p style={{ margin: '0 0 10px' }}>Yeniden giriş yapmanız gerekiyor.</p>
      <Button size="sm">Yeniden giriş yap</Button>
    </Alert>
  ),
};

export const TumVaryantlar: Story = {
  name: 'Tüm varyantlar',
  render: () => (
    <div style={{ display: 'grid', gap: 14, maxWidth: 520 }}>
      <Alert variant="info" title="Bilgi" children="Bilgi icerik" />
      <Alert variant="success" title="Başarı" children="Başarı icerik" />
      <Alert variant="warning" title="Uyarı" children="Uyarı icerik" />
      <Alert variant="danger" title="Hata" children="Hata icerik" />
    </div>
  ),
};

/** Erişilebilirlik: danger/warning pasif bildirimleri role=alert taşır. */
export const ErisilebilirlikKuralli: Story = {
  tags: ['test'],
  render: () => (
    <div style={{ display: 'grid', gap: 14, maxWidth: 520 }}>
      <Alert variant="danger" title="Sunucu hatası">
        İşlem tamamlanamadı.
      </Alert>
      <Alert variant="info" title="Bilgi">
        Pasif bilgi.
      </Alert>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const danger = canvas.getByText('Sunucu hatası').closest('.tf-alert');
    await expect(danger).toHaveAttribute('role', 'alert');
    const info = canvas.getByText('Pasif bilgi.').closest('.tf-alert');
    await expect(info).not.toHaveAttribute('role', 'alert');
  },
};
