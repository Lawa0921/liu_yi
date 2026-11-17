import { expect, test } from './fixtures';
import { ADULT_COURSES, AUDIENCE_STORAGE_KEY, KID_COURSES, basePath, cardTitles } from './helpers';

const adultTitles = ADULT_COURSES.map((c) => c.title);
const kidTitles = KID_COURSES.map((c) => c.title);

// 首頁的切換（課名順序、連結、重新整理保留、非法值）在 home.spec.ts；這裡守課程總覽。
for (const path of ['./courses/']) {
  test.describe(`大人｜小孩切換 @ ${path}`, () => {
    test('預設顯示大人的三張卡片（兵器、拳術、格鬥）', async ({ page }) => {
      await page.goto(path);

      await expect(cardTitles(page, 'adult')).toHaveText(adultTitles);
      for (const card of await cardTitles(page, 'adult').all()) await expect(card).toBeVisible();
      for (const card of await cardTitles(page, 'kid').all()) await expect(card).toBeHidden();

      await expect(page.getByRole('button', { name: '大人' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: '小孩' })).toHaveAttribute('aria-pressed', 'false');
    });

    test('切到小孩後三張卡片的名稱與連結一起換，重新整理後保留', async ({ page, baseURL }) => {
      await page.goto(path);
      await page.getByRole('button', { name: '小孩' }).click();

      await expect(cardTitles(page, 'kid')).toHaveText(kidTitles);
      for (const card of await cardTitles(page, 'kid').all()) await expect(card).toBeVisible();
      for (const card of await cardTitles(page, 'adult').all()) await expect(card).toBeHidden();

      const hrefs = await page
        .locator('[data-audience-panel="kid"] .course-card a')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
      expect(hrefs).toEqual(KID_COURSES.map((c) => `${basePath(baseURL)}courses/${c.slug}/`));

      await page.reload();
      await expect(page.getByRole('button', { name: '小孩' })).toHaveAttribute('aria-pressed', 'true');
      for (const card of await cardTitles(page, 'kid').all()) await expect(card).toBeVisible();
      for (const card of await cardTitles(page, 'adult').all()) await expect(card).toBeHidden();

      await page.getByRole('button', { name: '大人' }).click();
      for (const card of await cardTitles(page, 'adult').all()) await expect(card).toBeVisible();
      await page.reload();
      for (const card of await cardTitles(page, 'kid').all()) await expect(card).toBeHidden();
    });
  });
}

test('選擇在首頁與課程總覽之間沿用；首頁恰有一組切換鈕', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: '小孩' })).toHaveCount(1);
  await page.getByRole('button', { name: '小孩' }).click();
  await page.goto('./courses/');
  await expect(page.getByRole('button', { name: '小孩' })).toHaveAttribute('aria-pressed', 'true');
  for (const card of await cardTitles(page, 'kid').all()) await expect(card).toBeVisible();
});

test('localStorage 裡的值不合法時回到預設的大人（課程總覽；首頁版本在 home.spec.ts）', async ({ page }) => {
  await page.addInitScript((key) => window.localStorage.setItem(key, 'grown-up'), AUDIENCE_STORAGE_KEY);
  await page.goto('./courses/');
  for (const card of await cardTitles(page, 'adult').all()) await expect(card).toBeVisible();
  for (const card of await cardTitles(page, 'kid').all()) await expect(card).toBeHidden();
});
