import { expect, test, type Page } from '@playwright/test';
import type { QiDebug } from '../../src/qi/engine/qi-stage';
import type { BeatId } from '../../src/qi/config/poses';

// Task 22b「畫面修飾」：審查累積的「看得見」瑕疵，用幾何與樣式斷言釘住。
//   1. 寬螢幕的大槍（與劍、妙刀）不壓到右緣的段落導覽（nav.home-rail）
//   4. 版面（文字在左或在下）與引擎取景依同一個寬高比切換（4:5）
//   5. 課程總覽頁的卡片大字是平面古金，不是 background-clip:text 的漸層字
// （2 無 JS 的段落導覽、3 手機站名與人形不重疊，見 home-fallback.spec.ts；7 延後降級見 qi-engine.spec.ts。）
// headless 的 WebGL 是軟體繪製：引擎相關一律 ?qi-tier=min&qi-debug=1，時間用停住的假時鐘；只用 page.*，不碰 OS 層級的滑鼠鍵盤。
test.describe.configure({ mode: 'default', timeout: 120_000 });

const HOME = './?qi-tier=min&qi-debug=1';
const T0 = new Date('2026-01-01T08:00:00');
const T1 = new Date('2026-01-01T09:00:00');
const READY = { timeout: 30_000 };

type W = { __qi: { debug: QiDebug } };
const KNOWN_WARNING = /GPU stall due to ReadPixels/;

const seen = new WeakMap<Page, { errors: string[]; warnings: string[] }>();

async function open(page: Page): Promise<void> {
  const log = { errors: [] as string[], warnings: [] as string[] };
  seen.set(page, log);
  page.on('pageerror', (error) => log.errors.push(`pageerror: ${error}`));
  page.on('console', (message) => {
    if (message.type() === 'error') log.errors.push(`console.error: ${message.text()}`);
    if (message.type() === 'warning') log.warnings.push(`console.warning: ${message.text()}`);
  });
  await page.addInitScript(() => sessionStorage.setItem('liuyi:qi-intro', '1')); // 跳過開場
  await page.clock.install({ time: T0 });
  await page.goto(HOME);
  await expect(page.locator('html')).toHaveAttribute('data-qi-ready', 'true', READY);
  await page.clock.pauseAt(T1);
}

test.afterEach(async ({ page }) => {
  const log = seen.get(page);
  if (!log) return;
  expect(log.errors, '頁面全程不得有 pageerror 或 console.error').toEqual([]);
  expect(log.warnings.filter((w) => !KNOWN_WARNING.test(w)), '頁面全程不得有 console.warning').toEqual([]);
});

const scrollToBeat = (page: Page, beat: BeatId) =>
  page.evaluate((id) => {
    const rect = document.querySelector(`[data-beat="${id}"]`)!.getBoundingClientRect();
    window.scrollTo(0, Math.round(rect.top + window.scrollY + rect.height / 2 - window.innerHeight / 2));
  }, beat);

/**
 * 捲到該段、等姿勢的形體載完並套上、再讓光點聚合。形體是真的 fetch（不受假時鐘控制），姿勢要靠 rAF 才會被要求，
 * 所以先讓時鐘走一小段、等 `data-qi-pose` 換成目標（真實時間，機器忙時也等得到），再推進 3.5 秒；
 * 直接推進 3.5 秒的話，形體若晚於它才到，光點還沒開始聚合就量了。
 */
async function settlePose(page: Page, beat: BeatId, pose: string): Promise<void> {
  await scrollToBeat(page, beat);
  await page.clock.runFor(200);
  await expect(page.locator('html')).toHaveAttribute('data-qi-pose', pose, READY);
  await page.clock.runFor(3500);
}

// ── 1. 大槍與右緣段落導覽 ────────────────────────────────────────────

/**
 * 槍頭的光暈向外約這麼多 px（高階 tier 的近光暈，從截圖量：亮處之外再約 40px）。headless 測試用 min tier（沒有光暈），
 * 所以把光點的外框往四邊各擴這麼多，當作含光暈的外框：它不能與導覽的矩形相交。
 */
const HALO_PX = 40;

const RAIL_SIZES = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1024, height: 768 }, // 導覽從 60rem 起顯示的最窄一帶
];
const WEAPON_BEATS = [
  { beat: 'weapon-a', pose: 'jian', name: '劍' },
  { beat: 'weapon-b', pose: 'miaodao', name: '妙刀' },
  { beat: 'weapon-c', pose: 'spear', name: '大槍' },
] as const;

for (const size of RAIL_SIZES) {
  test.describe(`兵器與右緣導覽：${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    for (const { beat, pose, name } of WEAPON_BEATS) {
      test(`${name}聚合後，光點（含槍頭光暈 ${HALO_PX}px）不與 nav.home-rail 的矩形相交`, async ({ page }) => {
        await open(page);
        await settlePose(page, beat, pose);
        expect(await page.evaluate(() => (window as unknown as W).__qi.debug.meanError()), '已聚合').toBeLessThan(0.05);

        const rail = await page.locator('nav.home-rail').boundingBox();
        expect(rail, '段落導覽可見').not.toBeNull();
        const extent = await page.evaluate(() => (window as unknown as W).__qi.debug.extent());
        expect(extent.right, '兵器有畫出來（不是空畫面造成的假通過）').toBeGreaterThan(extent.left);
        // 兵器光點的外框（含光暈）與導覽的矩形相交 ⇔ 兩軸上都有重疊
        const overlapX = Math.min(extent.right + HALO_PX, rail!.x + rail!.width) - Math.max(extent.left - HALO_PX, rail!.x);
        const overlapY = Math.min(extent.bottom + HALO_PX, rail!.y + rail!.height) - Math.max(extent.top - HALO_PX, rail!.y);
        expect(
          overlapX > 0 && overlapY > 0,
          `兵器外框（含光暈 ${HALO_PX}px）與導覽相交：外框 ${JSON.stringify(extent)}、導覽 ${JSON.stringify(rail)}、重疊 x ${overlapX.toFixed(1)}px y ${overlapY.toFixed(1)}px`,
        ).toBe(false);
      });
    }
  });
}

// 兵器左端不進入文字欄：橫向版面的文字欄（.beat__text，左欄）之後才是兵器的地盤；近方形視窗與窄的橫向視窗，
// 兵器的左端原本會伸進文字（槍尾碰到字）。量引擎讀回的實際光點外框，與該段 .beat__text 的右緣比。
const TEXT_SIZES = [
  { width: 900, height: 600 },
  { width: 1000, height: 1000 },
  { width: 1024, height: 1124 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 844, height: 390 },
];

for (const size of TEXT_SIZES) {
  test.describe(`兵器與文字欄：${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    for (const { beat, pose, name } of WEAPON_BEATS) {
      test(`${name}聚合後，光點外框的左端在文字欄右緣之右`, async ({ page }) => {
        await open(page);
        await settlePose(page, beat, pose);
        expect(await page.evaluate(() => (window as unknown as W).__qi.debug.meanError()), '已聚合').toBeLessThan(0.05);
        const column = await page.evaluate((id) => {
          const text = [...document.querySelectorAll(`[data-beat="${id}"] .beat__text`)].find((el) => el.getClientRects().length > 0)!;
          const r = text.getBoundingClientRect();
          return { left: r.left, right: r.right };
        }, beat);
        const extent = await page.evaluate(() => (window as unknown as W).__qi.debug.extent());
        expect(extent.right, '兵器有畫出來').toBeGreaterThan(extent.left);
        expect(extent.left, `光點外框左端 ${extent.left.toFixed(0)}px 在文字欄右緣 ${column.right.toFixed(0)}px 之右（右端 ${extent.right.toFixed(0)}px）`).toBeGreaterThanOrEqual(column.right);
      });
    }
  });
}

// ── 4. 版面與引擎取景同一個切換點 ─────────────────────────────────────

const ORIENT_SIZES = [
  { width: 900, height: 600, portrait: false },
  { width: 844, height: 390, portrait: false },
  { width: 1000, height: 1000, portrait: false },
  { width: 1024, height: 1124, portrait: false },
  { width: 1440, height: 900, portrait: false },
  { width: 1024, height: 1366, portrait: true },
  { width: 390, height: 844, portrait: true },
  { width: 360, height: 740, portrait: true },
];

for (const size of ORIENT_SIZES) {
  test.describe(`版面方向：${size.width}×${size.height}（${size.portrait ? '直向' : '橫向'}）`, () => {
    test.use({ viewport: size });

    test('文字版面、海報與引擎取景都是同一個方向', async ({ page }) => {
      await open(page);
      const state = await page.evaluate(() => {
        const panel = [...document.querySelectorAll('.beat__panel')].find((el) => el.getClientRects().length > 0)!; // 目前顯示的那一組
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]')!.getBoundingClientRect();
        const figure = (window as unknown as W).__qi.debug.project(0, 1, 0);
        return {
          columns: getComputedStyle(panel).gridTemplateColumns.split(' ').length,
          portraitQuery: matchMedia('(max-aspect-ratio: 4/5)').matches,
          figureX: (figure.x - canvas.left) / canvas.width, // 人形中心在畫布寬的幾成處
          lockupAligned: getComputedStyle(document.querySelector('.opening')!).alignItems,
        };
      });
      expect(state.portraitQuery, 'CSS 的寬高比條件').toBe(size.portrait);
      expect(state.columns, `文字版面：${size.portrait ? '直向堆疊（1 欄）' : '橫向（文字在左、光點在右，2 欄）'}`).toBe(size.portrait ? 1 : 2);
      expect(state.lockupAligned, '開場的站名：直向在下方，橫向置中對齊').toBe(size.portrait ? 'end' : 'center');
      // 引擎取景：直向人形在正中央，橫向人形偏右（63%）
      expect(state.figureX, '引擎人形的水平位置（畫布寬的比例）').toBeCloseTo(size.portrait ? 0.5 : 0.63, 1);
    });
  });
}

// ── 4b. 橫放手機：切換鈕不蓋住招式文字 ────────────────────────────────
// 橫向版面的文字欄在左；切換鈕（頁面上 sticky，捲動時一直在視窗上緣）在寬度 < 60rem 時靠右，才不蓋到拳術段與三個兵器段的標題、朱印。
// 直式堆疊版面（直向）切換鈕本來就在右上，這裡只量橫放手機。

const PHONE_LANDSCAPE = [
  { width: 844, height: 390 },
  { width: 740, height: 360 },
  { width: 667, height: 375 },
  { width: 568, height: 320 },
];

for (const size of PHONE_LANDSCAPE) {
  test.describe(`切換鈕與招式文字：橫放手機 ${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    for (const beat of ['fist', 'weapon-a', 'weapon-b', 'weapon-c'] as const) {
      test(`${beat} 段：切換鈕與 .beat__text 不相交`, async ({ page }) => {
        await open(page);
        await scrollToBeat(page, beat);
        await page.clock.runFor(300);
        const boxes = await page.evaluate((id) => {
          const rect = (el: Element) => {
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          };
          const text = [...document.querySelectorAll(`[data-beat="${id}"] .beat__text`)].find((el) => el.getClientRects().length > 0)!;
          return { text: rect(text), switcher: rect(document.querySelector('.audience-switch__inner')!) };
        }, beat);
        const x = Math.min(boxes.text.right, boxes.switcher.right) - Math.max(boxes.text.left, boxes.switcher.left);
        const y = Math.min(boxes.text.bottom, boxes.switcher.bottom) - Math.max(boxes.text.top, boxes.switcher.top);
        expect(x > 0 && y > 0, `切換鈕與招式文字相交（重疊 x ${x.toFixed(1)}px、y ${y.toFixed(1)}px）：文字 ${JSON.stringify(boxes.text)}、切換鈕 ${JSON.stringify(boxes.switcher)}`).toBe(false);
      });
    }
  });
}

// ── 5. 課程卡大字：平面古金 ───────────────────────────────────────────

test.describe('課程總覽的卡片大字', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('是平面古金：靜止時沒有 background-clip:text、沒有漸層底（computed background-image 為 none）', async ({ page }) => {
    await page.goto('./courses/');
    const glyphs = page.locator('.course-card__glyph');
    expect(await glyphs.allTextContents(), '課程總覽的文字卡有兵、拳、搏三個大字').toEqual(expect.arrayContaining(['兵', '拳', '搏']));
    for (const glyph of await glyphs.all()) {
      const style = await glyph.evaluate((el) => {
        const s = getComputedStyle(el);
        return { image: s.backgroundImage, clip: s.backgroundClip, webkitClip: s.getPropertyValue('-webkit-background-clip'), color: s.color, text: el.textContent?.trim() };
      });
      expect(style.image, `「${style.text}」的背景圖`).toBe('none');
      expect(style.clip, `「${style.text}」的 background-clip`).not.toBe('text');
      expect(style.webkitClip, `「${style.text}」的 -webkit-background-clip`).not.toBe('text');
      expect(style.color, `「${style.text}」的字色是古金 #B3924F（--color-accent）`).toBe('rgb(179, 146, 79)');
    }
  });
});

// ── 5b. 全站沒有漸層字 ────────────────────────────────────────────────
// 設計 §4 反目標：金色漸層立體字。逐頁檢查所有元素的 computed style（靜止時）：沒有任何一個是 background-clip:text。
// 頁面清單取自 sitemap（含所有課程頁、教練頁），另加 404。

test.describe('全站：靜止時沒有 background-clip:text', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('sitemap 的每一頁與 404 頁，沒有任何元素的 background-clip 是 text', async ({ page, request, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const base = new URL(baseURL!).pathname;
    const sitemap = await (await request.get(`${origin}${base}sitemap-0.xml`)).text();
    const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname.replace(base, './'));
    expect(paths.length, '從 sitemap 讀到所有頁面').toBeGreaterThanOrEqual(15);
    paths.push('./no-such-page/'); // 404 頁（靜態伺服器回 404.html）

    const offenders: string[] = [];
    for (const path of paths) {
      await page.goto(path);
      const found = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll('*')) {
          const style = getComputedStyle(el);
          if (style.backgroundClip === 'text' || style.getPropertyValue('-webkit-background-clip') === 'text') {
            out.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className}「${(el.textContent ?? '').trim().slice(0, 8)}」`);
          }
        }
        return out;
      });
      for (const item of found) offenders.push(`${path} ${item}`);
    }
    expect(offenders).toEqual([]);
  });
});
