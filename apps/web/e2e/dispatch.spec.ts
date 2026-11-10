import { expect, test, type Locator } from '@playwright/test';

/**
 * TEST-06 §6 — Faz 06 E2E: dispatch panosu atama (kabul ölçütü).
 *
 * Owner oturumu global setup'tan (storageState) gelir. Kabul:
 * 1. Klavye alternatifi: kuyruk kartının "Planla / Ata" düğmesi →
 *    atama paneli → teknisyen + tarih + saat → kaydet → kart kolona taşınır.
 * 2. Kalıcılık: sayfa yenilendiğinde atama yerinde.
 * 3. Çakışma: aynı pencereye ikinci iş → 409 çakışma uyarısı panelde.
 * 4. Rol sınırı: teknisyen panoya giremez (uyarı + veri yok).
 * 5. Duyarlı görünüm: mobil viewport'ta pano erişilebilir.
 */

const RUN = Date.now().toString(36);

test.describe('dispatch panosu atama (seri)', () => {
  test.describe.configure({ mode: 'serial' });

  // Test 1'in seçtiği pencere — test 2 bununla örtüşecek saatı kullanır.
  let chosenSlot = { start: '15:00', end: '17:00' };

  test('yeni iş panoda kuyrukta görünür; klavye yoluyla atanır ve kolona taşınır', async ({
    page,
  }) => {
    // Slot adayı denemeleri toplam süreyi uzatabilir.
    test.setTimeout(120_000);
    // 1) Yeni iş emri oluştur (planlanmamış → kuyruk).
    await page.goto('/app/work-orders');
    await page.getByRole('button', { name: '＋ Yeni İş Emri' }).click();
    const drawer = page.getByRole('dialog', { name: 'Yeni İş Emri' });
    const subject = `E2E Dispatch ${RUN}`;
    await drawer.getByLabel('Konu').fill(subject);
    await drawer.getByRole('button', { name: 'İş emrini oluştur' }).click();
    await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible({
      timeout: 15_000,
    });

    // 2) Pano: kuyrukta görünür.
    await page.goto('/app/dispatch');
    await expect(page.getByRole('heading', { level: 1, name: 'Dispatch Panosu' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: new RegExp(`WO-\\d{4}-\\d{4}`) }).first(),
    ).toBeVisible();
    const queueCard = page.locator('.tf-dispatch__card', { hasText: subject }).first();
    await expect(queueCard).toBeVisible();

    // 3) KLAVYE ALTERNATİFİ: kart düğmesiyle atama paneli (sürükle-bırak
    // eşdeğeri). Tekrar koşularda önceki E2E işleri slot kapabilir —
    // çakışmasız ilk pencere adayları sırayla denenir.
    const slots = [
      { start: '15:00', end: '17:00' },
      { start: '12:00', end: '14:00' },
      { start: '09:00', end: '11:00' },
      { start: '14:00', end: '15:00' },
      { start: '11:00', end: '12:00' },
      { start: '16:00', end: '18:00' },
      { start: '10:00', end: '11:00' },
      { start: '13:00', end: '14:00' },
      { start: '17:00', end: '18:00' },
    ];
    const successCardInColumn = page
      .locator('.tf-dispatch__col[data-technician]', { hasText: 'Emre Yılmaz' })
      .locator('.tf-dispatch__card', { hasText: subject });
    let scheduled = false;
    for (const slot of slots) {
      await queueCard.getByRole('button', { name: /Planla \/ Ata/ }).click();
      const panel = page.getByRole('dialog', { name: new RegExp(/^Planla: WO-/) });
      await expect(panel).toBeVisible();
      await selectTechnician(panel, 'Emre Yılmaz');
      await panel.getByLabel('Tarih').fill(boardDateIso());
      await panel.getByLabel('Başlangıç').fill(slot.start);
      await panel.getByLabel('Bitiş').fill(slot.end);
      await panel.getByRole('button', { name: 'Planı kaydet' }).click();
      // Başarının kalıcı kanıtı: kartın Emre kolonuna taşınması (başarı
      // mesajı panelin kendiliğinden kapanmasıyla kısa ömürlüdür).
      await Promise.all([
        successCardInColumn.waitFor({ timeout: 10_000 }).catch(() => undefined),
        page
          .locator('.tf-dispatch__conflictbox')
          .waitFor({ timeout: 10_000 })
          .catch(() => undefined),
      ]);
      if (await successCardInColumn.isVisible().catch(() => false)) {
        chosenSlot = slot;
        scheduled = true;
        break;
      }
      // Çakışan aday → vazgeç ve sonrakini dene.
      await panel.getByRole('button', { name: 'Vazgeç' }).click();
      await expect(panel).toBeHidden();
    }
    expect(scheduled, 'hiçbir çakışmasız slot bulunamadı').toBe(true);

    // 4) Kart teknisyen kolonuna taşınır.
    const emreColumn = page.locator('.tf-dispatch__col[data-technician]', {
      hasText: 'Emre Yılmaz',
    });
    await expect(emreColumn.locator('.tf-dispatch__card', { hasText: subject })).toBeVisible({
      timeout: 15_000,
    });

    // 5) Kalıcılık: yeniden yüklemede yerinde.
    await page.reload();
    await expect(
      page
        .locator('.tf-dispatch__col[data-technician]', {
          hasText: 'Emre Yılmaz',
        })
        .locator('.tf-dispatch__card', { hasText: subject }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('çakışan ikinci iş → panelde çakışma uyarısı görünür', async ({ page }) => {
    // Kuyruğa ikinci iş aç.
    await page.goto('/app/work-orders');
    await page.getByRole('button', { name: '＋ Yeni İş Emri' }).click();
    const drawer = page.getByRole('dialog', { name: 'Yeni İş Emri' });
    const subject = `E2E Çakışan ${RUN}`;
    await drawer.getByLabel('Konu').fill(subject);
    await drawer.getByRole('button', { name: 'İş emrini oluştur' }).click();
    await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible({
      timeout: 15_000,
    });

    // Aynı teknisyen, seçilen pencereyle örtüşen saat → 409 beklenir.
    await page.goto('/app/dispatch');
    const queueCard = page.locator('.tf-dispatch__card', { hasText: subject }).first();
    await expect(queueCard).toBeVisible();
    await queueCard.getByRole('button', { name: /Planla \/ Ata/ }).click();
    const panel = page.getByRole('dialog', { name: new RegExp(/^Planla: WO-/) });
    await selectTechnician(panel, 'Emre Yılmaz');
    await panel.getByLabel('Tarih').fill(boardDateIso());
    await panel.getByLabel('Başlangıç').fill(shiftMinutes(chosenSlot.start, 30));
    await panel.getByLabel('Bitiş').fill(shiftMinutes(chosenSlot.end, 60));
    await panel.getByRole('button', { name: 'Planı kaydet' }).click();

    // 409 bulguları panelde (override alanı owner için görünür).
    await expect(page.locator('.tf-dispatch__conflictbox')).toContainText('Çift rezervasyon', {
      timeout: 15_000,
    });
    await expect(panel.getByText('Çakışmaya rağmen planla')).toBeVisible();

    // Vazgeç — iş kuyrukta kalır.
    await panel.getByRole('button', { name: 'Vazgeç' }).click();
    await expect(page.locator('.tf-dispatch__card', { hasText: subject }).first()).toBeVisible();
  });

  test('teknisyen panoya giremez — rol sınırı', async ({ browser }) => {
    const context = await browser.newContext();
    await context.clearCookies();
    const page = await context.newPage();
    await page.goto('/login');
    await page.locator('input[name="email"]').fill('technician1@atlas.example.test');
    await page.locator('input[name="password"]').fill('Atlas!2026');
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Genel Bakış' })).toBeVisible({
      timeout: 15_000,
    });

    // Menüde Dispatch görünmez (gizleme UX; sunucu 403'ü ayrıca uygular).
    await expect(page.getByRole('link', { name: 'Dispatch Panosu' })).toHaveCount(0);

    // Doğrudan URL → yetki uyarısı, pano verisi yok.
    await page.goto('/app/dispatch');
    await expect(page.getByText('Bu bölüm için yetkiniz yok')).toBeVisible();
    await expect(page.locator('.tf-dispatch__kanban')).toHaveCount(0);
    await context.close();
  });

  test('mobil viewport: pano dikey akar ve erişilebilir', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto('/app/dispatch');
    await expect(page.getByRole('heading', { level: 1, name: 'Dispatch Panosu' })).toBeVisible();
    // Görünüm seçici radyo grubu dokunmatik hedef olarak görünür.
    const segmented = page.getByRole('radiogroup', { name: 'Pano görünümü' });
    await expect(segmented).toBeVisible();
    // Takvim görünümüne geçiş (mobil grid yatay kaydırılabilir). Girdi
    // görsel-gizlidir; görünür etikete dokunma tetikler.
    await segmented.getByText('Takvim', { exact: true }).tap();
    await expect(page.getByRole('grid', { name: 'Haftalık dispatch takvimi' })).toBeVisible();
    await context.close();
  });
});

/** Pano günü (bugün) YYYY-MM-DD — planlama pano görünümünde kalıcı olsun.
 * KIRACI SAAT DİLİMİ (Europe/Istanbul) yerel tarihi kullanılır: UTC gece
 * saatlerinde UTC tarihi İstanbul'dan bir gün geride kalabilir — pano
 * kiracı yerel gününü gösterir (TEST-09 §8 saat dilimi sınırı). */
function boardDateIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

/** HH:mm değerini N dakika kaydır (kuyruk penceresiyle örtüşme üretimi). */
function shiftMinutes(time: string, minutes: number): string {
  const [hour, minute] = time.split(':').map(Number);
  const total = (hour ?? 0) * 60 + (minute ?? 0) + minutes;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

/** Seçenek etiketi takım/bölge ekleri taşır — değere göre sağlam seçim. */
async function selectTechnician(panel: Locator, name: string): Promise<void> {
  const option = panel.getByRole('option', { name: new RegExp(name) });
  const value = await option.getAttribute('value');
  if (!value) throw new Error(`Teknisyen seçeneği bulunamadı: ${name}`);
  await panel.getByLabel('Teknisyen').selectOption(value);
}
