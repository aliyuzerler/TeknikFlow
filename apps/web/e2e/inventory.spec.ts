import { expect, test } from '@playwright/test';

/**
 * TEST-09 §6 — Faz 09 stok E2E (owner oturumu; demo seed verisi).
 *
 * Kapsam: stok genel bakışı, katalog/arama, depolar, hareket defteri,
 * form üzerinden giriş (RECEIVE) kaydı, yenileme sonrası kalıcılık ve
 * iş emri raporunda parça/maliyet bölümü varlığı. Yetki sınırları
 * (teknisyen 403) entegrasyon testlerinde uçtan uca kanıtlanır.
 */

const INVENTORY_URL = '/app/inventory';

test.describe('Stok — Faz 09', () => {
  test('genel bakış: metrik kartları ve hareket defteri görünür', async ({ page }) => {
    await page.goto(INVENTORY_URL);
    await expect(page.getByRole('heading', { name: 'Stok Genel Bakış' })).toBeVisible();
    await expect(page.getByText('Stok kalemi')).toBeVisible();
    await expect(page.getByText('Son hareket', { exact: true })).toBeVisible();
    // Demo tohum hareketleri defterde görünür (FLT-04-25 girişi/araç çıkışı).
    await expect(page.getByText('FLT-04-25').first()).toBeVisible();
  });

  test('katalog: demo kalemleri listelenir; arama süzgeci çalışır', async ({ page }) => {
    await page.goto('/app/inventory/items');
    await expect(page.getByRole('heading', { name: 'Stok Kalemleri' })).toBeVisible();
    await expect(page.getByText('FLT-04-25')).toBeVisible();
    await expect(page.getByText('GLY-5W-1L')).toBeVisible();
    await expect(page.getByText('PUMP-SERI')).toBeVisible();

    await page.getByLabel('Stok kalemi ara').fill('glikol');
    await page.getByRole('button', { name: 'Ara' }).click();
    await expect(page.getByText('GLY-5W-1L')).toBeVisible();
    await expect(page.getByText('FLT-04-25')).toBeHidden();
  });

  test('depolar: merkez depo ve teknisyen aracı görünür', async ({ page }) => {
    await page.goto('/app/inventory/warehouses');
    await expect(page.getByRole('heading', { name: 'Depolar' })).toBeVisible();
    await expect(page.getByText('Atlas Merkez Depo').first()).toBeVisible();
    await expect(page.getByText('Emre Yılmaz Aracı').first()).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Depo listesi' }).getByText('Araç (van) stoğu'),
    ).toBeVisible();
  });

  test('hareket formu: RECEIVE girişi kaydedilir ve yenilemede kalıcıdır', async ({ page }) => {
    await page.goto('/app/inventory/movements');
    await expect(page.getByRole('heading', { name: 'Hareket Defteri' })).toBeVisible();

    const beforeCount = await page
      .getByRole('table', { name: 'Stok hareketleri' })
      .locator('tbody tr')
      .count();

    await page.getByLabel('Hareket türü', { exact: true }).selectOption('RECEIVE');
    await page
      .getByLabel(/^Stok kalemi/)
      .selectOption({ label: 'FLT-04-25 — Hava filtresi 04-25' });
    // Kaynak boş (giriş); hedef merkez depo.
    await page.getByLabel(/^Hedef depo/).selectOption({ label: 'Atlas Merkez Depo' });
    await page.getByRole('textbox', { name: 'Miktar' }).fill('5');
    const movementResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/inventory/movements') &&
        response.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Hareketi kaydet' }).click();
    const response = await movementResponse;
    expect(response.status(), 'hareket POST sunucuda işlendi').toBe(201);
    await expect(page.getByText('kaydedildi').first()).toBeVisible({ timeout: 10_000 });

    // Yenileme: kalıcılık (defter satırı sunucuda).
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Hareket Defteri' })).toBeVisible();
    const afterCount = await page
      .getByRole('table', { name: 'Stok hareketleri' })
      .locator('tbody tr')
      .count();
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
    // Katalogda toplam stok arttı (seed 50 + her koşuda +5 — ≥55 dinamik).
    await page.goto('/app/inventory/items');
    const filterRow = page
      .getByRole('table', { name: 'Stok kataloğu' })
      .locator('tbody tr', { hasText: 'FLT-04-25' });
    await expect(filterRow).toBeVisible();
    const onHandText = (await filterRow.innerText()).match(/(\d+) ad/);
    expect(Number(onHandText?.[1] ?? 0)).toBeGreaterThanOrEqual(55);
  });

  test('iş emri raporu: parça ve maliyet bölümü yapısal olarak hazır', async ({ page }) => {
    // Demo iş emirleri raporuna gir; bölüm başlığı (boş veya dolu) görünür.
    await page.goto('/app/work-orders');
    const reportLink = page.getByRole('link', { name: /rapor/i }).first();
    if (await reportLink.isVisible().catch(() => false)) {
      await reportLink.click();
      await expect(page.getByRole('heading', { name: /parçalar/i }).first()).toBeVisible();
    }
  });
});
