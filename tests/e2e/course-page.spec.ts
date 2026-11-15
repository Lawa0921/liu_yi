import { expect, test } from '@playwright/test';
import { COACHES, PUBLISHED_COURSES, UNPUBLISHED_COURSE_SLUGS } from './helpers';

for (const course of PUBLISHED_COURSES) {
  test(`課程頁 ${course.slug}：有標題與內文，沒有影片網址所以沒有影片區`, async ({ page }) => {
    const response = await page.goto(`./courses/${course.slug}/`);
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(course.title);
    await expect(page.locator('[data-course-body]')).not.toBeEmpty();

    await expect(page.locator('[data-video-section]')).toHaveCount(0);
    await expect(page.locator('iframe, video')).toHaveCount(0);
    await expect(page.getByText('課程影片')).toHaveCount(0);

    await expect(page.getByRole('link', { name: '返回課程總覽' })).toBeVisible();
  });
}

for (const slug of UNPUBLISHED_COURSE_SLUGS) {
  test(`不發布的課程 ${slug} 沒有頁面`, async ({ page }) => {
    const response = await page.goto(`./courses/${slug}/`);
    expect(response?.status()).toBe(404);
  });
}

test('不發布的課程不出現在課程總覽與首頁', async ({ page }) => {
  for (const path of ['./', './courses/']) {
    await page.goto(path);
    for (const title of ['內家養身功', '街舞一對一', '青少年格鬥基礎班', '幼兒武術']) {
      await expect(page.getByText(title)).toHaveCount(0);
    }
  }
});

test('課程總覽下方有「其他課程」：巴西柔術、核心瑜珈', async ({ page }) => {
  await page.goto('./courses/');
  const other = page.locator('section', { has: page.getByRole('heading', { name: '其他課程' }) });
  await expect(other.locator('.course-card h3')).toHaveText(['巴西柔術', '核心瑜珈']);
});

test('兵器課程頁以區塊列出三種兵器', async ({ page }) => {
  for (const slug of ['chinese-weapons', 'kids-weapons']) {
    await page.goto(`./courses/${slug}/`);
    await expect(page.locator('[data-sub-items] h3')).toHaveText(['中國劍', '苗刀', '大槍']);
  }
});

test('課程頁列出授課教練並連到教練頁', async ({ page }) => {
  await page.goto('./courses/bajiquan/');
  await page.getByRole('link', { name: /詹前賢/ }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('詹前賢');
});

test('不發布的教練沒有頁面，也不在師資總覽', async ({ page }) => {
  const response = await page.goto('./coaches/xiaoxiao/');
  expect(response?.status()).toBe(404);

  await page.goto('./coaches/');
  await expect(page.locator('.coach-card h3')).toHaveText(COACHES.map((c) => new RegExp(c.name)));
  await expect(page.getByText('蕭蕭')).toHaveCount(0);
});

test('教練頁列出海報上的資歷', async ({ page }) => {
  await page.goto('./coaches/chan/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('詹前賢');
  await expect(page.getByText('輔仁大學國術社 指導教練')).toBeVisible();
  await expect(page.getByRole('link', { name: '八極專修' })).toBeVisible();
});
