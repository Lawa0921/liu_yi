import { expect, test } from '@playwright/test';
import { ADULT_COURSES, KID_COURSES, basePath, cardTitles } from './helpers';

const NAV_LABELS = ['課程', '師資', '場地', '收費', '課表'];

test.describe('導覽', () => {
  test('桌機：導覽列直接可見，五個項目加預約體驗', async ({ page, baseURL }) => {
    await page.goto('./');
    const nav = page.getByRole('navigation', { name: '主要導覽' });
    await expect(nav.getByRole('listitem')).toHaveText(NAV_LABELS);
    await expect(nav.getByRole('link', { name: '預約體驗' })).toBeVisible();
    await expect(page.locator('[data-nav-toggle]')).toBeHidden();

    await nav.getByRole('link', { name: '師資' }).click();
    await expect(page).toHaveURL(new RegExp(`${basePath(baseURL)}coaches/$`));
    await expect(nav.getByRole('link', { name: '師資' })).toHaveAttribute('aria-current', 'page');
  });

  test.describe('手機寬度', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('選單可以開、可以關', async ({ page }) => {
      await page.goto('./');
      const toggle = page.locator('[data-nav-toggle]');
      const nav = page.getByRole('navigation', { name: '主要導覽' });

      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(nav).toBeHidden();

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(nav).toBeVisible();
      for (const label of NAV_LABELS) await expect(nav.getByRole('link', { name: label })).toBeVisible();

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(nav).toBeHidden();

      await toggle.click();
      await page.keyboard.press('Escape');
      await expect(nav).toBeHidden();
      await expect(toggle).toBeFocused();
    });

    test('頁面沒有水平捲軸', async ({ page }) => {
      for (const path of ['./', './courses/', './courses/bjj/', './coaches/chan/', './pricing/']) {
        await page.goto(path);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, path).toBeLessThanOrEqual(0);
      }
    });
  });
});

test.describe('預約體驗', () => {
  test('開啟 LINE QR 視窗，可以關閉', async ({ page }) => {
    await page.goto('./courses/');
    const dialog = page.locator('#line-dialog');
    await expect(dialog).toBeHidden();

    await page.getByRole('navigation', { name: '主要導覽' }).getByRole('link', { name: '預約體驗' }).click();
    await expect(dialog).toBeVisible();
    const qr = dialog.getByRole('img', { name: /LINE/ });
    await expect(qr).toBeVisible();
    await expect.poll(() => qr.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    await dialog.getByRole('button', { name: '關閉' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('navigation', { name: '主要導覽' }).getByRole('link', { name: '預約體驗' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('站上沒有範本假聯絡資訊', async ({ page }) => {
    for (const path of ['./', './facility/', './pricing/']) {
      await page.goto(path);
      const text = await page.locator('body').innerText();
      expect(text).not.toMatch(/Nashville|Somewhere Road|555-5555|info@liuyiwushu\.com/);
    }
  });
});

test.describe('減少動態', () => {
  test.use({ reducedMotion: 'reduce' });

  test('內容全部可見', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const headings = page.locator('main h2');
    expect(await headings.count()).toBeGreaterThanOrEqual(5);
    for (const heading of await headings.all()) await expect(heading).toBeVisible();
    for (const card of await cardTitles(page, 'adult').all()) await expect(card).toBeVisible();

    const hiddenByStyle = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main section'))
        .filter((el) => {
          const style = getComputedStyle(el);
          return style.opacity === '0' || style.visibility === 'hidden';
        })
        .map((el) => el.id || el.className),
    );
    expect(hiddenByStyle).toEqual([]);

    await page.getByRole('button', { name: '小孩' }).click();
    for (const card of await cardTitles(page, 'kid').all()) await expect(card).toBeVisible();
  });
});

test.describe('沒有 JavaScript', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });

  test('內容仍看得到、連結都能點', async ({ page, baseURL }) => {
    await page.goto('./');

    // 兩個對象的卡片都顯示；切換按鈕沒有作用所以不顯示。
    await expect(cardTitles(page, 'adult')).toHaveText(ADULT_COURSES.map((c) => c.title));
    await expect(cardTitles(page, 'kid')).toHaveText(KID_COURSES.map((c) => c.title));
    for (const card of await page.locator('[data-audience-panel] .course-card h3').all()) {
      await expect(card).toBeVisible();
    }
    await expect(page.locator('[data-audience-option]').first()).toBeHidden();

    // 手機寬度下導覽直接展開，選單按鈕不顯示。
    const nav = page.getByRole('navigation', { name: '主要導覽' });
    await expect(nav.getByRole('link', { name: '課程' })).toBeVisible();
    await expect(page.locator('[data-nav-toggle]')).toBeHidden();

    // 有照片的卡片顯示第一張。
    const firstSlide = page.locator('[data-audience-panel="kid"] [data-slide]').first();
    await expect(firstSlide).toBeVisible();

    // 「預約體驗」退回成跳到頁尾的 LINE QR。
    const booking = nav.getByRole('link', { name: '預約體驗' });
    await expect(booking).toHaveAttribute('href', '#line');
    await expect(page.locator('#line').getByRole('img', { name: /LINE/ })).toBeVisible();

    await nav.getByRole('link', { name: '課程' }).click();
    await expect(page).toHaveURL(new RegExp(`${basePath(baseURL)}courses/$`));
    await page.locator('[data-audience-panel="kid"] .course-card a').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('防身兵器');
    await expect(page.locator('[data-course-body]')).toBeVisible();
    await expect(page.locator('[data-gallery] img').first()).toBeVisible();
  });
});
