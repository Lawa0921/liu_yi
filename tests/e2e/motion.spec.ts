import { expect, test } from '@playwright/test';

// 第二階段的行為：手機選單展開時鎖住捲動、沒有 JavaScript 時海報仍可看、海報站內放大、課程頁照片切換。
// 舊首頁的三幕與釘選捲動已隨首頁改版移除，首頁的行為見 home.spec.ts 與 home-fallback.spec.ts。

test.describe('手機寬度', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('選單展開成全螢幕並鎖住底下的捲動，關閉後解除', async ({ page }) => {
    await page.goto('./');
    const toggle = page.locator('[data-nav-toggle]');
    await toggle.click();
    const nav = page.getByRole('navigation', { name: '主要導覽' });
    await expect(nav).toBeVisible();
    const box = (await nav.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(390);
    expect(box.height).toBeGreaterThanOrEqual(844);
    await expect(page.locator('html')).toHaveClass(/nav-open/);
    await toggle.click();
    await expect(page.locator('html')).not.toHaveClass(/nav-open/);
  });
});

test.describe('沒有 JavaScript：桌機', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });

  test('海報仍是連到圖檔的連結，照片切換按鈕不顯示', async ({ page, request }) => {
    await page.goto('./pricing/');
    const href = await page.locator('[data-poster]').first().getAttribute('href');
    expect(href).toMatch(/\.(webp|png|jpe?g|avif)$/);
    expect((await request.get(new URL(href!, page.url()).href)).status()).toBe(200);

    await page.goto('./courses/bjj/');
    await expect(page.locator('[data-gallery] img').first()).toBeVisible();
    await expect(page.locator('[data-gallery-next]')).toBeHidden();
  });
});

test.describe('海報站內放大', () => {
  test('點海報在站內開啟放大視窗，可用按鈕、Esc、點背景關閉', async ({ page }) => {
    await page.goto('./pricing/');
    const url = page.url();
    const dialog = page.locator('#poster-dialog');
    await expect(dialog).toBeHidden();

    const posters = page.locator('[data-poster]');
    await expect(posters).toHaveCount(4);

    await posters.first().click();
    await expect(dialog).toBeVisible();
    expect(page.url()).toBe(url);
    const image = dialog.getByRole('img');
    await expect(image).toHaveAttribute('alt', /課程收費表/);
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(900);

    await dialog.getByRole('button', { name: '關閉' }).click();
    await expect(dialog).toBeHidden();

    // 鍵盤：聚焦連結按 Enter 開啟，Esc 關閉，焦點回到原本的海報。
    await posters.nth(1).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img')).toHaveAttribute('alt', /VIP/);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(posters.nth(1)).toBeFocused();

    // 點背景關閉。
    await posters.first().click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(dialog).toBeHidden();
  });

  test('課表與教練海報也用同一個放大視窗', async ({ page }) => {
    for (const path of ['./schedule/', './coaches/chan/']) {
      await page.goto(path);
      await page.locator('[data-poster]').first().click();
      await expect(page.locator('#poster-dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#poster-dialog')).toBeHidden();
    }
  });
});

test.describe('課程頁照片切換', () => {
  test('上一張／下一張按鈕切換照片，頭尾會停用', async ({ page }) => {
    await page.goto('./courses/kids-self-defense/');
    const gallery = page.locator('[data-gallery]');
    const prev = page.getByRole('button', { name: '上一張照片' });
    const next = page.getByRole('button', { name: '下一張照片' });
    const status = page.locator('[data-gallery-status]');

    await expect(gallery.locator('img')).toHaveCount(3);
    await expect(status).toHaveText('1 / 3');
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();

    await next.click();
    await expect(status).toHaveText('2 / 3');
    // 清單捲到第二張：第二張的左緣對齊清單左緣。
    await expect
      .poll(() => gallery.evaluate((el) => Math.round((el.scrollLeft / el.clientWidth) * 100) / 100))
      .toBe(1);
    await expect(gallery.locator('img').nth(1)).toBeInViewport({ ratio: 0.5 });
    await expect(prev).toBeEnabled();

    await next.click();
    await expect(status).toHaveText('3 / 3');
    await expect(next).toBeDisabled();

    await prev.click();
    await expect(status).toHaveText('2 / 3');
  });

  test('鍵盤可操作按鈕', async ({ page }) => {
    await page.goto('./courses/bjj/');
    const next = page.getByRole('button', { name: '下一張照片' });
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-gallery-status]')).toHaveText('2 / 5');
  });

  test('沒有照片的課程頁沒有照片區與按鈕', async ({ page }) => {
    await page.goto('./courses/bajiquan/');
    await expect(page.locator('[data-gallery]')).toHaveCount(0);
    await expect(page.locator('[data-gallery-next]')).toHaveCount(0);
  });
});
