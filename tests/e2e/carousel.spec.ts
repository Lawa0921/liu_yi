import { devices, expect, test, type Page } from './fixtures';
import { AUDIENCE_STORAGE_KEY } from './helpers';

// 防身格鬥有 3 張照片，用它測輪播。照片只有小孩課程有，所以先把對象設成小孩。
const CARD = '[data-audience-panel="kid"] .course-card:has(h3:text-is("防身格鬥"))';

const CLOCK_START = new Date('2026-01-01T00:00:00');
const CLOCK_PAUSED = new Date('2026-01-01T01:00:00');

/**
 * 假時鐘：install() 之後時間仍照真實時間流動（Playwright 文件：要 pauseAt 才停）。
 * 這裡頁面載入後就把時間停住，之後只有 runFor 會推進——否則「2900ms 還沒換、再 200ms 才換」
 * 這種斷言會被測試本身花掉的真實時間（hover、斷言輪詢）偷偷推過 3 秒。
 */
async function openWithPausedClock(page: Page) {
  await page.clock.install({ time: CLOCK_START });
  // 輪播屬於 CourseCard；首頁改版後不再有卡片，課程總覽頁有同一批。
  await page.goto('./courses/');
  await page.clock.pauseAt(CLOCK_PAUSED);
}

async function openCoursesAsKid(page: Page) {
  await page.addInitScript((key) => window.localStorage.setItem(key, 'kid'), AUDIENCE_STORAGE_KEY);
  await openWithPausedClock(page);
}

function activeSlide(page: Page) {
  return page.locator(`${CARD} [data-carousel]`);
}

test.describe('桌機 hover 輪播', () => {
  test('滑鼠移上去每 3 秒換一張，移開停止並回到第一張', async ({ page }) => {
    await openCoursesAsKid(page);
    const card = page.locator(CARD);
    const slides = card.locator('[data-slide]');
    await expect(slides).toHaveCount(3);
    await expect(activeSlide(page)).toHaveAttribute('data-carousel-mode', 'hover');

    // 還沒 hover：時間過了也不動。
    await page.clock.runFor(7000);
    await expect(activeSlide(page)).toHaveAttribute('data-active-slide', '0');
    await expect(slides.nth(0)).toHaveClass(/is-active/);

    await card.scrollIntoViewIfNeeded();
    await card.hover();
    // 時間是停住的，所以可以卡到 1 毫秒：2999ms 還是第一張，第 3000ms 才換。
    await page.clock.runFor(2999);
    await expect(activeSlide(page)).toHaveAttribute('data-active-slide', '0');
    await page.clock.runFor(1);
    await expect(activeSlide(page)).toHaveAttribute('data-active-slide', '1');
    await expect(slides.nth(1)).toHaveClass(/is-active/);
    await expect(slides.nth(0)).not.toHaveClass(/is-active/);

    await page.clock.runFor(3000);
    await expect(activeSlide(page)).toHaveAttribute('data-active-slide', '2');
    await page.clock.runFor(3000);
    await expect(activeSlide(page)).toHaveAttribute('data-active-slide', '0');
    await page.clock.runFor(3000);
    await expect(activeSlide(page)).toHaveAttribute('data-active-slide', '1');

    // 移開：回第一張，之後不再換。
    await page.mouse.move(0, 0);
    await expect(activeSlide(page)).toHaveAttribute('data-active-slide', '0');
    await expect(slides.nth(0)).toHaveClass(/is-active/);
    await page.clock.runFor(9000);
    await expect(activeSlide(page)).toHaveAttribute('data-active-slide', '0');
  });

  test('沒有照片的課程是文字卡，不輪播', async ({ page }) => {
    await openWithPausedClock(page);
    const card = page.locator('[data-audience-panel="adult"] .course-card:has(h3:text-is("中式兵器"))');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-carousel]')).toHaveCount(0);
    await expect(card.locator('img')).toHaveCount(0);
    await card.hover();
    await page.clock.runFor(7000);
    await expect(card.locator('h3')).toBeVisible();
  });
});

test.describe('減少動態', () => {
  test.use({ reducedMotion: 'reduce' });

  test('hover 也不自動輪播', async ({ page }) => {
    await openCoursesAsKid(page);
    const card = page.locator(CARD);
    await expect(activeSlide(page)).toHaveAttribute('data-carousel-mode', 'none');
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.clock.runFor(10_000);
    await expect(card.locator('[data-slide]').nth(0)).toHaveClass(/is-active/);
    await expect(card.locator('[data-slide].is-active')).toHaveCount(1);
  });
});

test.describe('觸控裝置', () => {
  const { defaultBrowserType: _ignored, ...pixel } = devices['Pixel 7'];
  test.use({ ...pixel });

  test('卡片進入畫面中央才輪播，離開就停', async ({ page }) => {
    await openCoursesAsKid(page);
    const card = page.locator(CARD);
    await expect(activeSlide(page)).toHaveAttribute('data-carousel-mode', 'viewport');

    // 頁面頂端：卡片不在畫面中央，不播。
    await page.clock.runFor(7000);
    await expect(activeSlide(page)).toHaveAttribute('data-active-slide', '0');

    // 把卡片捲到視窗正中央。
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect.poll(async () => {
      await page.clock.runFor(3000);
      return activeSlide(page).getAttribute('data-active-slide');
    }).not.toBe('0');

    // 捲回頂端：停止並回第一張。
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(activeSlide(page)).toHaveAttribute('data-active-slide', '0');
    await page.clock.runFor(9000);
    await expect(activeSlide(page)).toHaveAttribute('data-active-slide', '0');
  });
});
