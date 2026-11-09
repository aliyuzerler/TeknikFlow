import { expect, test } from '@playwright/test';

/**
 * Faz 02 E2E: duyarlı web kabuğu (AppShell) — /app/overview tasarım önizlemesi.
 *
 * Kapsam (TEST-02 §6): masaüstü kabuk bütünlüğü, erişilebilir gezinme
 * öznitelikleri, mobil kırılım + çekmece klavye akışı (ESC + odak geri dönüşü)
 * ve atlama bağlantısı. Erişilebilir seçiciler (role/aria) kullanılır.
 */

const OVERVIEW = '/app/overview';

test.describe('AppShell — masaüstü (1440px)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(OVERVIEW);
  });

  test('kabuk, marka ve kenar menüsü görünür', async ({ page }) => {
    await expect(
      page.getByRole('heading', { level: 1, name: 'Operasyon Genel Bakışı' }),
    ).toBeVisible();
    const sidebar = page.getByRole('complementary', { name: 'Çalışma alanı kenar menüsü' });
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText('TeknikFlow').first()).toBeVisible();
    await expect(sidebar.getByText('SAHA SERVİS YÖNETİMİ')).toBeVisible();
  });

  test('üst çubukta sayfa yolu ve kullanıcı kimliği var', async ({ page }) => {
    const breadcrumb = page.getByRole('navigation', { name: 'Sayfa yolu' });
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.getByText('Atlas Teknik Servis')).toBeVisible();
    await expect(breadcrumb.getByText('Genel Bakış')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Ali Yılmaz')).toBeVisible();
  });

  test('aktif gezinme öğesi aria-current taşır; gelecek-faz öğeleri aria-disabled', async ({
    page,
  }) => {
    const workspaceNav = page.getByRole('navigation', { name: 'Çalışma alanı' });
    await expect(workspaceNav.getByRole('link', { name: 'Genel Bakış' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(workspaceNav.getByRole('button', { name: /İş Emirleri/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // bekleyen sayısı rozetle anlaşılır
    await expect(workspaceNav.getByLabel('12 bekleyen')).toHaveText('12');
  });

  test('metrik kartları ve veri tablosu render olur', async ({ page }) => {
    await expect(
      page.getByRole('region', { name: 'Günlük operasyon metrikleri (demo)' }),
    ).toBeVisible();
    await expect(page.getByText('Açık iş emirleri')).toBeVisible();
    const table = page.getByRole('table', { name: 'Son iş emirleri (demo)' });
    await expect(table).toBeVisible();
    await expect(table.getByText('#TF-2026-0842')).toBeVisible();
    await expect(table.getByText('Marmara Gıda A.Ş.')).toBeVisible();
    // durum rozetleri metinle anlatılır (renk tek başına değil)
    await expect(table.getByText('Sahada')).toBeVisible();
    await expect(table.getByText('Parça bekliyor')).toBeVisible();
    await expect(table.getByText('SLA riski')).toBeVisible();
  });

  test('atlama bağlantısı ("İçeriğe geç") içeriğe odak taşır', async ({ page }) => {
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'İçeriğe geç' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });
});

test.describe('AppShell — mobil (390px)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(OVERVIEW);
  });

  test('kenar menüsü gizli, hamburger görünür ve erişilebilir durum taşır', async ({ page }) => {
    await expect(
      page.getByRole('complementary', { name: 'Çalışma alanı kenar menüsü' }),
    ).toBeHidden();
    const menu = page.getByRole('button', { name: 'Menüyü aç' });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toHaveAttribute('aria-controls', 'tf-mobile-nav');
  });

  test('çekmece açılır; klavye içeride kalır; ESC kapatır ve odak menüye döner', async ({
    page,
  }) => {
    // Düğmenin erişilebilir adı duruma göre değişir (aç/kapat) — regexp ikisini de yakalar.
    const menu = page.getByRole('button', { name: /Menüyü (aç|kapat)/ });
    await menu.click();
    const drawer = page.getByRole('dialog', { name: 'Menü' });
    await expect(drawer).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');

    // odak diyalog içinde (kapat düğmesi ilk durak)
    await expect(drawer.getByRole('button', { name: 'Paneli kapat' })).toBeFocused();

    // Tab gezinmesi panel içinde kalır (odak diyalogdan dışarı sızmaz)
    await page.keyboard.press('Tab');
    const focusInsideDrawer = await page.evaluate(() => {
      const el = document.activeElement;
      return el instanceof Element && el.closest('[role="dialog"]') !== null;
    });
    expect(focusInsideDrawer).toBe(true);

    // ESC ile kapatma + odak geri dönüşü
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
  });

  test('mobilde içerik tek sütuna düşer (kartlar yığılır)', async ({ page }) => {
    // Metrik grid'i 2 sütuna düşer: ilk iki kart yan yana, alttaki yeni satırda
    const grid = page.locator('.tf-grid');
    await expect(grid).toBeVisible();
    const first = page.getByText('Açık iş emirleri').locator('..');
    const box = await first.boundingBox();
    expect(box?.width).toBeLessThan(300); // daraltılmış kart
  });
});
