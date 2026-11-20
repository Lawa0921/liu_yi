import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ADULT_COURSES, KID_COURSES, OTHER_COURSES, basePath } from './helpers';

// 六門主課的課程簡介影片：課程卡右下角的播放鈕 → 站內影片視窗；課程內頁的「課程影片」區塊。
// 重點：完整、原比例、有聲、由訪客主動播放；按下播放前不下載任何影片位元組。

const VIDEO_SIZE: Record<string, { width: number; height: number }> = {
  'chinese-weapons': { width: 1280, height: 720 },
  bajiquan: { width: 720, height: 720 },
  sanshou: { width: 1280, height: 720 },
  'kids-weapons': { width: 720, height: 1280 },
  'kids-martial-arts': { width: 1280, height: 720 },
  'kids-self-defense': { width: 1280, height: 720 },
};

const RATIO_CASES = [
  { slug: 'sanshou', title: '散手技擊', audience: 'adult', shape: '橫式' },
  { slug: 'bajiquan', title: '八極專修', audience: 'adult', shape: '方形' },
  { slug: 'kids-weapons', title: '防身兵器', audience: 'kid', shape: '直式' },
] as const;

function trackMp4(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/\.mp4(\?|$)/.test(request.url())) requests.push(request.url());
  });
  return requests;
}

const panel = (page: Page, audience: 'adult' | 'kid') => page.locator(`[data-audience-panel="${audience}"]`);
const card = (page: Page, audience: 'adult' | 'kid', title: string) =>
  panel(page, audience).locator('.course-card').filter({ has: page.locator(`h3:text-is("${title}")`) });

async function openCourses(page: Page, audience: 'adult' | 'kid') {
  await page.goto('./courses/');
  if (audience === 'kid') await page.getByRole('button', { name: '小孩' }).click();
}

async function openDialog(page: Page, audience: 'adult' | 'kid', title: string) {
  const play = card(page, audience, title).getByRole('link', { name: `播放${title}課程影片` });
  await play.scrollIntoViewIfNeeded();
  await play.click();
  const dialog = page.locator('#course-video-dialog');
  await expect(dialog).toBeVisible();
  return { play, dialog, video: dialog.locator('video') };
}

test.describe('課程總覽：課程卡的播放鈕', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('大人與小孩兩組各三張卡都有播放鈕；播放鈕是卡片連結的兄弟節點，不在連結裡', async ({ page, baseURL }) => {
    await page.goto('./courses/');
    for (const [audience, courses] of [
      ['adult', ADULT_COURSES],
      ['kid', KID_COURSES],
    ] as const) {
      for (const course of courses) {
        const play = card(page, audience, course.title).locator('[data-course-video]');
        await expect(play, `${course.title} 有播放鈕`).toHaveCount(1);
        await expect(play).toHaveAttribute('aria-label', `播放${course.title}課程影片`);
        await expect(play).toHaveAttribute('href', `${basePath(baseURL)}videos/${course.slug}.mp4`);
        const structure = await play.evaluate((el) => ({
          insideLink: el.closest('.course-card__link') !== null,
          nestedAnchor: (el.parentElement?.closest('a') ?? null) !== null,
          siblingOfLink: [...(el.parentElement?.children ?? [])].some((child) => child.classList.contains('course-card__link')),
        }));
        expect(structure, course.title).toEqual({ insideLink: false, nestedAnchor: false, siblingOfLink: true });
      }
    }
    // 其他課程沒有影片，就沒有播放鈕。
    const others = page.locator('section', { has: page.getByRole('heading', { name: '其他課程' }) });
    await expect(others.locator('[data-course-video]')).toHaveCount(0);
  });

  test('播放鈕在圖片區右下角，觸控目標至少 44×44，不蓋到輪播刻度', async ({ page }) => {
    await openCourses(page, 'kid');
    for (const course of KID_COURSES) {
      const host = card(page, 'kid', course.title);
      await host.scrollIntoViewIfNeeded();
      const play = await host.locator('[data-course-video]').boundingBox();
      const media = await host.locator('.course-card__media, .course-card__plate').boundingBox();
      expect(play && media, course.title).toBeTruthy();
      expect(play!.width).toBeGreaterThanOrEqual(44);
      expect(play!.height).toBeGreaterThanOrEqual(44);
      // 整顆在圖片區內、靠右下。
      expect(play!.x).toBeGreaterThanOrEqual(media!.x);
      expect(play!.y).toBeGreaterThanOrEqual(media!.y);
      expect(play!.x + play!.width).toBeLessThanOrEqual(media!.x + media!.width + 0.5);
      expect(play!.y + play!.height).toBeLessThanOrEqual(media!.y + media!.height + 0.5);
      expect(play!.x + play!.width / 2).toBeGreaterThan(media!.x + media!.width / 2);
      expect(play!.y + play!.height / 2).toBeGreaterThan(media!.y + media!.height / 2);
      const pips = host.locator('.course-card__pips');
      if (await pips.count()) {
        const box = (await pips.boundingBox())!;
        const overlap = box.x < play!.x + play!.width && play!.x < box.x + box.width && box.y < play!.y + play!.height && play!.y < box.y + box.height;
        expect(overlap, `${course.title} 的播放鈕不蓋到刻度`).toBe(false);
      }
    }
  });

  test('點播放鈕：不換頁，視窗打開並播該課的 mp4；Esc 關閉後暫停、釋放來源、焦點回到播放鈕', async ({ page, baseURL }) => {
    await openCourses(page, 'adult');
    const url = page.url();
    const { play, dialog, video } = await openDialog(page, 'adult', '八極專修');
    expect(page.url()).toBe(url);
    await expect(video).toHaveAttribute('src', `${basePath(baseURL)}videos/bajiquan.mp4`);
    await expect(video).toHaveAttribute('poster', /\.(webp|jpe?g|avif)$/);
    await expect(video).toHaveAttribute('preload', 'none');
    expect(await video.evaluate((el: HTMLVideoElement) => el.controls && el.playsInline && !el.muted)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // dialog 的 close 事件在隱藏之後才非同步觸發（腳本在那裡釋放來源），所以要等，不能隱藏後立刻讀。
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => ({ paused: el.paused, src: el.getAttribute('src') }))).toEqual({ paused: true, src: null });
    await expect(play).toBeFocused();
  });

  test('關閉鈕關閉；點背景也關閉；焦點都回到播放鈕', async ({ page }) => {
    await openCourses(page, 'kid');
    const { play, dialog, video } = await openDialog(page, 'kid', '防身格鬥');
    await expect(video).toHaveAttribute('src', /\/videos\/kids-self-defense\.mp4$/);
    await dialog.getByRole('button', { name: '關閉' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused && !el.hasAttribute('src'))).toBe(true);
    await expect(play).toBeFocused();

    await play.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(5, 5); // 左上角是視窗的留白（背景）
    await expect(dialog).toBeHidden();
    await expect(play).toBeFocused();
  });

  test('另一張卡按播放就換成那一門的影片（一頁一個視窗）', async ({ page }) => {
    await openCourses(page, 'adult');
    await expect(page.locator('dialog#course-video-dialog')).toHaveCount(1);
    const first = await openDialog(page, 'adult', '散手技擊');
    await expect(first.video).toHaveAttribute('src', /\/videos\/sanshou\.mp4$/);
    await page.keyboard.press('Escape');
    const second = await openDialog(page, 'adult', '中式兵器');
    await expect(second.video).toHaveAttribute('src', /\/videos\/chinese-weapons\.mp4$/);
  });

  for (const ratio of RATIO_CASES) {
    test(`視窗裡的影片是原比例（${ratio.shape}：${ratio.slug}，誤差 2% 內）`, async ({ page }) => {
      await openCourses(page, ratio.audience);
      const { video } = await openDialog(page, ratio.audience, ratio.title);
      const box = (await video.boundingBox())!;
      const { width, height } = VIDEO_SIZE[ratio.slug]!;
      expect(Math.abs(box.width / box.height - width / height) / (width / height)).toBeLessThan(0.02);
    });
  }

  test('點卡片標題仍會進課程內頁', async ({ page }) => {
    await openCourses(page, 'adult');
    await card(page, 'adult', '八極專修').locator('h3').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('八極專修');
  });

  test('按播放之前，課程總覽沒有任何 .mp4 請求', async ({ page }) => {
    const mp4 = trackMp4(page);
    await page.goto('./courses/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: '小孩' }).click();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForLoadState('networkidle');
    expect(mp4).toEqual([]);
    await expect(page.locator('#course-video-dialog video')).not.toHaveAttribute('src', /.+/);
  });
});

test.describe('減少動態', () => {
  test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });

  test('視窗不做進出場動畫，但影片照樣設定來源', async ({ page }) => {
    await openCourses(page, 'adult');
    const { dialog, video } = await openDialog(page, 'adult', '散手技擊');
    expect(await dialog.locator('.course-video-dialog__frame').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    await expect(video).toHaveAttribute('src', /\/videos\/sanshou\.mp4$/);
  });
});

for (const viewport of [
  { width: 360, height: 640 },
  { width: 1366, height: 650 },
]) {
  test.describe(`視窗大小 ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    for (const ratio of RATIO_CASES) {
      test(`${ratio.shape}影片與關閉鈕都完整在視窗內，沒有水平溢出`, async ({ page }) => {
        await openCourses(page, ratio.audience);
        const { dialog, video } = await openDialog(page, ratio.audience, ratio.title);
        const close = dialog.getByRole('button', { name: '關閉' });
        for (const [name, locator] of [
          ['影片', video],
          ['關閉鈕', close],
        ] as const) {
          const box = (await locator.boundingBox())!;
          expect(box.x, name).toBeGreaterThanOrEqual(0);
          expect(box.y, name).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, name).toBeLessThanOrEqual(viewport.width + 0.5);
          expect(box.y + box.height, name).toBeLessThanOrEqual(viewport.height + 0.5);
        }
        const { width, height } = VIDEO_SIZE[ratio.slug]!;
        const box = (await video.boundingBox())!;
        expect(Math.abs(box.width / box.height - width / height) / (width / height)).toBeLessThan(0.02);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      });
    }
  });
}

test.describe('沒有 JavaScript', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });

  test('播放鈕是直接指向 mp4 的連結', async ({ page, baseURL }) => {
    await page.goto('./courses/');
    for (const course of [...ADULT_COURSES, ...KID_COURSES]) {
      const play = page.getByRole('link', { name: `播放${course.title}課程影片` });
      await expect(play).toHaveAttribute('href', `${basePath(baseURL)}videos/${course.slug}.mp4`);
    }
    await expect(page.getByRole('link', { name: '播放八極專修課程影片' })).toBeVisible();
  });
});

test.describe('課程內頁的影片區', () => {
  for (const course of [...ADULT_COURSES, ...KID_COURSES]) {
    test(`${course.slug}：<video preload="none"> 有封面，原比例，載入與捲動時不請求 mp4`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const mp4 = trackMp4(page);
      await page.goto(`./courses/${course.slug}/`);
      const section = page.locator('[data-video-section]');
      await expect(section).toHaveCount(1);
      const video = section.locator('video');
      await expect(video).toHaveCount(1);
      const { width, height } = VIDEO_SIZE[course.slug]!;
      await expect(video).toHaveAttribute('preload', 'none');
      await expect(video).toHaveAttribute('controls', '');
      await expect(video).toHaveAttribute('playsinline', '');
      await expect(video).toHaveAttribute('src', `${basePath(baseURL)}videos/${course.slug}.mp4`);
      await expect(video).toHaveAttribute('poster', /\.(webp|jpe?g|avif)$/);
      await expect(video).toHaveAttribute('width', String(width));
      await expect(video).toHaveAttribute('height', String(height));

      await video.scrollIntoViewIfNeeded();
      const box = (await video.boundingBox())!;
      expect(Math.abs(box.width / box.height - width / height) / (width / height)).toBeLessThan(0.02);
      // 直式／方形不撐出一整屏。
      expect(box.height).toBeLessThan(900);

      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForLoadState('networkidle');
      expect(mp4).toEqual([]);
    });
  }

  for (const course of OTHER_COURSES) {
    test(`${course.slug}：沒有影片，就沒有影片區`, async ({ page }) => {
      await page.goto(`./courses/${course.slug}/`);
      await expect(page.locator('[data-video-section]')).toHaveCount(0);
      await expect(page.locator('video, iframe')).toHaveCount(0);
    });
  }
});
