import { expect, test } from './fixtures';
import { ADULT_COURSES, COACHES, KID_COURSES, OTHER_COURSES, UNPUBLISHED_COURSE_SLUGS } from './helpers';

// 六門主課有站內影片，放在首屏右側（行為見 course-video.spec.ts）；其他課程沒有影片，就沒有影片區。
for (const course of [...ADULT_COURSES, ...KID_COURSES]) {
  test(`課程頁 ${course.slug}：有標題與內文`, async ({ page }) => {
    const response = await page.goto(`./courses/${course.slug}/`);
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(course.title);
    await expect(page.locator('[data-course-body]')).not.toBeEmpty();
    await expect(page.getByRole('link', { name: '返回課程總覽' })).toBeVisible();
  });
}

for (const course of OTHER_COURSES) {
  test(`課程頁 ${course.slug}：有標題與內文，沒有影片所以沒有影片區`, async ({ page }) => {
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

// 業主要求的版面順序（2026-11-20）：課程名稱＋右側（有影片的課是影片）→ 課程文字 → 課程照片 → 練什麼 → 授課教練 → 頁尾按鈕。
test.describe('有影片的課程頁：版面順序', () => {
  for (const course of [...ADULT_COURSES, ...KID_COURSES]) {
    test(`${course.slug}：首屏影片 → 內文 → 照片 → 練什麼 → 教練 → 頁尾`, async ({ page }) => {
      await page.goto(`./courses/${course.slug}/`);
      const order = await page.evaluate(() => {
        const pick = (selector: string) => document.querySelector(selector);
        const nodes = [
          ['hero-video', pick('.course-head [data-hero-video]')],
          ['body', pick('[data-course-body]')],
          ['photos', pick('[data-course-photos]')],
          ['sub-items', pick('[data-sub-items]')],
          ['coaches', pick('.course-coaches')],
          ['links', pick('.course-links')],
        ] as const;
        const present = nodes.filter(([, el]) => el !== null) as unknown as [string, Element][];
        const sorted = [...present].sort(([, a], [, b]) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
        return { present: present.map(([name]) => name), sorted: sorted.map(([name]) => name) };
      });
      expect(order.present).toContain('hero-video');
      expect(order.present).toContain('body');
      expect(order.sorted).toEqual(order.present);
      // 首屏右側只有影片，沒有照片輪播或字牌。
      await expect(page.locator('.course-head [data-gallery], .course-head .course-head__plate')).toHaveCount(0);
    });
  }
});

test.describe('課程照片區', () => {
  test('防身兵器：首屏是影片，五張照片移到內文下方的「課程照片」區', async ({ page }) => {
    await page.goto('./courses/kids-weapons/');
    const photos = page.locator('[data-course-photos]');
    await expect(photos).toHaveCount(1);
    await expect(photos.getByRole('heading', { level: 2, name: '課程照片' })).toHaveCount(1);
    await expect(photos.locator('[data-gallery] img')).toHaveCount(5);
    await expect(photos.locator('[data-gallery-status]')).toHaveText('1 / 5');
  });

  test('兒童武術、防身格鬥的照片也都在照片區', async ({ page }) => {
    for (const [slug, count] of [
      ['kids-martial-arts', 2],
      ['kids-self-defense', 3],
    ] as const) {
      await page.goto(`./courses/${slug}/`);
      await expect(page.locator('[data-course-photos] [data-gallery] img'), slug).toHaveCount(count);
    }
  });

  test('八極專修、散手技擊唯一的照片是給課程卡用的影片截圖：內頁沒有照片區', async ({ page }) => {
    for (const slug of ['bajiquan', 'sanshou', 'chinese-weapons']) {
      await page.goto(`./courses/${slug}/`);
      await expect(page.locator('[data-course-photos]'), slug).toHaveCount(0);
      await expect(page.locator('[data-gallery]'), slug).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '課程照片' }), slug).toHaveCount(0);
    }
  });

  test('沒有影片的課（巴西柔術）：首屏仍是照片輪播，沒有影片也沒有另外的照片區', async ({ page }) => {
    await page.goto('./courses/bjj/');
    await expect(page.locator('.course-head [data-gallery] img')).toHaveCount(5);
    await expect(page.locator('[data-hero-video]')).toHaveCount(0);
    await expect(page.locator('[data-course-photos]')).toHaveCount(0);
  });

  test('沒有影片的課（核心瑜珈）：首屏照片輪播維持原樣', async ({ page }) => {
    await page.goto('./courses/core-yoga/');
    await expect(page.locator('.course-head [data-gallery] img')).toHaveCount(4);
    await expect(page.locator('[data-hero-video]')).toHaveCount(0);
    await expect(page.locator('[data-course-photos]')).toHaveCount(0);
  });
});

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
