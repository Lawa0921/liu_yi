import { expect, test, type Page } from './fixtures';
import { AUDIENCE_STORAGE_KEY, COACHES, basePath } from './helpers';

// 驗收後補的行為：手機不外溢、切換對象不跳動、LINE 連結、職稱不斷行、404 的 meta、海報放大後看得清楚、標題層級。

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('手機寬度：大人｜小孩', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // 首頁版本（先捲到課程段再點切換）在 home.spec.ts。
  for (const path of ['./courses/']) {
    test(`切到小孩、切回大人都沒有水平外溢 @ ${path}`, async ({ page }) => {
      await page.goto(path);
      expect(await overflow(page), '大人').toBeLessThanOrEqual(0);

      await page.getByRole('button', { name: '小孩' }).click();
      // 進場動畫從開始到結束都不能把頁面撐寬。
      for (let i = 0; i < 6; i++) {
        expect(await overflow(page), `小孩 #${i}`).toBeLessThanOrEqual(0);
        await page.waitForTimeout(150);
      }
      await expect(page.locator('[data-nav-toggle]')).toBeInViewport({ ratio: 1 });

      await page.getByRole('button', { name: '大人' }).click();
      for (let i = 0; i < 4; i++) {
        expect(await overflow(page), `大人 #${i}`).toBeLessThanOrEqual(0);
        await page.waitForTimeout(150);
      }
    });

    test(`記住小孩後重新整理也沒有水平外溢 @ ${path}`, async ({ page }) => {
      await page.addInitScript((key) => window.localStorage.setItem(key, 'kid'), AUDIENCE_STORAGE_KEY);
      await page.goto(path);
      for (let i = 0; i < 6; i++) {
        expect(await overflow(page), `#${i}`).toBeLessThanOrEqual(0);
        await page.waitForTimeout(150);
      }
    });
  }
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  test(`切換對象時卡片不上下跳動（${viewport.width} 寬）`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('./courses/');
    const firstCardTop = async (audience: 'adult' | 'kid') => {
      const card = page.locator(`[data-audience-panel="${audience}"] .course-card`).first();
      await expect(card).toBeVisible();
      // 等進場動畫結束（位置不再變）。
      let last = -1;
      await expect
        .poll(async () => {
          const y = Math.round((await card.boundingBox())!.y + (await page.evaluate(() => window.scrollY)));
          const stable = y === last;
          last = y;
          return stable;
        })
        .toBe(true);
      return last;
    };

    const adult = await firstCardTop('adult');
    await page.getByRole('button', { name: '小孩' }).click();
    expect(await firstCardTop('kid')).toBe(adult);
    await page.getByRole('button', { name: '大人' }).click();
    expect(await firstCardTop('adult')).toBe(adult);
  });
}

test('預約體驗視窗裡有可點的 LINE 加好友連結（手機不必掃自己的螢幕）', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./courses/');
  await page.locator('[data-nav-toggle]').click();
  await page.getByRole('navigation', { name: '主要導覽' }).getByRole('link', { name: '預約體驗' }).click();

  const dialog = page.locator('#line-dialog');
  await expect(dialog).toBeVisible();
  const link = dialog.getByRole('link', { name: '用 LINE 加入' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', /^https:\/\/(line\.me|lin\.ee|page\.line\.me|liff\.line\.me)\//);
  await expect(dialog.getByRole('img', { name: /LINE/ })).toBeVisible();

  // 沒有 JS 時的落點（頁尾）也有同一個連結。
  const footerLink = page.locator('#line').getByRole('link', { name: '用 LINE 加入' });
  await expect(footerLink).toHaveAttribute('href', (await link.getAttribute('href'))!);
});

test.describe('手機寬度：師資卡', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('職稱不斷行，卡片不用海報當縮圖', async ({ page }) => {
    await page.goto('./coaches/');
    const cards = page.locator('.coach-card');
    await expect(cards).toHaveCount(COACHES.length);
    await expect(cards.locator('img')).toHaveCount(0);

    for (const role of await page.locator('.coach-card__role').all()) {
      const { height, lineHeight } = await role.evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(el).lineHeight),
      }));
      expect(height, await role.innerText()).toBeLessThan(lineHeight * 1.5);
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

test('404 頁不輸出 canonical 與 og:url，並標 noindex', async ({ page }) => {
  await page.goto('./no-such-page/');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('一般頁面仍有 canonical，且沒有 noindex', async ({ page, baseURL }) => {
  await page.goto('./pricing/');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://lawa0921.github.io${basePath(baseURL)}pricing/`,
  );
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

test.describe('手機寬度：海報放大', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('放大後的海報比螢幕寬很多，可以橫向捲動看清楚字', async ({ page }) => {
    await page.goto('./pricing/');
    await page.locator('[data-poster]').first().click();
    const dialog = page.locator('#poster-dialog');
    await expect(dialog).toBeVisible();
    const image = dialog.getByRole('img');
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(900);

    const width = await image.evaluate((img) => img.getBoundingClientRect().width);
    expect(width).toBeGreaterThanOrEqual(700);
    const scrollable = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(scrollable).toBeGreaterThan(300);

    // 底下的頁面沒有被撐寬；關閉鈕還在畫面上。
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expect(dialog.getByRole('button', { name: '關閉' })).toBeInViewport({ ratio: 1 });
    await dialog.getByRole('button', { name: '關閉' }).click();
    await expect(dialog).toBeHidden();
  });
});

test('標題層級不跳級：課程總覽與師資總覽的卡片 h3 上面有 h2', async ({ page }) => {
  for (const path of ['./courses/', './coaches/']) {
    await page.goto(path);
    const skipped = await page.evaluate(() => {
      const levels = Array.from(document.querySelectorAll('main h1, main h2, main h3, main h4')).map((h) => ({
        level: Number(h.tagName[1]),
        text: (h.textContent ?? '').trim(),
      }));
      const problems: string[] = [];
      let previous = 0;
      for (const { level, text } of levels) {
        if (level > previous + 1) problems.push(`h${previous} → h${level}「${text}」`);
        previous = level;
      }
      return problems;
    });
    expect(skipped, path).toEqual([]);
  }
});

test('首頁首屏的進場在 1.2 秒內完成（手機）', async ({ page }) => {
  // 開場（.opening）的字樣進場動畫；無限循環的提示線不算。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  const longest = await page.evaluate(() =>
    Math.max(
      ...Array.from(document.querySelectorAll('.opening *'))
        .flatMap((el) => el.getAnimations())
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => Number(animation.effect?.getComputedTiming().endTime ?? 0)),
    ),
  );
  expect(longest).toBeGreaterThan(0);
  expect(longest).toBeLessThanOrEqual(1200);
});
