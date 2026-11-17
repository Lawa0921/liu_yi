import { expect, test, type Page } from './fixtures';
import {
  AUDIENCE_STORAGE_KEY,
  COACHES,
  HOME_ADULT_ORDER,
  HOME_KID_ORDER,
  PUBLISHED_COURSES,
  basePath,
  hiddenByStyle,
  homeTitles,
} from './helpers';

// 首頁（「氣聚成人」）的 DOM 骨架：開場、課程六個 beat、其他課程、師資、收費課表、預約，以及大人／小孩切換。
// 光點引擎在後面的任務才接上，這裡只驗 DOM 與版面；每段的內容都是 DOM 文字，不依賴 canvas。

const DEVICES = [
  { name: '桌機 1440×900', viewport: { width: 1440, height: 900 } },
  { name: '手機 390×844', viewport: { width: 390, height: 844 } },
];

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** 小孩三門課在首頁的先後：拳 → 格鬥 → 兵器（與 HOME_KID_ORDER 的課名一一對應）。 */
const HOME_KID_SLUGS = ['kids-martial-arts', 'kids-self-defense', 'kids-weapons'];

for (const device of DEVICES) {
  test.describe(`首頁內容：${device.name}`, () => {
    test.use({ viewport: device.viewport });

    test('恰有一個 h1「六藝武術」，副標含八極拳・兵器・格鬥', async ({ page }) => {
      await page.goto('./');
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveText('六藝武術');
      await expect(page.locator('#opening .opening__sub')).toContainText('八極拳・兵器・格鬥');
      await expect(page.locator('main#main[data-home]')).toHaveCount(1);
      await expect(page.locator('#opening[data-beat="opening"]')).toHaveCount(1);
    });

    test('開場有靜態海報（高優先載入）、略過按鈕與往下捲提示', async ({ page }) => {
      await page.goto('./');
      const poster = page.locator('#opening .opening__poster img');
      await expect(poster).toHaveCount(1);
      await expect(poster).toHaveAttribute('fetchpriority', 'high');
      await expect.poll(() => poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
      await expect(page.locator('#opening [data-skip-intro]')).toHaveCount(1);
      await expect(page.locator('#opening')).toContainText('往下捲');
    });

    test('每門已發布課程都有 DOM 標題與連結（不要求可見）；未發布的課程名 0 筆', async ({ page }) => {
      await page.goto('./');
      for (const course of PUBLISHED_COURSES) {
        const article = page.locator(`article[data-course="${course.slug}"]`);
        await expect(article, course.slug).toHaveCount(1);
        await expect(article.locator('h3'), course.slug).toHaveText(course.title);
        await expect(article.locator(`a[href$="courses/${course.slug}/"]`), course.slug).toHaveCount(1);
      }
      for (const title of ['內家養身功', '街舞一對一', '青少年格鬥基礎班', '幼兒武術']) {
        await expect(page.getByText(title)).toHaveCount(0);
      }
    });

    test('兵器：兩個對象各有三個子項（中國劍、苗刀、大槍），「看真兵器」連到中式兵器課程頁', async ({ page }) => {
      await page.goto('./');
      for (const audience of ['adult', 'kid'] as const) {
        const items = page.locator(`#courses [data-audience-panel="${audience}"] [data-sub-item]`);
        await expect(items, audience).toHaveCount(3);
        const texts = await items.allInnerTexts();
        expect(texts[0], audience).toContain('中國劍');
        expect(texts[1], audience).toContain('苗刀');
        expect(texts[2], audience).toContain('大槍');

        // 非作用中的那組是隱藏的，getByRole 會略過它，所以用 CSS 選取（它仍是 DOM 裡可抓取的連結）。
        const real = page.locator(`[data-beat="weapon-c"] [data-audience-panel="${audience}"] a`, { hasText: '看真兵器' });
        await expect(real, audience).toHaveCount(1);
        await expect(real, audience).toHaveAttribute('href', /courses\/chinese-weapons\/$/);
      }
    });

    test('兵器三段：小孩版各有一句小孩語氣的說明（持劍、持刀、持槍，編號四、五、六），大人版仍是大人的說明；名稱都是課程子項的名稱', async ({ page }) => {
      await page.goto('./');
      const expected = {
        kid: { 'weapon-a': '雙手握穩，劍尖向前。', 'weapon-b': '低弓步，雙手握刀向前指。', 'weapon-c': '雙手持槍，穩穩向前扎。' },
        adult: { 'weapon-a': '劍走輕靈，點、刺、削、撩。', 'weapon-b': '雙手長刀，一刀一式，直來直往。', 'weapon-c': '大槍丈二，扎、攔、拿，步步進身。' },
      } as const;
      const numbers = { 'weapon-a': '四', 'weapon-b': '五', 'weapon-c': '六' } as const;
      for (const audience of ['kid', 'adult'] as const) {
        for (const beat of ['weapon-a', 'weapon-b', 'weapon-c'] as const) {
          const item = page.locator(`[data-beat="${beat}"] [data-audience-panel="${audience}"] [data-sub-item]`);
          await expect(item, `${audience} ${beat}`).toHaveCount(1);
          const text = await item.innerText();
          expect(text, `${audience} ${beat}`).toContain(expected[audience][beat]);
          expect(text, `${audience} ${beat} 編號`).toContain(numbers[beat]);
        }
      }
    });

    test('其他課程：巴西柔術、核心瑜珈，另有「所有課程」連到課程總覽', async ({ page }) => {
      await page.goto('./');
      const section = page.locator('section#others[data-beat="others"]');
      await expect(section.getByRole('heading', { level: 2 })).toHaveText('其他課程');
      await expect(section.locator('h3')).toHaveText(['巴西柔術', '核心瑜珈']);
      await expect(section.getByRole('link', { name: '所有課程' })).toHaveAttribute('href', /courses\/$/);
    });

    test('師資：四位已發布教練，每位有看教練與專長；蕭蕭不出現', async ({ page }) => {
      await page.goto('./');
      const section = page.locator('section#coaches[data-beat="coaches"]');
      await expect(section.getByRole('heading', { level: 2 })).toHaveText('師資');
      await expect(page.locator('#coaches [data-coach] h3')).toHaveText(COACHES.map((c) => c.name));
      await expect(page.getByText('蕭蕭')).toHaveCount(0);
      for (const coach of COACHES) {
        const card = page.locator(`#coaches [data-coach="${coach.slug}"]`);
        await expect(card.getByRole('link', { name: '看教練' })).toHaveAttribute('href', new RegExp(`coaches/${coach.slug}/$`));
        await expect(card).toContainText(/專長：.+/);
      }
      // 專長是任教的已發布課程名。
      await expect(page.locator('#coaches [data-coach="chan"]')).toContainText('八極專修');
      await expect(page.locator('#coaches [data-coach="owen"]')).toContainText('巴西柔術');
    });

    test('收費課表：導引文案與三個連結，不含任何金額或時段', async ({ page, baseURL }) => {
      await page.goto('./');
      const section = page.locator('section#pricing[data-beat="pricing"]');
      await expect(section.getByRole('heading', { level: 2 })).toHaveText('收費與課表');
      const base = basePath(baseURL);
      await expect(section.getByRole('link', { name: '看收費' })).toHaveAttribute('href', `${base}pricing/`);
      await expect(section.getByRole('link', { name: '看課表' })).toHaveAttribute('href', `${base}schedule/`);
      await expect(section.getByRole('link', { name: '看場地' })).toHaveAttribute('href', `${base}facility/`);
      expect(await section.innerText()).not.toMatch(/NT|\$|元|\d{3,}/);
    });

    test('預約：按鈕開啟 LINE 視窗，Esc 關閉', async ({ page }) => {
      await page.goto('./');
      const booking = page.locator('section#booking[data-beat="booking"]');
      await expect(booking.getByRole('heading', { level: 2 })).toHaveText('預約');
      const button = booking.locator('a.button.button--solid');
      await expect(button).toHaveText('預約體驗');
      await expect(button).toHaveAttribute('href', '#line');
      await expect(button).toHaveAttribute('data-line-open', '');
      await expect(booking.locator('.crest-hit')).toHaveCount(1);
      await expect(booking.locator('.booking__seal'), '按鈕旁的小朱印（純裝飾）').toHaveCount(1);
      await expect(booking.locator('.booking__seal')).toHaveAttribute('aria-hidden', 'true');

      await button.scrollIntoViewIfNeeded();
      await button.click();
      await expect(page.locator('#line-dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#line-dialog')).toBeHidden();
    });

    test('沒有水平外溢（大人、小孩）；html 沒有強制捲動吸附', async ({ page }) => {
      await page.goto('./');
      expect(await overflow(page), '大人').toBeLessThanOrEqual(0);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollSnapType)).toBe('none');
      await page.locator('#courses').scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: '小孩' }).click();
      expect(await overflow(page), '小孩').toBeLessThanOrEqual(0);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      expect(await overflow(page), '小孩（頁尾）').toBeLessThanOrEqual(0);
    });

    test('標題層級不跳級（h1 → h2 → h3）', async ({ page }) => {
      await page.goto('./');
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
      expect(skipped).toEqual([]);
    });
  });
}

test.describe('大人｜小孩切換', () => {
  test('預設顯示大人（拳 → 格鬥 → 兵器），小孩那組整個隱藏；首頁恰有一組切換鈕', async ({ page }) => {
    await page.goto('./');
    await expect(homeTitles(page, 'adult')).toHaveText(HOME_ADULT_ORDER);
    await expect(homeTitles(page, 'adult').first()).toBeVisible();
    for (const title of await homeTitles(page, 'kid').all()) await expect(title).toBeHidden();
    await expect(page.getByRole('button', { name: '大人' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '小孩' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: '小孩' })).toHaveCount(1);
    await expect(page.locator('[data-audience-option]')).toHaveCount(2);
  });

  test('切到小孩後標題與連結一起換，重新整理後保留，切回大人也保留', async ({ page, baseURL }) => {
    await page.goto('./');
    await page.locator('#courses').scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: '小孩' }).click();

    await expect(homeTitles(page, 'kid')).toHaveText(HOME_KID_ORDER);
    for (const title of await homeTitles(page, 'adult').all()) await expect(title).toBeHidden();
    const hrefs = await page
      .locator('#courses [data-audience-panel="kid"] article[data-course] a[href*="courses/"]')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(hrefs).toEqual(HOME_KID_SLUGS.map((slug) => `${basePath(baseURL)}courses/${slug}/`));

    await page.reload();
    await expect(page.getByRole('button', { name: '小孩' })).toHaveAttribute('aria-pressed', 'true');
    await expect(homeTitles(page, 'kid').first()).toBeVisible();
    for (const title of await homeTitles(page, 'adult').all()) await expect(title).toBeHidden();

    await page.getByRole('button', { name: '大人' }).click();
    await expect(homeTitles(page, 'adult').first()).toBeVisible();
    await page.reload();
    for (const title of await homeTitles(page, 'kid').all()) await expect(title).toBeHidden();
  });

  test('localStorage 裡的值不合法時回到預設的大人', async ({ page }) => {
    await page.addInitScript((key) => window.localStorage.setItem(key, 'grown-up'), AUDIENCE_STORAGE_KEY);
    await page.goto('./');
    await expect(homeTitles(page, 'adult').first()).toBeVisible();
    for (const title of await homeTitles(page, 'kid').all()) await expect(title).toBeHidden();
  });
});

test.describe('段落跳轉', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('桌機：右緣 5 個連結，點「預約」後預約段進入視窗', async ({ page }) => {
    await page.goto('./');
    const rail = page.getByRole('navigation', { name: '首頁段落' });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('link')).toHaveText(['開場', '課程', '師資', '收費課表', '預約']);
    await rail.getByRole('link', { name: '預約' }).click();
    await expect(page.locator('#booking')).toBeInViewport();

    await rail.getByRole('link', { name: '師資' }).click();
    await expect(page.locator('#coaches')).toBeInViewport();
  });
});

test.describe('段落跳轉：手機', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('手機不顯示段落導覽（選單已有頁面連結）', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('nav.home-rail')).toBeHidden();
  });

  test('先捲到課程段，切換小孩期間沒有水平外溢', async ({ page }) => {
    await page.goto('./');
    await page.locator('#courses').scrollIntoViewIfNeeded();
    expect(await overflow(page), '大人').toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: '小孩' }).click();
    for (let i = 0; i < 6; i++) {
      expect(await overflow(page), `小孩 #${i}`).toBeLessThanOrEqual(0);
      await page.waitForTimeout(150);
    }
    await page.getByRole('button', { name: '大人' }).click();
    for (let i = 0; i < 4; i++) {
      expect(await overflow(page), `大人 #${i}`).toBeLessThanOrEqual(0);
      await page.waitForTimeout(150);
    }
  });

  test('記住小孩後重新整理也沒有水平外溢', async ({ page }) => {
    await page.addInitScript((key) => window.localStorage.setItem(key, 'kid'), AUDIENCE_STORAGE_KEY);
    await page.goto('./');
    for (let i = 0; i < 6; i++) {
      expect(await overflow(page), `#${i}`).toBeLessThanOrEqual(0);
      await page.waitForTimeout(150);
    }
  });
});

test.describe('課程段版面', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('切換鈕在課程段期間黏在畫面上方，離開課程段就收起；切換不改變頁面長度', async ({ page }) => {
    await page.goto('./');
    const toggle = page.locator('.audience-switch__inner');
    const heightBefore = await page.evaluate(() => document.documentElement.scrollHeight);

    await page.locator('[data-beat="combat-a"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(toggle).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: '小孩' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(heightBefore);

    await page.locator('#booking').scrollIntoViewIfNeeded();
    await expect(toggle).not.toBeInViewport();
  });

  test('每個課程 beat 的高度等於外框內可視高度', async ({ page }) => {
    await page.goto('./');
    const heights = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('#courses [data-beat]')).map((el) => ({
        id: el.dataset.beat,
        height: Math.round(el.getBoundingClientRect().height),
      })),
    );
    expect(heights.map((h) => h.id)).toEqual(['fist', 'combat-a', 'combat-b', 'weapon-a', 'weapon-b', 'weapon-c']);
    for (const { id, height } of heights) expect(height, id).toBeGreaterThanOrEqual(900 - 72 - 56 - 1);
  });
});

test.describe('減少動態', () => {
  test.use({ reducedMotion: 'reduce' });

  test('h1、各 h2 可見，沒有被樣式藏住的內容；兩組課程在小孩切換後可見', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const headings = page.locator('main h2');
    expect(await headings.count()).toBeGreaterThanOrEqual(5);
    for (const heading of await headings.all()) await expect(heading).toBeVisible();
    for (const title of await homeTitles(page, 'adult').all()) await expect(title).toBeVisible();

    expect(await hiddenByStyle(page, 'main')).toEqual([]);

    await page.getByRole('button', { name: '小孩' }).click();
    for (const title of await homeTitles(page, 'kid').all()) await expect(title).toBeVisible();
    expect(await hiddenByStyle(page, 'main')).toEqual([]);
  });
});
