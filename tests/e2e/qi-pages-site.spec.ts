import sharp from 'sharp';
import { expect, test, type Page } from './fixtures';
import { boxOf, brightBox, trackTransfers } from './helpers';
import { backdropBox, ensureWatch, expectClean, expectNoOverlap, extent, html, KEY_TEXT, meanError, open, pose, pulses, QUERY, READY, scatterOf, watch, type W } from './qi-page-helpers';

// 非首頁的頁面光點層（Task 26）之二：師資總覽、教練頁、場地、收費、課表、404（課程總覽與課程內頁在 qi-pages.spec.ts）。
//   - 師資、教練：抱拳的光點人形（salute）；師資總覽滑過或聚焦教練卡時脈動一下。
//   - 場地：院門（gate，既有的 bg-mid-gate 剪影走形體產線）；寬螢幕往下捲時由飄散聚成門，窄螢幕載入後慢慢聚成。
//   - 收費、課表：竹簡（scroll）低亮度背景，文字與海報圖浮在上面（文字區域亮度 > 100 的像素 ≤ 4%）。
//   - 404：光點散開、慢慢聚成落地的人形，掌風照樣吹得散。
// headless 的 WebGL 是軟體繪製：一律 ?qi-tier=min&qi-debug=1（量亮度的測試用真實的預設 tier）；要看時間的測試用假時鐘；只用 page.*，不碰 OS 層級的滑鼠鍵盤。
test.describe.configure({ mode: 'default', timeout: 120_000 });
test.afterEach(({ page }) => expectClean(page));

const T0 = new Date('2026-01-01T08:00:00');
const run = (page: Page, ms: number) => page.clock.runFor(ms);

/**
 * 開頁面（假時鐘：ready 之後立刻停住，之後只有 `run` 會推進）。
 * 不能 `pauseAt(T1)`（一小時後）：「慢慢聚成」是從引擎就緒起算的經過時間，跳過一小時就等於早已聚齊；改成只往前一點點。
 */
async function openClocked(page: Page, path: string, query: string = QUERY): Promise<void> {
  ensureWatch(page);
  await page.clock.install({ time: T0 });
  await page.goto(`${path}${query}`);
  await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 400)); // 太小會因為 evaluate 與 pauseAt 之間時間又走了而變成「過去」
}

const DEVICES = [
  { name: '桌機 1440×900', viewport: { width: 1440, height: 900 }, rail: true },
  { name: '桌機 1920×1080', viewport: { width: 1920, height: 1080 }, rail: true },
  { name: '手機 390×844', viewport: { width: 390, height: 844 }, rail: false },
  { name: '平板橫向 1024×768（沒有右側欄）', viewport: { width: 1024, height: 768 }, rail: false },
];

const RAIL_PAGES = [
  { name: '師資總覽', path: './coaches/', kind: 'coaches', pose: 'salute' },
  { name: '教練頁', path: './coaches/chan/', kind: 'coach', pose: 'salute' },
  { name: '場地', path: './facility/', kind: 'facility', pose: 'gate' },
  { name: '404', path: './no-such-page/', kind: 'lost', pose: 'land' },
] as const;

/** 404 的頁面本身是 404 狀態，瀏覽器會自己印一則請求失敗的 console.error。 */
const allow404 = (page: Page) => {
  const log = watch(page);
  log.allowErrors.push(/Failed to load resource: the server responded with a status of 404/);
};

for (const device of DEVICES) {
  test.describe(`光點層的版面與幾何（${device.name}）`, () => {
    test.use({ viewport: device.viewport });

    for (const target of RAIL_PAGES) {
      test(`${target.name}：${target.pose}；${device.rail ? '在右側欄、內容讓出位置' : '在頁首上方的一條'}；外框與主要文字重疊 ≤ 5%`, async ({ page }) => {
        if (target.kind === 'lost') allow404(page);
        await openClocked(page, target.path);
        await expect(html(page)).toHaveAttribute('data-qi-page', target.kind);

        const backdrop = await backdropBox(page);
        const main = (await boxOf(page, 'main'))[0]!;
        if (device.rail) {
          expect(main.right, '內容欄讓出右側欄').toBeLessThanOrEqual(backdrop.left + 1);
        } else {
          expect(backdrop.left).toBeLessThanOrEqual(16);
          expect(backdrop.right).toBeGreaterThanOrEqual(device.viewport.width - 16);
          expect(backdrop.bottom - backdrop.top, '頁首上方的一條不到視窗高的一半').toBeLessThan(device.viewport.height / 2);
          const h1 = (await boxOf(page, 'h1'))[0]!;
          expect(h1.top, 'h1 在光點那一條的下面（光點只在頁首上方）').toBeGreaterThanOrEqual(backdrop.bottom - 2);
        }

        // 形體聚合之後才量外框：404 與場地（窄螢幕）靠時間聚、場地（寬螢幕）靠捲動聚
        if (target.kind === 'lost' || (target.kind === 'facility' && !device.rail)) await run(page, 8000);
        if (target.kind === 'facility' && device.rail) await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await run(page, 3000);
        await expect(html(page)).toHaveAttribute('data-qi-pose', target.pose);
        const shape = await settledMeasured(page);
        expect(shape.right - shape.left, '有光點').toBeGreaterThan(40);
        const slack = 3;
        expect(shape.left).toBeGreaterThanOrEqual(backdrop.left - slack);
        expect(shape.right).toBeLessThanOrEqual(backdrop.right + slack);
        expect(shape.top).toBeGreaterThanOrEqual(backdrop.top - slack);
        expect(shape.bottom).toBeLessThanOrEqual(backdrop.bottom + slack);
        await expectNoOverlap(page, shape);
      });
    }
  });
}

/** 假時鐘下量外框：聚合靠 `run` 推進，這裡只讀回（`settledExtent` 用真實時間輪詢，假時鐘停住時不會動）。 */
async function settledMeasured(page: Page) {
  expect(await meanError(page), '光點聚成形體').toBeLessThan(0.05);
  const box = await extent(page);
  return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
}

// 頁尾在 main 外面、有不透明的底：捲到底時它蓋在固定的右側欄上。光點只用頁尾上緣之上的部分（槽被頁尾壓縮、光點隨頁尾升起而縮小上移），
// 不能被蓋住——短的頁面（場地、師資）捲到底時頁尾占了大半個視窗。
test.describe('頁尾蓋在右側欄上：光點只用頁尾上緣之上的部分，不被蓋住', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const target of [
    { name: '場地（捲到底才聚成門）', path: './facility/' },
    { name: '師資總覽（頁尾在首屏內）', path: './coaches/' },
    { name: '課程內頁', path: './courses/bajiquan/' },
  ]) {
    test(`${target.name}：捲到底，光點看得到、外框在頁尾上緣之上`, async ({ page }) => {
      await openClocked(page, target.path);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await run(page, 4000);
      const footer = (await boxOf(page, '.site-footer'))[0]!;
      const shape = await settledMeasured(page);
      expect(shape.bottom - shape.top, '光點看得到（不是縮到沒有）').toBeGreaterThan(80);
      expect(shape.bottom, '外框在頁尾上緣之上').toBeLessThanOrEqual(footer.top + 3);
      expect(shape.top, '外框在視窗內').toBeGreaterThanOrEqual(0);
    });
  }

  test('頁尾離開視窗（捲回頁首）：光點回到完整的右側欄', async ({ page }) => {
    await openClocked(page, './coaches/');
    const rail = await backdropBox(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await run(page, 2000);
    const squeezed = await extent(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await run(page, 2000);
    const full = await extent(page);
    expect(full.bottom - full.top, '捲回頁首：人形比被頁尾壓縮時大').toBeGreaterThan(squeezed.bottom - squeezed.top);
    expect(full.top).toBeGreaterThanOrEqual(rail.top - 3);
  });
});

test.describe('師資總覽：滑過或聚焦教練卡，光點脈動一下', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('滑鼠移到教練卡：pulseCount 遞增；鍵盤聚焦教練卡的連結也遞增；沒有碰教練卡就不脈動', async ({ page }) => {
    await open(page, './coaches/');
    expect(await pulses(page)).toBe(0);
    await page.locator('.coach-card').first().hover();
    await expect.poll(() => pulses(page)).toBeGreaterThanOrEqual(1);
    const afterHover = await pulses(page);
    await page.locator('.coach-card a').nth(2).focus();
    await expect.poll(() => pulses(page)).toBeGreaterThan(afterHover);
  });

  test('教練頁沒有脈動（只有師資總覽的卡片會）：頁面上的連結聚焦不影響光點', async ({ page }) => {
    await open(page, './coaches/chan/');
    await page.locator('.coach__courses a').first().focus();
    expect(await pulses(page)).toBe(0);
  });
});

test.describe('場地：院門由飄散聚成', () => {
  test.describe('桌機（右側欄）：往下捲時聚成', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('頁首的院門是散的（散開量高），往下捲聚齊（≤ 0.05），捲回頁首又散開；院門在右側欄內', async ({ page }) => {
      await openClocked(page, './facility/');
      await expect(html(page)).toHaveAttribute('data-qi-gather', 'scroll');
      await run(page, 1500);
      expect(await scatterOf(page), '頁首：散').toBeGreaterThanOrEqual(0.8);
      expect(await pose(page)).toBe('gate');

      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await run(page, 3000);
      expect(await scatterOf(page), '捲到底：聚齊').toBeLessThanOrEqual(0.05);
      expect(await meanError(page), '聚成院門').toBeLessThan(0.05);
      const rail = await backdropBox(page);
      const shape = await extent(page);
      expect(shape.left).toBeGreaterThanOrEqual(rail.left - 3);
      expect(shape.right).toBeLessThanOrEqual(rail.right + 3);
      expect((shape.right - shape.left) / (shape.bottom - shape.top), '院門的比例（寬約為高的 2.3 倍）').toBeGreaterThan(1.9);

      await page.evaluate(() => window.scrollTo(0, 0));
      await run(page, 500);
      expect(await scatterOf(page), '捲回頁首：又散').toBeGreaterThanOrEqual(0.8);
    });
  });

  test.describe('手機（頁首上方的一條）：載入後慢慢聚成', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('一開始是散的，單調地聚、5 秒左右聚齊', async ({ page }) => {
      await openClocked(page, './facility/');
      await expect(html(page)).toHaveAttribute('data-qi-gather', 'time');
      const samples: number[] = [];
      for (let i = 0; i < 8; i++) {
        samples.push(await scatterOf(page));
        await run(page, 1000);
      }
      expect(samples[0]!, '一開始散').toBeGreaterThan(0.5);
      for (let i = 1; i < samples.length; i++) expect(samples[i]!, `第 ${i} 秒`).toBeLessThanOrEqual(samples[i - 1]! + 1e-6);
      expect(samples.at(-1)!, '8 秒後聚齊').toBeLessThanOrEqual(0.05);
    });
  });

  test.describe('頁面太短捲不動（寬螢幕、視窗很高）：直接聚好，不會永遠散著', () => {
    test.use({ viewport: { width: 2600, height: 1900 } }); // 寬高比 1.37：有右側欄（≥ 4:3），頁面比視窗矮

    test('捲不動時散開量是 0', async ({ page }) => {
      await openClocked(page, './facility/');
      const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      expect(room, '前提：捲不動').toBeLessThanOrEqual(40);
      await run(page, 1000);
      expect(await scatterOf(page)).toBe(0);
    });
  });
});

test.describe('404：光點散開、慢慢聚成落地人形，掌風照樣吹得散', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('先是氣流（flow），形體到了才換成 land；散開量單調下降、約 5 秒後聚齊；聚成 land 的外框', async ({ page }) => {
    allow404(page);
    // 扣住 land 的形體檔：引擎先在氣流裡（形體要的時候還沒到），放行之後才聚成人形
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
      setTimeout(resolve, 60_000); // 保險：測試出錯也不要把請求一直扣著
    });
    await page.route(/land[^/]*\.bin(\?|$)/, async (route) => {
      await held;
      await route.continue();
    });
    await openClocked(page, './no-such-page/');
    await expect(html(page)).toHaveAttribute('data-qi-gather', 'time');
    await run(page, 1500);
    expect(await pose(page), '形體還沒到：氣流').toBe('flow');
    release();
    const samples: number[] = [];
    for (let i = 0; i < 9; i++) {
      samples.push(await scatterOf(page));
      await run(page, 1000);
    }
    expect(samples[0]!, '一開始散').toBeGreaterThan(0.5);
    for (let i = 1; i < samples.length; i++) expect(samples[i]!, `第 ${i} 秒`).toBeLessThanOrEqual(samples[i - 1]! + 1e-6);
    expect(samples.at(-1)!, '9 秒後聚齊').toBeLessThanOrEqual(0.05);
    await expect.poll(() => pose(page), { timeout: 30_000, message: '形體放行後換成 land' }).toBe('land');
    await run(page, 3000);
    expect(await meanError(page), '聚成人形').toBeLessThan(0.05);
  });

  test('掌風：聚好之後快速劃過人形，周圍的光點速度遠高於劃過前', async ({ page }) => {
    allow404(page);
    await openClocked(page, './no-such-page/');
    await run(page, 10_000);
    const center = await page.evaluate(() => {
      const box = (window as unknown as W).__qi.debug.extent();
      return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
    });
    const speed = (x: number, y: number) => page.evaluate(([cx, cy]) => (window as unknown as W).__qi.debug.speedNear(cx!, cy!, 80), [x, y] as const);
    const baseline = await speed(center.x, center.y);
    await page.mouse.move(center.x - 120, center.y);
    await run(page, 16);
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(center.x - 120 + i * 30, center.y);
      await run(page, 16);
    }
    expect(await speed(center.x, center.y)).toBeGreaterThan(Math.max(baseline, 1e-3) * 3);
  });
});

test.describe('收費與課表：竹簡低亮度背景，文字與海報圖浮在上面', () => {
  for (const target of [
    { name: '收費', path: './pricing/', kind: 'pricing' },
    { name: '課表', path: './schedule/', kind: 'schedule' },
  ]) {
    test.describe(`${target.name}`, () => {
      test('姿勢是 scroll；整張畫布固定在視窗、在內容底下；內容沒有被讓出任何位置', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await open(page, target.path);
        await expect(html(page)).toHaveAttribute('data-qi-pose', 'scroll');
        expect(await pose(page)).toBe('scroll');
        expect(await page.locator('[data-qi-backdrop]').evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
        const backdrop = await backdropBox(page);
        expect(backdrop.right - backdrop.left).toBeGreaterThan(1300);
        const main = (await boxOf(page, 'main'))[0]!;
        expect(main.right - main.left, '內容欄沒有讓出右側欄').toBeGreaterThan(1300);
        expect(await page.locator('h1').count()).toBe(1);
      });

      for (const device of [
        { name: '桌機 1440×900', viewport: { width: 1440, height: 900 } },
        { name: '手機 390×844', viewport: { width: 390, height: 844 } },
      ]) {
        test(`${device.name}：文字與海報圖區域裡亮度 > 100 的像素 ≤ 4%（引擎與靜態圖各量一次，真實的預設 tier）`, async ({ browser }) => {
          test.setTimeout(240_000);
          for (const mode of ['engine', 'still'] as const) {
            const context = await browser.newContext({ viewport: device.viewport, reducedMotion: mode === 'still' ? 'reduce' : 'no-preference' });
            const page = await context.newPage();
            watch(page);
            await page.goto(target.path);
            if (mode === 'engine') await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', { timeout: 120_000 });
            else await expect(html(page)).toHaveClass(/qi-static/);
            await page.waitForTimeout(1500);
            const fraction = await brightShare(page);
            test.info().annotations.push({ type: `bright-${mode}`, description: `${device.name}：${(fraction.share * 100).toFixed(2)}%（${fraction.pixels} px 的文字區域）` });
            expect(fraction.pixels, '有文字區域').toBeGreaterThan(10_000);
            expect(fraction.share, `${mode}：文字區域亮度 > 100 的比例`).toBeLessThanOrEqual(0.04);
            await context.close();
          }
        });
      }
    });
  }
});

/**
 * 只留光點層（內容、頁首、外框、顆粒都藏起來）截一張視窗圖，算「文字與海報圖區域」裡亮度 > 100 的像素占比。
 * 區域＝h1、導言、各海報標題與海報圖、按鈕的外框（藏起來之前量）。
 */
async function brightShare(page: Page): Promise<{ share: number; pixels: number }> {
  const regions = await boxOf(page, 'h1, .lead, .poster-grid__item h2, .poster, .poster img, .button');
  const size = page.viewportSize()!;
  await page.addStyleTag({ content: 'body > :not(main), main > :not([data-qi-backdrop]) { visibility: hidden !important; }' });
  const png = await page.screenshot();
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const inside = new Uint8Array(info.width * info.height);
  for (const box of regions) {
    const x0 = Math.max(0, Math.floor(box.left));
    const x1 = Math.min(size.width, Math.ceil(box.right));
    const y0 = Math.max(0, Math.floor(box.top));
    const y1 = Math.min(size.height, Math.ceil(box.bottom));
    for (let y = y0; y < y1; y++) inside.fill(1, y * info.width + x0, y * info.width + x1);
  }
  let pixels = 0;
  let bright = 0;
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i]) continue;
    pixels++;
    const o = i * info.channels;
    if (0.2126 * data[o]! + 0.7152 * data[o + 1]! + 0.0722 * data[o + 2]! > 100) bright++;
  }
  return { share: pixels > 0 ? bright / pixels : 0, pixels };
}

const FIELD_PAGES = ['./pricing/', './schedule/'];

test.describe('退回靜態圖：減少動態時每一頁都是靜態圖（不載入 three 與引擎），內容與 h1 不變', () => {
  const PAGES = [
    { path: './coaches/', h1: '師資', still: true },
    { path: './coaches/chan/', h1: '詹前賢', still: true },
    { path: './facility/', h1: '場地', still: true },
    { path: './pricing/', h1: '收費', still: true },
    { path: './schedule/', h1: '課表', still: true },
    { path: './courses/', h1: '課程', still: false }, // 氣流沒有形體，沒有靜態圖
    { path: './no-such-page/', h1: '找不到這一頁', still: true },
  ];

  for (const device of [
    { name: '桌機 1440×900', viewport: { width: 1440, height: 900 } },
    { name: '手機 390×844', viewport: { width: 390, height: 844 } },
  ]) {
    for (const target of PAGES) {
      test(`${target.path}（${device.name}）`, async ({ browser }) => {
        const context = await browser.newContext({ viewport: device.viewport, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const transfers = trackTransfers(page);
        await page.goto(target.path);
        await expect(html(page)).toHaveClass(/qi-static/);
        await expect(page.locator('canvas[data-qi-canvas]')).toBeHidden();
        await expect(page.getByRole('heading', { level: 1 })).toContainText(target.h1);
        expect(await page.locator('h1').count()).toBe(1);
        if (target.still) {
          const still = page.locator('.qi-still');
          await expect(still).toBeVisible();
          // 整張畫布的背景（收費、課表的竹簡）是低亮度的，靜態圖也暗（qi-page.css 的 --qi-still-opacity）；其餘是原亮度
          await expect(still).toHaveCSS('opacity', FIELD_PAGES.includes(target.path) ? '0.35' : '1');
          await page.evaluate(() => document.querySelector<HTMLImageElement>('.qi-still')!.decode());
          const bright = await brightBox(page, '.qi-still');
          expect(bright, '靜態圖有光點').not.toBeNull();
          if (target.path !== './pricing/' && target.path !== './schedule/') {
            const backdrop = await backdropBox(page);
            expect(bright!.left).toBeGreaterThanOrEqual(backdrop.left - 3);
            expect(bright!.right).toBeLessThanOrEqual(backdrop.right + 3);
            await expectNoOverlap(page, bright!, KEY_TEXT);
          }
        }
        await page.waitForTimeout(500);
        expect(transfers.filter((t) => /\/three\.module[^/]*\.js(\?|$)/.test(t.url) || /\/qi-stage[^/]*\.js(\?|$)/.test(t.url) || /\.bin(\?|$)/.test(t.url)).map((t) => t.url), '靜態圖模式不載入引擎').toEqual([]);
        await context.close();
      });
    }
  }
});

test.describe('沒有 JavaScript：靜態圖可見（課程總覽沒有靜態圖）、畫布不佔位、內容完整', () => {
  for (const target of [
    { path: './coaches/', h1: '師資', still: true },
    { path: './coaches/chan/', h1: '詹前賢', still: true },
    { path: './facility/', h1: '場地', still: true },
    { path: './pricing/', h1: '收費', still: true },
    { path: './schedule/', h1: '課表', still: true },
    { path: './courses/', h1: '課程', still: false },
    { path: './no-such-page/', h1: '找不到這一頁', still: true },
  ]) {
    test(`${target.path}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(target.path);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(target.h1);
      await expect(page.locator('canvas[data-qi-canvas]')).toBeHidden();
      if (target.still) {
        await expect(page.locator('.qi-still')).toBeVisible();
        await expect(page.locator('.qi-still')).toHaveCSS('opacity', FIELD_PAGES.includes(target.path) ? '0.35' : '1');
      } else {
        await expect(page.locator('.qi-still')).toHaveCount(0);
      }
      await context.close();
    });
  }
});

test.describe('無障礙與結構：光點層在每一頁都是裝飾', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const target of ['./coaches/', './coaches/chan/', './facility/', './pricing/', './schedule/', './no-such-page/']) {
    test(`${target}：backdrop 與 canvas aria-hidden、沒有可聚焦的東西、h1 恰一個、沒有入館閘門、光點層在內容底下`, async ({ page }) => {
      if (target.includes('no-such')) allow404(page);
      await page.goto(`${target}${QUERY}`);
      await expect(page.locator('[data-qi-backdrop]')).toHaveAttribute('aria-hidden', 'true');
      expect(await page.locator('[data-qi-backdrop] a, [data-qi-backdrop] button, [data-qi-backdrop] input, [data-qi-backdrop] [tabindex]').count()).toBe(0);
      expect(await page.locator('canvas[data-qi-canvas]').evaluate((el) => (el as HTMLCanvasElement).tabIndex)).toBe(-1);
      expect(await page.locator('h1').count()).toBe(1);
      await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);
      const style = await page.locator('[data-qi-backdrop]').evaluate((el) => ({ z: getComputedStyle(el).zIndex, events: getComputedStyle(el).pointerEvents }));
      expect(style).toEqual({ z: '-1', events: 'none' });
      // main 是第一個內容區塊的容器：光點層放在最前面，其餘內容的順序不變
      expect(await page.locator('main').evaluate((el) => el.firstElementChild?.getAttribute('data-qi-backdrop'))).toBe('');
    });
  }
});

test.describe('頁面專屬的 RF5：WebGL context 中途遺失', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const target of ['./coaches/', './facility/', './pricing/']) {
    test(`${target}：退回靜態圖、不報錯、內容不變`, async ({ page }) => {
      await open(page, target);
      const stripBackdrop = (s: string) => s.replace(/<div class="qi-backdrop"[\s\S]*?<\/canvas>(?:<div class="qi-slot"[^>]*><\/div>)?<\/div>/, '');
      const before = stripBackdrop(await page.locator('main').innerHTML());
      await page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]')!.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext());
      await expect(html(page)).toHaveAttribute('data-qi-mode', 'static', { timeout: 5000 });
      await expect(html(page)).toHaveAttribute('data-qi-reason', 'context-lost');
      await expect(page.locator('.qi-still')).toHaveCSS('opacity', FIELD_PAGES.includes(target) ? '0.35' : '1');
      expect(stripBackdrop(await page.locator('main').innerHTML())).toBe(before);
    });
  }
});

// 防止空轉：頁面光點層的接線（page.ts）對每一種頁面都掛得上
test('每種頁面的 data-qi-page 標記：main 與 html 都帶著（腳本與樣式靠它）', async ({ page }) => {
  for (const [path, kind] of [
    ['./coaches/', 'coaches'],
    ['./coaches/chan/', 'coach'],
    ['./facility/', 'facility'],
    ['./pricing/', 'pricing'],
    ['./schedule/', 'schedule'],
    ['./courses/', 'courses'],
    ['./courses/bajiquan/', 'course'],
  ] as const) {
    await page.goto(`${path}${QUERY}`);
    await expect(page.locator('main')).toHaveAttribute('data-qi-page', kind);
    await expect(page.locator('[data-qi-backdrop]')).toHaveAttribute('data-qi-page', kind);
  }
  allow404(page);
  await page.goto(`./no-such-page/${QUERY}`);
  await expect(page.locator('main')).toHaveAttribute('data-qi-page', 'lost');
});
