import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell, type NavSection } from './app-shell.js';

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Çalışma alanı',
    items: [
      { id: 'overview', label: 'Genel Bakış', icon: 'overview', href: '/app/overview' },
      { id: 'work-orders', label: 'İş Emirleri', icon: 'work-orders', count: 12 },
    ],
  },
  {
    label: 'Yönetim',
    items: [{ id: 'settings', label: 'Ayarlar', icon: 'settings' }],
  },
];

function renderShell(overrides: Partial<Parameters<typeof AppShell>[0]> = {}) {
  const onNavigate = vi.fn();
  render(
    <AppShell
      navSections={NAV_SECTIONS}
      activeId="overview"
      user={{ name: 'Ali Yılmaz', role: 'Firma Yöneticisi', initials: 'AY' }}
      crumbs={[{ label: 'Atlas Teknik Servis', href: '/app/overview' }, { label: 'Genel Bakış' }]}
      onNavigate={onNavigate}
      {...overrides}
    >
      <h1>İçerik başlığı</h1>
    </AppShell>,
  );
  return { onNavigate };
}

describe('AppShell', () => {
  it('kenar menüsü landmark’ı ve marka metnini basar', () => {
    renderShell();
    expect(
      screen.getByRole('complementary', { name: 'Çalışma alanı kenar menüsü' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('TeknikFlow').length).toBeGreaterThan(0);
  });

  it('aktif gezinme öğesi aria-current="page" taşır', () => {
    renderShell();
    const nav = screen.getAllByRole('navigation')[0] as HTMLElement;
    expect(nav.querySelector('a[aria-current="page"]')?.textContent).toContain('Genel Bakış');
  });

  it('gelecek-faz öğeleri aria-disabled düğme olarak duyurulur', () => {
    renderShell();
    const item = screen.getByRole('button', { name: /İş Emirleri/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAccessibleDescription(); // title ile "sonraki fazlarda" notu
  });

  it('sayfa içeriği main landmark içinde ve atlama bağlantısı ilk duraktır', () => {
    renderShell();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'İçerik başlığı' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'İçeriğe geç' })).toHaveAttribute('href', '#tf-main');
  });

  it('kullanıcı kimliği kenar menüsünde görünür', () => {
    renderShell();
    expect(screen.getByText('Ali Yılmaz')).toBeInTheDocument();
    expect(screen.getByText('Firma Yöneticisi')).toBeInTheDocument();
  });

  it('hamburger kapalıyken aria-expanded=false; tıklanınca çekmece açılır', async () => {
    const user = userEvent.setup();
    renderShell();
    const menuButton = screen.getByRole('button', { name: 'Menüyü aç' });
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await user.click(menuButton);
    expect(screen.getByRole('dialog', { name: 'Menü' })).toBeInTheDocument();
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  });

  it('çekmecede ESC ile kapatınca odak menü düğmesine döner', async () => {
    const user = userEvent.setup();
    renderShell();
    const menuButton = screen.getByRole('button', { name: 'Menüyü aç' });
    await user.click(menuButton);
    const dialog = screen.getByRole('dialog', { name: 'Menü' });
    expect(dialog).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(menuButton).toHaveFocus();
  });

  it('arama sağlanmışsa üst çubukta aranabilir girdi çalışır', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    renderShell({ onSearch });
    const search = screen.getByRole('searchbox', { name: 'Global arama' });
    await user.type(search, 'a');
    expect(onSearch).toHaveBeenCalledWith('a');
  });

  it('arama yoksa süs arama kutusu ekran okuyucudan gizlidir', () => {
    renderShell();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('gelecek-faz öğesine tıklanınca onNavigate tetiklenir', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderShell();
    await user.click(screen.getByRole('button', { name: /İş Emirleri/ }));
    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'work-orders', label: 'İş Emirleri' }),
    );
  });

  it('mobil çekmecede gezinme öğeleri tekrar kullanılabilir durumdadır', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Menüyü aç' }));
    const dialog = screen.getByRole('dialog', { name: 'Menü' });
    expect(withinName(dialog, 'Genel Bakış')).toBeTruthy();
    function withinName(container: HTMLElement, label: string) {
      return Array.from(container.querySelectorAll('a,button')).some((el) =>
        el.textContent?.includes(label),
      );
    }
  });
});
