import { expect, test } from '@playwright/test';

/**
 * TEST-03 §6 — Faz 03 web E2E: kimlik akışları + rol sınırı + duyarlılık.
 *
 * Tohum demo kiracısı kullanılır (owner + technician parolaları .env'den
 * gelir; test ortamı varsayılanı). Erişilebilir seçicilerle sorgulanır.
 */
const OWNER_EMAIL = 'owner@atlas.example.test';
const TECHNICIAN_EMAIL = 'technician1@atlas.example.test';
const PASSWORD = 'Atlas!2026';

test.describe('giriş akışı', () => {
  test('yanlış parola genel hata gösterir (sayım azaltma UI)', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(OWNER_EMAIL);
    await page.locator('input[name="password"]').fill('WrongPassword9');
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await expect(page.getByText('E-posta veya parola hatalı')).toBeVisible();
  });

  test('doğru girişte korumalı kabuğa girer', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(TECHNICIAN_EMAIL);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Giriş yap' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Operasyon Genel Bakışı' }),
    ).toBeVisible();
    // Kabuk oturumdan türetilir: kullanıcı adı görünür (teknisyen).
    await expect(page.getByText('Emre Yılmaz').first()).toBeVisible();
  });

  test('oturumsuz korumalı sayfa → /login yönlendirmesi', async ({ page }) => {
    await page.goto('/app/users');
    await expect(page).toHaveURL(/\/login/);
  });

  test('çıkış sonrası korumalı sayfa erişilemez (oturum iptali kalıcı)', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(OWNER_EMAIL);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Operasyon Genel Bakışı' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Çıkış' }).click();
    await expect(page).toHaveURL(/\/login/);

    // Geri gidince yine login (sunucu tarafı iptal).
    await page.goto('/app/overview');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('rol sınırı (sunucu tarafı RBAC UI yansıması)', () => {
  test('owner: kullanıcı yönetimi görür ve üye listesini açar', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(OWNER_EMAIL);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Giriş yap' }).click();

    await page.getByRole('link', { name: 'Kullanıcılar & Roller' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Kullanıcılar & Roller' }),
    ).toBeVisible();
    // Demo kiracının üyeleri görünür (RLS: yalnız kendi kiracısı).
    await expect(page.getByText('owner@atlas.example.test')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Firma Sahibi' })).toBeVisible();
  });

  test('teknisyen: menüde yönetim yok; doğrudan URL → yetki uyarısı', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(TECHNICIAN_EMAIL);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Giriş yap' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Operasyon Genel Bakışı' }),
    ).toBeVisible();
    // Gizleme UX'tir; yetki sunucuda — URL ile zorla:
    await page.goto('/app/users');
    await expect(page.getByText('Bu bölüm için yetkiniz yok')).toBeVisible();
    // Yönetim menüsü teknisyende görünmez.
    await expect(page.getByRole('link', { name: 'Kullanıcılar & Roller' })).toHaveCount(0);
  });
});

test.describe('signup (onboarding) akışı', () => {
  test('yeni kiracı kaydı → oturum açılır ve MERKEZ şubesi hazır', async ({ page }) => {
    const run = Date.now().toString(36);
    await page.goto('/signup');

    await page.locator('input[name="tenantName"]').fill(`Test Firma ${run}`);
    await page.locator('input[name="displayName"]').fill('Test Sahibi');
    await page.locator('input[name="email"]').fill(`e2e-${run}@test.example`);
    await page.locator('input[name="password"]').fill('SahaServis2026');
    await page.getByRole('button', { name: 'Kiracı oluştur ve başla' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Operasyon Genel Bakışı' }),
    ).toBeVisible();

    // Varsayılan şube kayıtla kurulur.
    await page.getByRole('link', { name: 'Şubeler' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Şubeler' })).toBeVisible();
    await expect(page.getByText('MERKEZ')).toBeVisible();
  });

  test('zayıf parola istemci tarafında engellenir (UX; asıl denetim API)', async ({ page }) => {
    await page.goto('/signup');
    await page.locator('input[name="tenantName"]').fill('Kısa Parola Test');
    await page.locator('input[name="displayName"]').fill('Test');
    await page.locator('input[name="email"]').fill('short-pw@test.example');
    await page.locator('input[name="password"]').fill('kisa');
    await page.getByRole('button', { name: 'Kiracı oluştur ve başla' }).click();
    await expect(page.getByText('En az 10 karakter')).toBeVisible();
  });
});

test.describe('davet akışı (owner → yeni kullanıcı)', () => {
  test('davet oluşturulur, bağlantı ile yeni kullanıcı kabul eder ve giriş yapar', async ({
    page,
    context,
  }) => {
    const run = Date.now().toString(36);
    const inviteeEmail = `davetli-${run}@test.example`;

    // Owner oturumu.
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(OWNER_EMAIL);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Giriş yap' }).click();

    await page.getByRole('link', { name: 'Kullanıcılar & Roller' }).click();

    // Davet oluştur.
    await page.locator('input[name="invite-email"]').fill(inviteeEmail);
    await page.locator('select[name="invite-role"]').selectOption('dispatcher');
    await page.getByRole('button', { name: 'Davet oluştur' }).click();
    await expect(page.getByText('Davet oluşturuldu')).toBeVisible();

    // Tek kullanımlık bağlantıyı al.
    const linkElement = page.locator('code').first();
    const inviteUrl = (await linkElement.textContent()) ?? '';
    expect(inviteUrl).toContain('/invitations/');

    // "E-posta gönderimi": temiz bağlamda (çerezler yok) yeni kullanıcı.
    await context.clearCookies();

    // Önizleme + kabul.
    await page.goto(inviteUrl);
    await expect(page.getByText('Atlas Teknik Servis daveti')).toBeVisible();
    await expect(page.getByText(inviteeEmail)).toBeVisible();

    await page.locator('input[name="password"]').fill('SahaServis2026');
    await page.getByRole('button', { name: 'Daveti kabul et' }).click();
    await expect(page.getByText('Davet kabul edildi')).toBeVisible();

    await page.getByRole('button', { name: 'Genel bakışa git' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Operasyon Genel Bakışı' }),
    ).toBeVisible();

    // Yeni üye listede (owner görüşü değil ama dispatcher kabuğu çalışır).
    // Teknisyen olmayan dispatcher menüsünde yönetim görmez (users:manage yok).
    await expect(page.getByRole('link', { name: 'Kullanıcılar & Roller' })).toHaveCount(0);
  });
});

test.describe('duyarlılık (mobil 390px)', () => {
  test('mobil giriş formu tek sütun, dokunmatik hedefler yeterli', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');

    await expect(page.getByRole('heading', { level: 1, name: "TeknikFlow'a giriş" })).toBeVisible();
    const button = page.getByRole('button', { name: 'Giriş yap' });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(36);

    // Giriş sonrası mobil kabuk: hamburger görünür.
    await page.locator('input[name="email"]').fill(TECHNICIAN_EMAIL);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Operasyon Genel Bakışı' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Menüyü (aç|kapat)/ })).toBeVisible();
  });
});
