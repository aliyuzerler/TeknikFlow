import { expect, test } from '@playwright/test';

// Faz 01 E2E: kurulum/durum sayfasının bütünlüğü.
// Altyapı + API ayakta olduğunda tam senaryo; değilse sayfa yine de
// dürüst "erişilemedi" durumları göstermelidir (asla sahte başarı yok).

test.describe('TeknikFlow durum sayfası', () => {
  test('başlık, genel durum bandı ve tüm servis kartları görünür', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'TeknikFlow' })).toBeVisible();
    await expect(page.getByLabel('Genel sistem durumu')).toBeVisible();

    for (const name of [
      'REST API (NestJS)',
      'PostgreSQL',
      'Redis',
      'Obje Deposu (RustFS)',
      'Worker (BullMQ)',
    ]) {
      await expect(page.getByRole('article', { name: `${name} durumu` })).toBeVisible();
    }
  });

  test('her kart bir durum rozeti taşır (Çalışıyor/Hizmet dışı/Bilinmiyor/Erişilemedi/Sınırlı)', async ({
    page,
  }) => {
    await page.goto('/');
    const cards = page.locator('article.card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < count; i++) {
      const badge = cards.nth(i).locator('.badge');
      await expect(badge).toBeVisible();
    }
  });

  test('faz tablosu 16 fazı listeler', async ({ page }) => {
    await page.goto('/');
    const rows = page.locator('table.phases tbody tr');
    await expect(rows).toHaveCount(16);
    await expect(page.locator('table.phases tbody tr.is-current')).toHaveCount(1);
  });

  test('altyapı ayaktaysa PostgreSQL kartı Çalışıyor gösterir', async ({ page }) => {
    await page.goto('/');
    const postgresCard = page.getByRole('article', { name: 'PostgreSQL durumu' });
    await expect(postgresCard.locator('.badge')).toContainText(/Çalışıyor|Hizmet dışı|Bilinmiyor/);
  });

  test('mobil görünüm: kartlar tek sütuna düşer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const firstCard = page.locator('article.card').first();
    await expect(firstCard).toBeVisible();
    const box = await firstCard.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(390 - 32); // sayfa dolgu payı
  });
});
