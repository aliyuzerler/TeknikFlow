import { expect, test } from '@playwright/test';

/**
 * TEST-05 §6 — Faz 05 E2E: talep → iş emri yaşam döngüsü uçtan uca.
 *
 * Owner oturumu global setup'tan (storageState) gelir. Yaşam döngüsü tek
 * SERİ testte uçtan uca (testler arası veri bağımlılığı vardır — bu yüzden
 * paralel dağıtıma bölünmez): talep oluştur → triyaj → iş emrine dönüştür →
 * planla → teknisyen ata → teknisyen kabul/yol/varış/başlama/tamamlama →
 * yönetici kapatma → kalıcılık. Bağımsız senaryolar ayrı testlerdir.
 */

const RUN = Date.now().toString(36);

test.describe('talep → iş emri yaşam döngüsü (seri)', () => {
  // Zincir bağımlıdır: sırayla, aynı worker'da koşar.
  test.describe.configure({ mode: 'serial' });

  test('talep oluşturulur, triyaj edilir, iş emrine dönüşür, planlanır ve atanır', async ({
    page,
  }) => {
    // 1) Gelen kutusu + yeni talep çekmecesi.
    await page.goto('/app/requests');
    await expect(page.getByRole('heading', { level: 1, name: 'Servis Talepleri' })).toBeVisible();

    await page.getByRole('button', { name: '＋ Yeni Talep' }).click();
    const drawer = page.getByRole('dialog', { name: 'Yeni Servis Talebi' });
    await expect(drawer).toBeVisible();

    const subject = `E2E Yaşam Döngüsü ${RUN}`;
    await drawer.getByLabel('Konu').fill(subject);
    await drawer.getByLabel('Öncelik').selectOption('HIGH');
    await drawer.getByRole('button', { name: 'Talebi oluştur' }).click();

    // Oluşturunca talep detayına yönlendirilir.
    await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
    await expect(page.getByText('Yüksek').first()).toBeVisible();
    await expect(page.getByText('Yeni').first()).toBeVisible();

    // 2) Triyaj: öncelik Acil'e yükseltilir (SLA sunucuda yeniden hesaplanır).
    await page.getByLabel('Öncelik').selectOption('URGENT');
    await page.getByRole('button', { name: 'Triyajı kaydet' }).click();
    await expect(page.getByText('Talep güncellendi')).toBeVisible();
    await expect(page.getByText('Acil').first()).toBeVisible();

    // 3) İş emrine dönüştürme → WO detayına yönlendirme (Taslak).
    await page.getByRole('button', { name: 'İş emri oluştur' }).click();
    await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Taslak').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Talebe git' })).toBeVisible();

    // 4) Planlama çekmecesi.
    await page.getByRole('button', { name: 'Planla' }).click();
    const planDrawer = page.getByRole('dialog', { name: 'İş emrini planla' });
    await planDrawer.getByLabel('Planlanan başlangıç').fill('2026-12-04T09:00');
    await planDrawer.getByLabel('Planlanan bitiş').fill('2026-12-04T13:00');
    await planDrawer.getByRole('button', { name: 'Planlamayı kaydet' }).click();
    await expect(page.getByText('Planlandı').first()).toBeVisible({ timeout: 10_000 });

    // 5) Atama çekmecesi.
    await page.getByRole('button', { name: 'Teknisyen ata' }).click();
    const assignDrawer = page.getByRole('dialog', { name: 'Teknisyen ata' });
    await assignDrawer.getByLabel('Teknisyen').selectOption({ label: 'Emre Yılmaz — Teknisyen' });
    await assignDrawer.getByRole('button', { name: 'Atamayı yap' }).click();
    await expect(page.getByText('Atandı').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Emre Yılmaz').first()).toBeVisible();
  });

  test('teknisyen kendi işini yürütür ve tamamlar; kapatamaz', async ({ browser }) => {
    // Temiz bağlam — teknisyen gerçek girişle sınanır.
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

    // Teknisyen listesinde kendi işi görünür.
    await page.goto('/app/work-orders');
    const row = page.getByRole('cell', { name: `E2E Yaşam Döngüsü ${RUN}` });
    await expect(row).toBeVisible();
    await row.locator('..').locator('a.tf-table__customer').click();
    await expect(
      page.getByRole('heading', { level: 1, name: `E2E Yaşam Döngüsü ${RUN}` }),
    ).toBeVisible();

    // Yürütme zinciri: kabul → yola çık → varış (manuel onay — izin reddi
    // kabul kriteri) → başla → tamamla.
    for (const [label, expected] of [
      ['İşi kabul et', 'Kabul Edildi'],
      ['Yola çık', 'Yolda'],
    ] as const) {
      await page.getByRole('button', { name: label }).click();
      await expect(page.getByText(expected).first()).toBeVisible({ timeout: 10_000 });
    }

    // Faz 08 — varış bildiri çekmecesi: tarayıcı konumu izni reddedilir
    // (headless varsayılanı) → manuel onay + zorunlu nedenle devam.
    await page.getByRole('button', { name: 'Varış bildir' }).click();
    const arriveDrawer = page.getByRole('dialog', { name: 'Varış bildir' });
    await expect(arriveDrawer).toBeVisible();
    await expect(arriveDrawer.getByText('Konum alınamadı')).toBeVisible({ timeout: 12_000 });
    await arriveDrawer.getByLabel('Manuel onay nedeni').fill('Konum izni reddedildi (E2E)');
    await arriveDrawer.getByRole('button', { name: 'Varışı kaydet' }).click();
    await expect(page.getByText('Yerinde').first()).toBeVisible({ timeout: 10_000 });

    for (const [label, expected] of [
      ['İşe başla', 'Devam Ediyor'],
      ['Tamamla', 'Tamamlandı'],
    ] as const) {
      await page.getByRole('button', { name: label }).click();
      await expect(page.getByText(expected).first()).toBeVisible({ timeout: 10_000 });
    }

    // Teknisyen KAPATAMAZ — yönetici yetkisi (düğme yok; sunucu da reddeder).
    await expect(page.getByRole('button', { name: 'Kapat' })).toHaveCount(0);

    // Not ekleme (atanan görünürlüğü) — etiket birebir eşleşmeli
    // ("Not görünürlüğü" seçimi de aynı önekle başlar).
    await page.getByLabel('Not', { exact: true }).fill('E2E: keşif tamam, ek parça gerekmedi.');
    await page.getByRole('button', { name: 'Not ekle' }).click();
    await expect(page.getByText('E2E: keşif tamam, ek parça gerekmedi.')).toBeVisible();
    await context.close();
  });

  test('yönetici kapatır; durum ve zaman çizelgesi kalıcıdır', async ({ page }) => {
    await page.goto(`/app/work-orders?q=${encodeURIComponent(`E2E Yaşam Döngüsü ${RUN}`)}`);
    const row = page.getByRole('cell', { name: `E2E Yaşam Döngüsü ${RUN}` });
    await expect(row).toBeVisible();
    await row.locator('..').locator('a.tf-table__customer').click();
    await expect(
      page.getByRole('heading', { level: 1, name: `E2E Yaşam Döngüsü ${RUN}` }),
    ).toBeVisible();
    await expect(page.getByText('Tamamlandı').first()).toBeVisible();

    // Faz 08 — kapatma kanıt kapısı: imza OLMADAN kapatma reddedilir.
    await page.getByRole('button', { name: 'Kapat' }).click();
    await expect(
      page.getByText('Kapatma için en az bir imza gerekli', { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // İmza yakala: imzalayan adı + tuvale fareyle çizim (pointer olayları).
    await page.getByLabel('İmzalayan adı').fill('Ayşe Yılmaz');
    const pad = page.getByTestId('tf-signature-canvas');
    const box = await pad.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 24, box.y + 40);
      await page.mouse.down();
      for (let step = 1; step <= 10; step += 1) {
        await page.mouse.move(box.x + 24 + step * 18, box.y + 40 + (step % 3) * 8, {
          steps: 2,
        });
      }
      await page.mouse.up();
    }
    await page.getByRole('button', { name: 'İmzayı kaydet' }).click();
    await expect(page.getByText('İmza kaydedildi.')).toBeVisible({ timeout: 10_000 });

    // Artık kapatma başarılı.
    await page.getByRole('button', { name: 'Kapat' }).click();
    await expect(page.getByText('Kapatıldı').first()).toBeVisible({ timeout: 10_000 });

    // Kalıcılık: yeniden yüklemede durum + zaman çizelgesi yerinde.
    await page.reload();
    await expect(page.getByText('Kapatıldı').first()).toBeVisible();
    await expect(page.getByText('Zaman çizelgesi')).toBeVisible();
    const timeline = page.locator('.tf-timeline');
    await expect(timeline.getByText('Tamamlandı → Kapatıldı')).toBeVisible();
    await expect(timeline.getByText('Devam Ediyor → Tamamlandı')).toBeVisible();
    // Terminal durumda hiçbir eylem düğmesi yok.
    await expect(page.getByRole('button', { name: 'Planla' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Teknisyen ata' })).toHaveCount(0);

    // Faz 08 — yürütme raporu: varış kaydı (manuel onay) + imza birleşir.
    await page.getByRole('link', { name: 'Raporu görüntüle →' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: `E2E Yaşam Döngüsü ${RUN}` }),
    ).toBeVisible();
    await expect(page.getByText('Konum kayıtları')).toBeVisible();
    await expect(page.getByText('Varış').first()).toBeVisible();
    await expect(page.getByText('Manuel onay: Konum izni reddedildi (E2E)')).toBeVisible();
    await expect(page.getByText('İmzalar')).toBeVisible();
    await expect(page.getByText('Ayşe Yılmaz').first()).toBeVisible();
    await expect(page.getByText('İşgücü özeti')).toBeVisible();
  });
});

test('talep neden koduyla iptal edilir', async ({ page }) => {
  await page.goto('/app/requests');
  await page.getByRole('button', { name: '＋ Yeni Talep' }).click();
  const drawer = page.getByRole('dialog', { name: 'Yeni Servis Talebi' });
  const subject = `E2E İptal ${RUN}`;
  await drawer.getByLabel('Konu').fill(subject);
  await drawer.getByLabel('Öncelik').selectOption('LOW');
  await drawer.getByRole('button', { name: 'Talebi oluştur' }).click();
  await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();

  // İptal çekmecesi: neden kodu zorunlu alan.
  await page.getByRole('button', { name: 'Talebi iptal et' }).first().click();
  const cancelDrawer = page.getByRole('dialog', { name: 'Talebi iptal et' });
  await cancelDrawer.getByLabel('İptal nedeni').selectOption('DUPLICATE');
  await cancelDrawer.getByLabel('Not', { exact: true }).fill('Mükerrer kayıt');
  await cancelDrawer.getByRole('button', { name: 'Talebi iptal et' }).click();

  await expect(page.getByText('Talep iptal edildi').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Mükerrer kayıt').first()).toBeVisible();
  // İptal sonrası eylem panelleri kalkar.
  await expect(page.getByRole('button', { name: 'Talebi iptal et' })).toHaveCount(0);
});

test('teknisyen talep kutusuna erişemez (menü gizli + doğrudan URL uyarısı)', async ({
  browser,
}) => {
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

  await expect(page.getByRole('link', { name: 'Servis Talepleri' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'İş Emirleri' })).toHaveCount(1);

  await page.goto('/app/requests');
  await expect(page.getByText('Bu bölüm için yetkiniz yok')).toBeVisible();
  await context.close();
});

test('duyarlılık (mobil 390px): liste ve detay kullanılabilir', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/work-orders');
  await expect(page.getByRole('heading', { level: 1, name: 'İş Emirleri' })).toBeVisible();
  const search = page.locator('input[name="q"]');
  await expect(search).toBeVisible();
  const box = await search.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(36);

  // Yeni iş emri düğmesi dokunmatik hedefte (≥36px).
  const newButton = page.getByRole('button', { name: '＋ Yeni İş Emri' });
  await expect(newButton).toBeVisible();
  const buttonBox = await newButton.boundingBox();
  expect(buttonBox?.height).toBeGreaterThanOrEqual(36);

  // İlk satırdan detaya inilir; başlık ve bilgi blokları yığılır.
  await page.locator('table a.tf-table__customer').first().click();
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.getByText('İş emri bilgileri')).toBeVisible();
  await expect(page.getByText('Zaman çizelgesi')).toBeVisible();
});
