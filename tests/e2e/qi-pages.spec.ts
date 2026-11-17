import { expect, test } from './fixtures';
import { boxOf, brightBox, overlapOfBox, trackTransfers } from './helpers';
import { backdropBox, draws, expectClean, extent, html, KEY_TEXT, open, OVERLAP_LIMIT, pose, QUERY, READY, settledExtent, watch } from './qi-page-helpers';

// 非首頁的頁面光點層（Task 26，使用者要求「現在所有的特殊效果基本都在首頁，其他頁面也應該要做」）：
//   - 光點放在哪：桌機寬螢幕（≥ 80rem 且寬高比 ≥ 4:3）在內容右側欄（內容讓出位置），其他在頁首上方的一條；光點的外框與主要文字重疊 ≤ 5%。
//   - 放什麼：課程內頁依課程的分類與對象（拳→定軸、格鬥→撐捶、兵器→劍、兒童課 kid-*、其他→others）；課程總覽是氣流，滑過或聚焦課程卡才聚成該課的姿勢。
//   - 首屏先是文字與靜態圖，引擎接手後交叉淡化；退回靜態圖（減少動態、沒有 WebGL、context 遺失、離開頁面）；3D 兵器架進入視窗時頁首光點淡出並暫停。
// headless 的 WebGL 是軟體繪製：一律 ?qi-tier=min&qi-debug=1；只用 page.*，不碰 OS 層級的滑鼠鍵盤。
test.describe.configure({ mode: 'default', timeout: 120_000 });
test.afterEach(({ page }) => expectClean(page));

/** 課程頁的對應（需求：拳→dingzhou、格鬥→chengchui、兵器→jian、兒童課 kid-*、其他→others）。 */
const COURSE_POSES: [slug: string, pose: string][] = [
  ['bajiquan', 'dingzhou'],
  ['sanshou', 'chengchui'],
  ['chinese-weapons', 'jian'],
  ['kids-martial-arts', 'kid-wushu'],
  ['kids-self-defense', 'kid-defense-a'],
  ['kids-weapons', 'kid-weapon'],
  ['bjj', 'others'],
  ['core-yoga', 'others'],
];

test.describe('課程內頁：姿勢對應', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const [slug, expected] of COURSE_POSES) {
    test(`${slug} → ${expected}`, async ({ page }) => {
      await open(page, `./courses/${slug}/`);
      await expect(html(page)).toHaveAttribute('data-qi-pose', expected);
      expect(await pose(page)).toBe(expected);
      await expect(html(page)).toHaveAttribute('data-qi-page', 'course');
      await expect(page.locator('[data-qi-backdrop]')).toHaveAttribute('data-qi-initial-pose', expected);
    });
  }
});

for (const device of [
  { name: '桌機 1440×900', viewport: { width: 1440, height: 900 }, rail: true },
  { name: '桌機 1920×1080', viewport: { width: 1920, height: 1080 }, rail: true },
  { name: '手機 390×844', viewport: { width: 390, height: 844 }, rail: false },
  { name: '平板橫向 1024×768（沒有右側欄）', viewport: { width: 1024, height: 768 }, rail: false },
]) {
  test.describe(`課程內頁：版面與幾何（${device.name}）`, () => {
    test.use({ viewport: device.viewport });

    for (const slug of ['bajiquan', 'chinese-weapons', 'kids-martial-arts', 'bjj']) {
      test(`${slug}：${device.rail ? '光點在右側欄、內容讓出位置' : '光點在頁首上方的一條'}；外框與主要文字重疊 ≤ 5%`, async ({ page }) => {
        await open(page, `./courses/${slug}/`);
        const backdrop = await backdropBox(page);
        const main = (await boxOf(page, 'main'))[0]!;
        if (device.rail) {
          expect(main.right, '內容欄讓出右側欄').toBeLessThanOrEqual(backdrop.left + 1);
          expect(backdrop.right, '右側欄貼著視窗右緣（外框內）').toBeGreaterThan(device.viewport.width - 40);
        } else {
          expect(backdrop.left, "貼著外框內緣（外框 inset 最多 14px）").toBeLessThanOrEqual(16);
          expect(backdrop.right).toBeGreaterThanOrEqual(device.viewport.width - 16);
          expect(backdrop.bottom - backdrop.top, '頁首上方的一條不到視窗高的一半').toBeLessThan(device.viewport.height / 2);
          const h1 = (await boxOf(page, 'h1'))[0]!;
          expect(h1.top, 'h1 在光點那一條的下面').toBeGreaterThanOrEqual(backdrop.bottom - 2);
        }

        const shape = await settledExtent(page);
        expect(shape.right - shape.left, '有光點').toBeGreaterThan(40);
        const slack = 3;
        expect(shape.left).toBeGreaterThanOrEqual(backdrop.left - slack);
        expect(shape.right).toBeLessThanOrEqual(backdrop.right + slack);
        expect(shape.top).toBeGreaterThanOrEqual(backdrop.top - slack);
        expect(shape.bottom).toBeLessThanOrEqual(backdrop.bottom + slack);

        const worst: string[] = [];
        for (const box of await boxOf(page, KEY_TEXT)) {
          const fraction = overlapOfBox(shape, box);
          if (fraction > OVERLAP_LIMIT) worst.push(`${(fraction * 100).toFixed(1)}%`);
        }
        expect(worst, '光點外框與主要文字的重疊').toEqual([]);
      });
    }
  });
}

test.describe('課程內頁：首屏的靜態圖', () => {
  for (const device of [
    { name: '桌機 1440×900', viewport: { width: 1440, height: 900 } },
    { name: '手機 390×844', viewport: { width: 390, height: 844 } },
  ]) {
    test(`減少動態（${device.name}）：靜態圖在光點層裡、外框與主要文字重疊 ≤ 5%；不載入 three 與引擎`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: device.viewport, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const transfers = trackTransfers(page);
      await page.goto('./courses/bajiquan/');
      await expect(html(page)).toHaveClass(/qi-static/);
      const still = page.locator('.qi-still');
      await expect(still).toBeVisible();
      await expect(still).toHaveCSS('opacity', '1');
      await expect(page.locator('canvas[data-qi-canvas]')).toBeHidden();
      await page.evaluate(() => document.querySelector<HTMLImageElement>('.qi-still')!.decode());

      const backdrop = await backdropBox(page);
      const bright = (await brightBox(page, '.qi-still'))!;
      expect(bright, '靜態圖有光點').not.toBeNull();
      expect(bright.left).toBeGreaterThanOrEqual(backdrop.left - 3);
      expect(bright.right).toBeLessThanOrEqual(backdrop.right + 3);
      for (const box of await boxOf(page, KEY_TEXT)) expect(overlapOfBox(bright, box)).toBeLessThanOrEqual(OVERLAP_LIMIT);

      expect(await page.locator('h1').count()).toBe(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('八極專修');
      await page.waitForTimeout(500);
      expect(transfers.filter((t) => /\/three\.module[^/]*\.js(\?|$)/.test(t.url) || /\/qi-stage[^/]*\.js(\?|$)/.test(t.url) || /\.bin(\?|$)/.test(t.url)).map((t) => t.url), '靜態圖模式不載入引擎').toEqual([]);
      await context.close();
    });
  }
});

test.describe('課程內頁：沒有 JavaScript', () => {
  for (const device of [
    { name: '桌機 1440×900', viewport: { width: 1440, height: 900 } },
    { name: '手機 390×844', viewport: { width: 390, height: 844 } },
  ]) {
    test(`（${device.name}）靜態圖可見、畫布不佔位、內容完整`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: device.viewport, javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto('./courses/bajiquan/');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('八極專修');
      await expect(page.locator('.qi-still')).toBeVisible();
      await expect(page.locator('.qi-still')).toHaveCSS('opacity', '1');
      await expect(page.locator('canvas[data-qi-canvas]')).toBeHidden();
      await expect(page.getByRole('link', { name: '返回課程總覽' })).toBeVisible();
      await context.close();
    });
  }
});

test.describe('課程內頁：退回靜態圖與無障礙', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('canvas 與整個光點層 aria-hidden、不可聚焦；h1 恰一個；Tab 序裡沒有光點層的東西；沒有入館閘門', async ({ page }) => {
    await open(page, './courses/bajiquan/');
    await expect(page.locator('[data-qi-backdrop]')).toHaveAttribute('aria-hidden', 'true');
    expect(await page.locator('[data-qi-backdrop] a, [data-qi-backdrop] button, [data-qi-backdrop] [tabindex]').count()).toBe(0);
    expect(await page.locator('canvas[data-qi-canvas]').evaluate((el) => (el as HTMLCanvasElement).tabIndex)).toBe(-1);
    expect(await page.locator('h1').count()).toBe(1);
    await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);
    await expect(page.locator('[data-gate-dialog]')).toHaveCount(0);
    // canvas 不接收指標事件
    expect(await page.locator('canvas[data-qi-canvas]').evaluate((el) => getComputedStyle(el.closest('[data-qi-backdrop]')!).pointerEvents)).toBe('none');
    // 光點層在內容底下
    expect(await page.locator('[data-qi-backdrop]').evaluate((el) => getComputedStyle(el).zIndex)).toBe('-1');
  });

  test('沒有 WebGL2：靜態圖、不報錯、DOM 不變', async ({ page }) => {
    watch(page);
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) return null;
        return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await page.goto(`./courses/bajiquan/${QUERY}`);
    await expect(html(page)).toHaveClass(/qi-static/);
    await expect(page.locator('.qi-still')).toBeVisible();
    await expect(page.locator('canvas[data-qi-canvas]')).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('八極專修');
  });

  test('WebGL context 中途遺失（RF5）：退回靜態圖、不報錯、DOM 內容不變', async ({ page }) => {
    await open(page, './courses/bajiquan/');
    const before = await page.locator('main').innerHTML();
    await page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]')!.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext());
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'static', { timeout: 5000 });
    await expect(html(page)).toHaveAttribute('data-qi-reason', 'context-lost');
    await expect(page.locator('.qi-still')).toHaveCSS('opacity', '1');
    await expect(page.locator('canvas[data-qi-canvas]')).toBeHidden();
    // 光點層自己的節點會因為屬性改變而不同；內容（backdrop 之外）一個字都沒變
    const strip = (s: string) => s.replace(/<div class="qi-backdrop"[\s\S]*?<\/canvas>(?:<div class="qi-slot"[^>]*><\/div>)?<\/div>/, '');
    expect(strip(await page.locator('main').innerHTML())).toBe(strip(before));
  });

  test('pagehide（非 bfcache）：釋放引擎與 GL context，頁面是靜態圖', async ({ page }) => {
    await open(page, './courses/bajiquan/');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'static');
    await expect(html(page)).toHaveAttribute('data-qi-reason', 'page-hide');
    expect(await page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]')!.getContext('webgl2')?.isContextLost())).toBe(true);
  });

  test('引擎的 chunk 載不到：退回靜態圖，不報 pageerror', async ({ page }) => {
    const log = watch(page);
    log.allowErrors.push(/Failed to load resource|net::ERR/);
    await page.route(/qi-stage[^/]*\.js(\?.*)?$/, (route) => route.abort());
    await page.goto(`./courses/bajiquan/${QUERY}`);
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'static', { timeout: 20_000 });
    await expect(html(page)).toHaveAttribute('data-qi-reason', 'init-failed');
    await expect(page.locator('.qi-still')).toHaveCSS('opacity', '1');
    log.warnings.length = 0; // The qi engine could not start; showing still images.
  });
});

test.describe('課程內頁：3D 兵器架進入視窗時頁首光點淡出並暫停', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('chinese-weapons：兵器架在視窗內 → 暫停（不再繪製）、畫布透明；回到頁首 → 恢復', async ({ page }) => {
    await open(page, './courses/chinese-weapons/');
    const backdrop = page.locator('[data-qi-backdrop]');
    await expect(backdrop).not.toHaveAttribute('data-qi-paused', /.*/);
    const running = await draws(page);
    await expect.poll(() => draws(page), { message: '頁首：持續繪製' }).toBeGreaterThan(running);

    await page.locator('[data-sub-items]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(backdrop).toHaveAttribute('data-qi-paused', 'rack');
    await expect(page.locator('canvas[data-qi-canvas]')).toHaveCSS('opacity', '0');
    const stopped = await draws(page);
    await page.waitForTimeout(600);
    expect(await draws(page), '暫停：不再繪製').toBe(stopped);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(backdrop).not.toHaveAttribute('data-qi-paused', /.*/);
    await expect(page.locator('canvas[data-qi-canvas]')).toHaveCSS('opacity', '1');
    await expect.poll(() => draws(page), { message: '回到頁首：恢復繪製' }).toBeGreaterThan(stopped);
  });

  test('沒有 3D 兵器架的課程頁不會因此暫停', async ({ page }) => {
    await open(page, './courses/bajiquan/');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('[data-qi-backdrop]')).not.toHaveAttribute('data-qi-paused', 'rack');
  });
});

test.describe('課程內頁（手機）：頁首上方的一條捲出視窗就暫停', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('捲到頁尾：暫停繪製；捲回頁首：恢復', async ({ page }) => {
    await open(page, './courses/bajiquan/');
    const backdrop = page.locator('[data-qi-backdrop]');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(backdrop).toHaveAttribute('data-qi-paused', 'offscreen');
    const stopped = await draws(page);
    await page.waitForTimeout(600);
    expect(await draws(page)).toBe(stopped);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(backdrop).not.toHaveAttribute('data-qi-paused', /.*/);
    await expect.poll(() => draws(page)).toBeGreaterThan(stopped);
  });
});

test.describe('課程總覽：氣流背景，滑過或聚焦課程卡聚成該課的姿勢', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('預設是氣流（flow）：整張畫布固定在視窗（低亮度背景）、內容右邊讓出右側欄', async ({ page }) => {
    await open(page, './courses/');
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'flow');
    expect(await pose(page)).toBe('flow');
    const backdrop = await backdropBox(page);
    expect(backdrop.right - backdrop.left, '整張畫布').toBeGreaterThan(1300);
    expect(await page.locator('[data-qi-backdrop]').evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
    const main = (await boxOf(page, 'main'))[0]!;
    const slot = (await boxOf(page, '[data-qi-slot]'))[0]!;
    expect(main.right, '內容欄讓出右側欄').toBeLessThanOrEqual(slot.left + 1);
    expect(await extent(page), '氣流全是低亮度的環境煙，沒有形體外框').toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  const EXPECTED_BY_TITLE: [title: string, pose: string][] = [
    ['中式兵器', 'jian'],
    ['八極專修', 'dingzhou'],
    ['散手技擊', 'chengchui'],
  ];

  for (const [title, expected] of EXPECTED_BY_TITLE) {
    test(`滑鼠移到「${title}」：光點聚成 ${expected}，聚在右側欄內、與卡片文字重疊 ≤ 5%；移開回到氣流`, async ({ page }) => {
      await open(page, './courses/');
      const card = page.locator('[data-audience-panel="adult"] .course-card', { hasText: title });
      await card.hover();
      await expect(html(page)).toHaveAttribute('data-qi-pose', expected, READY);
      expect(await pose(page)).toBe(expected);
      const shape = await settledExtent(page);
      const slot = (await boxOf(page, '[data-qi-slot]'))[0]!;
      expect(shape.left).toBeGreaterThanOrEqual(slot.left - 3);
      expect(shape.right).toBeLessThanOrEqual(slot.right + 3);
      for (const box of await boxOf(page, 'h1, h2, h3, .course-card, .lead, .audience-cards__controls')) expect(overlapOfBox(shape, box)).toBeLessThanOrEqual(OVERLAP_LIMIT);

      await page.mouse.move(5, 5); // 移到卡片外（page.mouse 是 in-process 的合成事件，不碰真的滑鼠）
      await expect(html(page)).toHaveAttribute('data-qi-pose', 'flow', READY);
      expect(await pose(page)).toBe('flow');
    });
  }

  test('鍵盤聚焦課程卡（Tab 到連結）也聚成姿勢，焦點離開回到氣流', async ({ page }) => {
    await open(page, './courses/');
    await page.locator('[data-audience-panel="adult"] .course-card', { hasText: '散手技擊' }).locator('a').focus();
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'chengchui', READY);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'flow', READY);
  });

  test('切到「小孩」：滑過兒童課程卡聚成 kid-*；「其他課程」卡聚成 others', async ({ page }) => {
    await open(page, './courses/');
    await page.getByRole('button', { name: '小孩' }).click();
    await page.locator('[data-audience-panel="kid"] .course-card', { hasText: '兒童武術' }).hover();
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'kid-wushu', READY);
    await page.locator('[data-audience-panel="kid"] .course-card', { hasText: '防身兵器' }).hover();
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'kid-weapon', READY);
    await page.locator('.other-grid .course-card', { hasText: '巴西柔術' }).scrollIntoViewIfNeeded();
    await page.locator('.other-grid .course-card', { hasText: '巴西柔術' }).hover();
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'others', READY);
  });

  test('課程卡的 data-qi-pose 與課程頁的姿勢一致（同一張對照表）', async ({ page }) => {
    await open(page, './courses/');
    const poses = await page.locator('.course-card').evaluateAll((cards) => cards.map((c) => [c.querySelector('h3')!.textContent, c.getAttribute('data-qi-pose')]));
    const byTitle = Object.fromEntries(poses as [string, string][]);
    expect(byTitle['中式兵器']).toBe('jian');
    expect(byTitle['八極專修']).toBe('dingzhou');
    expect(byTitle['散手技擊']).toBe('chengchui');
    expect(byTitle['兒童武術']).toBe('kid-wushu');
    expect(byTitle['防身格鬥']).toBe('kid-defense-a');
    expect(byTitle['防身兵器']).toBe('kid-weapon');
    expect(byTitle['巴西柔術']).toBe('others');
    expect(byTitle['核心瑜珈']).toBe('others');
  });
});

test.describe('課程總覽（手機）：只有氣流背景，沒有右側欄、不因滑過而聚形', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('沒有右側欄、內容沒有被讓出；點課程卡不改變姿勢（氣流）', async ({ page }) => {
    await open(page, './courses/');
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'flow');
    const main = (await boxOf(page, 'main'))[0]!;
    expect(main.right).toBeGreaterThan(380);
    await expect(page.locator('[data-qi-slot]')).toBeHidden();
    expect(await pose(page)).toBe('flow');
  });
});
