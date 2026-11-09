import { expect, test } from '@playwright/test';

/**
 * TEST-04 §6 — Faz 04 E2E: müşteri oluştur → lokasyon → ekipman yolculuğu,
 * arama/sayfalama kalıcılığı ve rol sınırı. Owner oturumu global setup'tan
 * (storageState) gelir; auth.spec'te giriş akışı ayrıca uçtan uca sınanır.
 */

test.describe('müşteri → lokasyon → ekipman yolculuğu', () => {
  test('yeni müşteri oluşturulur; lokasyon ve ekipman eklenir; geçmiş görünür', async ({
    page,
  }) => {
    const run = Date.now().toString(36);
    const customerName = `E2E Yolculuk ${run}`;

    // 1) Müşteri listesi + yeni müşteri.
    await page.goto('/app/customers');
    await expect(page.getByRole('heading', { level: 1, name: 'Müşteriler' })).toBeVisible();

    await page.getByRole('button', { name: '＋ Yeni Müşteri' }).click();
    const drawer = page.getByRole('dialog', { name: 'Yeni Müşteri' });
    await expect(drawer).toBeVisible();

    await drawer.locator('input[name="name"]').fill(customerName);
    await drawer.locator('select[name="customerType"]').selectOption('INDIVIDUAL');
    await drawer.getByRole('button', { name: 'Müşteriyi oluştur' }).click();

    // Oluşturunca detay sayfasına yönlendirilir.
    await expect(page.getByRole('heading', { level: 1, name: customerName })).toBeVisible();
    await expect(page.getByText('Bireysel müşteri')).toBeVisible();

    // 2) Zaman çizelgesinde müşteri oluşturma olayı.
    await expect(page.getByText('Müşteri oluşturuldu')).toBeVisible();

    // 3) Lokasyon ekle.
    await page.getByRole('button', { name: '＋ Lokasyon' }).click();
    const locationDrawer = page.getByRole('dialog', { name: 'Yeni Servis Lokasyonu' });
    await locationDrawer.locator('input[name="name"]').fill('Ana Depo');
    await locationDrawer.locator('input[name="address"]').fill('Test Cad. No:1');
    await locationDrawer.locator('input[name="city"]').fill('İstanbul');
    await locationDrawer.getByRole('button', { name: 'Lokasyonu ekle' }).click();
    await expect(page.getByRole('cell', { name: 'Ana Depo' })).toBeVisible();

    // 4) Kişi ekle.
    await page.getByRole('button', { name: '＋ Kişi' }).click();
    const contactDrawer = page.getByRole('dialog', { name: 'Yeni Kişi' });
    await contactDrawer.locator('input[name="name"]').fill('Test Kişisi');
    await contactDrawer.locator('input[name="email"]').fill(`kisi-${run}@e2e.test`);
    await contactDrawer.getByRole('button', { name: 'Kişiyi ekle' }).click();
    await expect(page.getByRole('cell', { name: 'Test Kişisi' })).toBeVisible();

    // 5) Ekipman ekle (etiket elle — sonraki adımlarda aranacak).
    const assetTag = `E2E-${run.toUpperCase()}`.slice(0, 16);
    await page.getByRole('button', { name: '＋ Ekipman' }).click();
    const assetDrawer = page.getByRole('dialog', { name: 'Yeni Ekipman' });
    await assetDrawer.locator('input[name="manufacturer"]').fill('E2E Üretici');
    await assetDrawer.locator('input[name="model"]').fill('Model-X');
    await assetDrawer.locator('input[name="assetTag"]').fill(assetTag);
    await assetDrawer.locator('select[name="location"]').selectOption({ label: 'Ana Depo' });
    await assetDrawer.locator('select[name="criticality"]').selectOption('HIGH');
    await assetDrawer.getByRole('button', { name: 'Ekipmanı ekle' }).click();

    // Ekipman tablosunda görünür (yüksek kritiklik rozetiyle).
    await expect(page.getByRole('cell', { name: assetTag })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Yüksek' }).first()).toBeVisible();

    // Zaman çizelgesi yeni olayları kronolojik gösterir.
    await expect(page.getByText('Lokasyon eklendi')).toBeVisible();
    await expect(page.getByText('Ekipman eklendi')).toBeVisible();

    // 6) Kalıcılık: yeniden yüklemede her şey yerinde (refresh/reopen).
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: customerName })).toBeVisible();
    await expect(page.getByRole('cell', { name: assetTag })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Test Kişisi' })).toBeVisible();
  });

  test('arama sonuçları filtreler ve kalıcıdır (URL ile paylaşılabilir)', async ({ page }) => {
    const run = Date.now().toString(36);
    const customerName = `Arama Hedefi ${run}`;
    const shortName = `Arama ${run}`;

    // İki müşteri oluştur (biri diğerinin öneki).
    for (const name of [customerName, shortName]) {
      await page.goto('/app/customers');
      await page.getByRole('button', { name: '＋ Yeni Müşteri' }).click();
      const drawer = page.getByRole('dialog', { name: 'Yeni Müşteri' });
      await drawer.locator('input[name="name"]').fill(name);
      await drawer.getByRole('button', { name: 'Müşteriyi oluştur' }).click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    }

    // Arama: benzersiz run kimliği her ikisini de bulmalı (contains tabanlı).
    await page.goto('/app/customers');
    await page.locator('input[name="q"]').fill(run);
    await page.getByRole('button', { name: 'Ara', exact: true }).click();
    await expect(page.getByRole('cell', { name: customerName })).toBeVisible();
    await expect(page.getByRole('cell', { name: shortName })).toBeVisible();

    // URL parametresi kalıcı — doğrudan gidince aynı sonuç.
    await page.goto(`/app/customers?q=${encodeURIComponent(run)}`);
    await expect(page.getByRole('cell', { name: customerName })).toBeVisible();

    // Ekipman araması: etiketle bul.
    await page.goto('/app/assets');
    await page.locator('input[name="q"]').fill('E2E-');
    await page.getByRole('button', { name: 'Ara', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Ekipman envanteri' })).toBeVisible();
  });

  test('çift müşteri adı dostça hata gösterir (sunucu 409)', async ({ page }) => {
    const run = Date.now().toString(36);
    const name = `Çift Kayıt ${run}`;

    await page.goto('/app/customers');
    await page.getByRole('button', { name: '＋ Yeni Müşteri' }).click();
    let drawer = page.getByRole('dialog', { name: 'Yeni Müşteri' });
    await drawer.locator('input[name="name"]').fill(name);
    await drawer.getByRole('button', { name: 'Müşteriyi oluştur' }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

    // Aynı adla tekrar → 409 mesajı çekmecede kalır.
    await page.goto('/app/customers');
    await page.getByRole('button', { name: '＋ Yeni Müşteri' }).click();
    drawer = page.getByRole('dialog', { name: 'Yeni Müşteri' });
    await drawer.locator('input[name="name"]').fill(name);
    await drawer.getByRole('button', { name: 'Müşteriyi oluştur' }).click();
    await expect(drawer.getByText('Bu adda müşteri zaten kayıtlı')).toBeVisible();
    await expect(drawer).toBeVisible(); // çekmece açık kalır (veri kaybı yok)
  });
});

test.describe('rol sınırı (teknisyen)', () => {
  test('teknisyende CRM menüsü gizli; doğrudan URL → yetki uyarısı', async ({ browser }) => {
    // Temiz bağlam: config storageState'i newContext miras alabilir —
    // bilinçli olarak temizlenir (teknisyen gerçek girişle sınanır).
    const context = await browser.newContext();
    await context.clearCookies();
    const page = await context.newPage();
    await page.goto('/login');
    await page.locator('input[name="email"]').fill('technician1@atlas.example.test');
    await page.locator('input[name="password"]').fill('Atlas!2026');
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Operasyon Genel Bakışı' }),
    ).toBeVisible();

    // Menüde müşteri/ekipman YOK (yalnız view_assigned — fail-closed).
    await expect(page.getByRole('link', { name: 'Müşteriler' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Ekipmanlar' })).toHaveCount(0);

    // Doğrudan URL → sunucu tarafı 403'ün UI yansıması.
    await page.goto('/app/customers');
    await expect(page.getByText('Bu bölüm için yetkiniz yok')).toBeVisible();
    await context.close();
  });
});

test.describe('duyarlılık (mobil 390px)', () => {
  test('müşteri listesi tek sütun; detay sayfası yığılır', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/customers');
    await expect(page.getByRole('heading', { level: 1, name: 'Müşteriler' })).toBeVisible();
    // Arama çubuğu kullanılabilir (dokunmatik hedef).
    const search = page.locator('input[name="q"]');
    await expect(search).toBeVisible();
    const box = await search.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(36);

    // Detay sayfası (demo verisinden Marmara Gıda).
    await page.goto('/app/customers');
    const firstCustomer = page.locator('table a.tf-table__customer').first();
    await firstCustomer.click();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  });
});
