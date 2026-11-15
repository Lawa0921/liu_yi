import { expect, test, type Page } from '@playwright/test';
import { ADULT_COURSES, KID_COURSES } from './helpers';

// 第二階段的行為：首頁三幕的釘選（只在桌機、且沒有「減少動態」時）、進場效果不得藏住內容、
// 海報站內放大、課程頁照片切換按鈕。

const ACT_COURSES = [...ADULT_COURSES, ...KID_COURSES];

/** 三幕腳本跑完後會在 <html data-acts> 標上 pinned 或 static。 */
async function actsMode(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-acts', /pinned|static/);
  return page.locator('html').getAttribute('data-acts');
}

/** 區塊內被樣式藏起來（透明或 visibility:hidden）的元素。 */
function hiddenByStyle(page: Page, scope: string) {
  return page.evaluate((selector) => {
    const hidden: string[] = [];
    for (const root of document.querySelectorAll(selector)) {
      for (const el of root.querySelectorAll<HTMLElement>('h1, h2, h3, p, a, li, img')) {
        if (el.closest('[aria-hidden="true"]')) continue;
        // 輪播裡不是目前那一張的照片本來就該是透明的。
        if (el.matches('[data-slide]:not(.is-active)')) continue;
        let node: HTMLElement | null = el;
        while (node && node !== document.body) {
          const style = getComputedStyle(node);
          if (Number(style.opacity) < 0.99 || style.visibility === 'hidden') {
            hidden.push(`${el.tagName}.${el.className}: ${(el.textContent ?? '').trim().slice(0, 12)}`);
            break;
          }
          node = node.parentElement;
        }
      }
    }
    return hidden;
  }, scope);
}

test.describe('首頁三幕：桌機', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('三幕各自釘選，捲到幕中段時那一幕停在畫面上', async ({ page }) => {
    await page.goto('./');
    expect(await actsMode(page)).toBe('pinned');
    await expect(page.locator('.pin-spacer')).toHaveCount(3);

    const act = page.locator('[data-act="fist"]');
    const spacerTop = await act.evaluate(
      (el) => el.closest('.pin-spacer')!.getBoundingClientRect().top + window.scrollY,
    );
    await page.evaluate((y) => window.scrollTo(0, y), spacerTop + 500);
    await expect
      .poll(async () => Math.round((await act.boundingBox())!.y))
      .toBeLessThan(120);
    expect((await act.boundingBox())!.y).toBeGreaterThanOrEqual(0);
    await expect(act.getByRole('heading', { level: 2 })).toBeInViewport();
  });

  test('六門課的連結都在三幕裡，而且點得到', async ({ page }) => {
    await page.goto('./');
    await actsMode(page);
    for (const course of ACT_COURSES) {
      await expect(page.locator(`.acts a[href$="courses/${course.slug}/"]`)).toHaveCount(1);
    }
    await page.locator('.acts a[href$="courses/bajiquan/"]').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('八極專修');
  });
});

test.describe('首頁三幕：減少動態', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('不釘選，首屏與三幕的內容直接可見', async ({ page }) => {
    await page.goto('./');
    expect(await actsMode(page)).toBe('static');
    await expect(page.locator('.pin-spacer')).toHaveCount(0);

    for (const course of ACT_COURSES) {
      await expect(page.locator(`.acts a[href$="courses/${course.slug}/"]`)).toBeVisible();
    }
    expect(await hiddenByStyle(page, '.hero, .acts')).toEqual([]);
    // 顆粒不動。
    const grain = await page.locator('.grain').evaluate((el) => getComputedStyle(el).animationName);
    expect(grain).toBe('none');
  });

  test('捲到底，其餘區塊也沒有被進場效果藏住', async ({ page }) => {
    await page.goto('./');
    await actsMode(page);
    expect(await hiddenByStyle(page, 'main')).toEqual([]);
  });
});

test.describe('首頁三幕：手機寬度', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('不釘選，一般捲動', async ({ page }) => {
    await page.goto('./');
    expect(await actsMode(page)).toBe('static');
    await expect(page.locator('.pin-spacer')).toHaveCount(0);

    const act = page.locator('[data-act="fist"]');
    await act.scrollIntoViewIfNeeded();
    const before = (await act.boundingBox())!.y;
    await page.mouse.wheel(0, 200);
    await expect.poll(async () => (await act.boundingBox())!.y).toBeLessThan(before - 100);
    expect(await act.evaluate((el) => getComputedStyle(el).position)).not.toBe('fixed');
  });

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

  test('捲到的區塊會進場顯示出來', async ({ page }) => {
    await page.goto('./');
    await actsMode(page);
    const link = page.locator('.acts a[href$="courses/sanshou/"]');
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible();
    await expect.poll(() => hiddenByStyle(page, '[data-act="combat"]')).toEqual([]);
  });
});

test.describe('沒有 JavaScript：桌機', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });

  test('首屏、三幕、各區塊的內容都看得到', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const course of ACT_COURSES) {
      await expect(page.locator(`.acts a[href$="courses/${course.slug}/"]`)).toBeVisible();
    }
    expect(await hiddenByStyle(page, 'main')).toEqual([]);
    await expect(page.locator('.pin-spacer')).toHaveCount(0);
  });

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
