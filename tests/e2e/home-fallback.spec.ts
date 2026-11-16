import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { BeatId } from '../../src/qi/config/poses';
import { decodeShape } from '../../src/qi/shapes/format';
import type { QiDebug } from '../../src/qi/engine/qi-stage';
import { hiddenByStyle, homeTitles, basePath } from './helpers';

// 首頁的首屏交接、退回與無障礙（Task 20）：
//   - 首屏：引擎 chunk 還沒到之前，海報＋h1 就是畫面（不空白）；到了之後交叉淡化、人形對得上。
//   - 退回：減少動態、沒有 WebGL2、引擎掛不上、WebGL context 中途遺失（RF5）→ 靜態圖；沒有 JS → 兩組面板與靜態圖。
//   - 無障礙：canvas 不進無障礙樹也不可聚焦、Tab 序無陷阱、切換鈕有 aria-pressed、靜態圖 alt 為空。
//   - 引擎接線補強（前面審查轉來的）：每格迴圈丟錯不停擺、第一個姿勢載入中視窗變動仍取景、後續姿勢載入失敗要 warn、pagehide 釋放。
// headless 的 WebGL 是軟體繪製：引擎相關一律 ?qi-tier=min&qi-debug=1，時間用停住的假時鐘；只用 page.*，不碰 OS 層級的滑鼠鍵盤。
test.describe.configure({ mode: 'default', timeout: 120_000 });

const HOME = './?qi-tier=min&qi-debug=1';
const T0 = new Date('2026-01-01T08:00:00');
const T1 = new Date('2026-01-01T09:00:00');
const READY = { timeout: 30_000 };

const DEVICES = [
  { name: '桌機 1440×900', viewport: { width: 1440, height: 900 } },
  { name: '手機 390×844', viewport: { width: 390, height: 844 } },
];

type W = { __qi: { ready: boolean; frames: number; tier: string; mode: string; debug: QiDebug } };

/** 軟體 GL（SwiftShader）在讀回像素時印的效能提示；已知的雜訊，其餘 warning 一律不允許。 */
const KNOWN_WARNING = /GPU stall due to ReadPixels/;

interface Seen {
  errors: string[];
  warnings: string[];
  /** 這個測試刻意製造的錯誤／警告（其餘一律不允許）。 */
  allowErrors: RegExp[];
  allowWarnings: RegExp[];
}
const seen = new WeakMap<Page, Seen>();

function watch(page: Page): Seen {
  const log: Seen = { errors: [], warnings: [], allowErrors: [], allowWarnings: [] };
  seen.set(page, log);
  page.on('pageerror', (error) => log.errors.push(`pageerror: ${error}`));
  page.on('console', (message) => {
    if (message.type() === 'error') log.errors.push(`console.error: ${message.text()}`);
    if (message.type() === 'warning') log.warnings.push(`console.warning: ${message.text()}`);
  });
  return log;
}

function expectClean(log: Seen): void {
  expect(log.errors.filter((e) => !log.allowErrors.some((re) => re.test(e))), '頁面全程不得有 pageerror 或 console.error').toEqual([]);
  expect(
    log.warnings.filter((w) => !KNOWN_WARNING.test(w) && !log.allowWarnings.some((re) => re.test(w))),
    '頁面全程不得有 console.warning（軟體繪製的 ReadPixels 效能提示除外）',
  ).toEqual([]);
}

test.afterEach(async ({ page }) => {
  const log = seen.get(page);
  if (log) expectClean(log);
});

interface OpenOptions {
  url?: string;
  /** 預設先標記「這個工作階段看過開場」（跳過開場）；'fresh' 才讓開場照演。 */
  intro?: 'seen' | 'fresh';
  /** 導覽之前（`addInitScript` 之類）要做的事。 */
  before?: (page: Page) => Promise<unknown>;
}

/** 開首頁、等引擎 ready、再把時鐘停住（之後只有 `run` 會推進）。 */
async function open(page: Page, options: OpenOptions = {}): Promise<Seen> {
  const log = seen.get(page) ?? watch(page);
  if (options.intro !== 'fresh') {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem('liuyi:qi-intro', '1');
      } catch {
        // 封鎖 storage 的測試自己處理
      }
    });
  }
  await options.before?.(page);
  await page.clock.install({ time: T0 });
  await page.goto(options.url ?? HOME);
  await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
  await page.clock.pauseAt(T1);
  return log;
}

const html = (page: Page) => page.locator('html');
const run = (page: Page, ms: number) => page.clock.runFor(ms);
const frames = (page: Page) => page.evaluate(() => (window as unknown as W).__qi.frames);
const canvasSizes = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]')!;
    return { buffer: canvas.width, css: canvas.clientWidth };
  });

const beatCenterY = (page: Page, id: BeatId) =>
  page.evaluate((beat) => {
    const rect = document.querySelector(`[data-beat="${beat}"]`)!.getBoundingClientRect();
    return Math.round(rect.top + window.scrollY + rect.height / 2 - window.innerHeight / 2);
  }, id);
const scrollToY = (page: Page, y: number) => page.evaluate((top) => window.scrollTo(0, top), y);
const scrollToBeat = async (page: Page, id: BeatId) => scrollToY(page, await beatCenterY(page, id));

/** 改視窗大小，並等到頁面的 resize 事件派送完（resize 由瀏覽器在下一次繪製時派送，不受假時鐘控制）。 */
async function resizeTo(page: Page, width: number, height: number): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __resized: Promise<void> }).__resized = new Promise((resolve) => {
      window.addEventListener('resize', () => resolve(), { once: true });
    });
  });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => (window as unknown as { __resized: Promise<void> }).__resized);
}

/** 把引擎 chunk（檔名含 qi-stage）扣住，直到呼叫回傳的函式（保險：30 秒後自動放行）。 */
async function holdEngine(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
    setTimeout(resolve, 30_000);
  });
  await page.route(/qi-stage[^/]*\.js(\?.*)?$/, async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

/** 等所有「會結束」的動畫跑完（進場動畫 0.9 秒）：截圖才不會抓到半透明的標題。 */
const settleAnimations = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );

/** 截圖的亮度統計（sRGB 8-bit 的 Rec.709 亮度）：平均值與亮度 > 100 的像素占比。 */
async function lumaStats(png: Buffer): Promise<{ mean: number; bright: number }> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  let sum = 0;
  let bright = 0;
  for (let i = 0; i < pixels; i++) {
    const luma = 0.2126 * data[i * 3]! + 0.7152 * data[i * 3 + 1]! + 0.0722 * data[i * 3 + 2]!;
    sum += luma;
    if (luma > 100) bright++;
  }
  return { mean: sum / pixels, bright: bright / pixels };
}

/**
 * 版面上有占位、卻被樣式藏起來（透明或 visibility:hidden）的內容。與 `hiddenByStyle` 同一個判準，差別有二：
 * 先等進場動畫跑完（有動態時切換面板的文字會淡入）；`display:none` 的那組面板不算（它沒有占位，瀏覽器對它回報的不透明度不可靠）。
 */
async function hiddenRendered(page: Page): Promise<string[]> {
  await settleAnimations(page);
  return page.evaluate(() => {
    const hidden: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main h1, main h2, main h3, main p, main a, main li, main img')) {
      if (el.closest('[aria-hidden="true"]') || el.getClientRects().length === 0) continue;
      for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (Number(style.opacity) < 0.99 || style.visibility === 'hidden') {
          hidden.push(`${el.tagName}.${el.className}: ${(el.textContent ?? '').trim().slice(0, 12)}`);
          break;
        }
      }
    }
    return hidden;
  });
}

/** 區塊內可見的靜態圖都已載入（lazy：逐張捲進視窗再等 naturalWidth）。 */
async function expectStillsLoaded(page: Page, scope = 'main'): Promise<number> {
  const stills = page.locator(`${scope} img.beat__still`).filter({ visible: true });
  const count = await stills.count();
  expect(count, '有靜態圖').toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const still = stills.nth(i);
    await still.scrollIntoViewIfNeeded();
    await expect.poll(() => still.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), `靜態圖 #${i}`).toBeGreaterThan(0);
  }
  return count;
}

/** 主要內容的文字與連結（RF5：退回前後不能變）。 */
const domContent = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('main')!;
    return {
      text: main.innerText.replace(/\s+/g, ' ').trim(),
      links: Array.from(main.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')),
      headings: Array.from(main.querySelectorAll('h1, h2, h3')).map((h) => (h.textContent ?? '').trim()),
    };
  });

/** 沒有 WebGL 的裝置：任何 webgl／webgl2 的 getContext 都回 null（沿用 arsenal.spec 的寫法）。 */
const blockWebGL = (page: Page) =>
  page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (/webgl/i.test(type)) return null;
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });

/** 減少動態與沒有 WebGL 共用的靜態斷言（退回後頁面長什麼樣）。 */
async function expectStaticHome(page: Page, requests: string[], reason: string): Promise<void> {
  await expect(html(page)).toHaveClass(/qi-static/);
  await expect(html(page)).toHaveAttribute('data-qi-mode', 'static');
  await expect(html(page)).toHaveAttribute('data-qi-reason', reason);
  expect(requests.filter((url) => /qi-stage/.test(url)), '沒有請求引擎 chunk').toEqual([]);
  expect(requests.filter((url) => /\.bin(\?|$)/.test(url)), '沒有請求形體檔').toEqual([]);
  await expect(page.locator('[data-skip-intro]')).toBeHidden();
  await expect(page.locator('canvas[data-qi-canvas]')).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as W).__qi.mode)).toBe('static');

  // 海報就是首屏
  const poster = page.locator('.opening__poster img');
  await expect(poster).toBeVisible();
  await expect.poll(() => poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.opening__poster')).toHaveCSS('opacity', '1');

  // 各段的靜態圖：可見面板內的都載入
  await expectStillsLoaded(page);
  expect(await hiddenRendered(page), '沒有被樣式藏住的內容').toEqual([]);

  // 切換對象後，可見的靜態圖換成另一組
  await page.locator('#courses').scrollIntoViewIfNeeded();
  const fist = page.locator('[data-beat="fist"] img.beat__still').filter({ visible: true });
  const before = await fist.getAttribute('src');
  await page.getByRole('button', { name: '小孩' }).click();
  await expect.poll(() => fist.getAttribute('src')).not.toBe(before);
  await expectStillsLoaded(page, '#courses');
  expect(await hiddenRendered(page), '切到小孩後沒有被樣式藏住的內容').toEqual([]);
}

/**
 * 退回靜態圖後，課程、師資、預約三種入口都真的點得到（實際點擊，不是 trial）：
 * 課程連結進課程頁、教練連結進教練頁、預約按鈕開 LINE 視窗。每一輪重新載入首頁。
 */
async function expectClickThrough(page: Page, baseURL: string | undefined): Promise<void> {
  const base = basePath(baseURL);

  await page.goto('./');
  const course = page.getByRole('link', { name: /^看這門課/ }).first();
  await course.scrollIntoViewIfNeeded();
  await course.click();
  await expect(page, '課程').toHaveURL(new RegExp(`${base}courses/[^/]+/$`));

  await page.goto('./');
  const coach = page.locator('#coaches [data-coach] a').first();
  await coach.scrollIntoViewIfNeeded();
  await coach.click();
  await expect(page, '師資').toHaveURL(new RegExp(`${base}coaches/[^/]+/$`));

  await page.goto('./');
  const booking = page.locator('#booking a.button--solid');
  await booking.scrollIntoViewIfNeeded();
  await booking.click();
  await expect(page.locator('#line-dialog'), '預約').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#line-dialog')).toBeHidden();
}

// ── 首屏交接 ──────────────────────────────────────────────────────

for (const device of DEVICES) {
  test.describe(`首屏交接：${device.name}`, () => {
    test.use({ viewport: device.viewport });

    test('引擎 chunk 被拖住時首屏不空白（海報、h1、亮度），放行後 ready、海報 1 秒內淡出、canvas 可見', async ({ page }) => {
      watch(page);
      const release = await holdEngine(page);
      await page.goto(HOME);

      const poster = page.locator('.opening__poster img');
      await expect(poster).toBeVisible();
      await expect.poll(() => poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
      await expect(page.locator('h1')).toBeVisible();
      await expect(html(page)).not.toHaveAttribute('data-qi-ready', /.*/);
      await expect(page.locator('.opening__poster')).toHaveCSS('opacity', '1');

      await settleAnimations(page);
      const { width, height } = device.viewport;
      const center = await lumaStats(await page.screenshot({ clip: { x: width * 0.25, y: height * 0.25, width: width * 0.5, height: height * 0.5 } }));
      expect(center.mean, '截圖中央區域平均亮度').toBeGreaterThan(3);
      // 暗底上要有人形與標題：亮度 > 100 的像素占整個首屏的 1.5%–15%（計畫的視覺守門）
      const whole = await lumaStats(await page.screenshot());
      test.info().annotations.push({ type: 'first-screen', description: `中央平均亮度 ${center.mean.toFixed(1)}；亮度 > 100 的像素占比 ${(whole.bright * 100).toFixed(2)}%` });
      expect(whole.bright, '首屏亮點占比').toBeGreaterThanOrEqual(0.015);
      expect(whole.bright, '首屏亮點占比').toBeLessThanOrEqual(0.15);

      release();
      await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
      await expect(page.locator('.opening__poster')).toHaveCSS('opacity', '0', { timeout: 1000 });
      await expect(page.locator('canvas[data-qi-canvas]')).toBeVisible();
    });
  });
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 兩個矩形在 x、y 兩軸上各自重疊多少 px（負數＝分開）。 */
function overlap(a: Box, b: Box): { x: number; y: number } {
  return { x: Math.min(a.right, b.right) - Math.max(a.left, b.left), y: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) };
}

/**
 * 首屏人形的外框（視窗座標）：
 *   - 海報：把圖解碼後取亮度 > 100 的像素外框（只剩人形與輪廓；更低的門檻會連光暈與環境煙一起算進去），再換算成視窗座標。
 *   - 引擎：land 形體的 xy 外框四角投影到螢幕。
 */
async function figureBoxes(page: Page): Promise<{ poster: Box; engine: Box }> {
  const land = decodeShape(new Uint8Array(readFileSync(fileURLToPath(new URL('../../src/assets/generated/qi/shapes/land.bin', import.meta.url)))));
  const bounds = { minX: land.min[0], maxX: land.max[0], minY: land.min[1], maxY: land.max[1] };

  const poster = await page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('.opening__poster img')!;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(img, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    let x0 = width;
    let x1 = -1;
    let y0 = height;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        if (0.2126 * data[o]! + 0.7152 * data[o + 1]! + 0.0722 * data[o + 2]! <= 100) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    const rect = img.getBoundingClientRect();
    const sx = rect.width / width;
    const sy = rect.height / height;
    return { left: rect.left + x0 * sx, right: rect.left + (x1 + 1) * sx, top: rect.top + y0 * sy, bottom: rect.top + (y1 + 1) * sy };
  });

  const engine = await page.evaluate(({ minX, maxX, minY, maxY }) => {
    const { project } = (window as unknown as W).__qi.debug;
    const corners = [project(minX, minY, 0), project(maxX, minY, 0), project(minX, maxY, 0), project(maxX, maxY, 0)];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  }, bounds);

  return { poster, engine };
}

/**
 * 海報對齊要量的尺寸：計畫指定的兩個，另加小手機、平板與全高清，以及「寬度斷點（60rem）與直／橫切換點（視窗寬高比 4:5）不重合」的尺寸：
 * 橫放手機（寬 < 60rem 但橫向）、900×600（同）、直式平板（寬 ≥ 60rem 但直向）。
 */
const ALIGN_SIZES = [
  ...DEVICES,
  { name: '小手機 360×640', viewport: { width: 360, height: 640 } },
  { name: '平板橫向 1024×768', viewport: { width: 1024, height: 768 } },
  { name: '桌機 1920×1080', viewport: { width: 1920, height: 1080 } },
  { name: '橫放手機 844×390', viewport: { width: 844, height: 390 } },
  { name: '橫放小手機 667×375', viewport: { width: 667, height: 375 } },
  { name: '小筆電 900×600', viewport: { width: 900, height: 600 } },
  { name: '直式平板 1024×1366', viewport: { width: 1024, height: 1366 } },
  // Task 22b：版面與引擎取景同一個寬高比切換點（4:5）。近方形（0.8–1.0）一律橫向取景，海報也要跟著橫向；手機 360×740 是常見的短螢幕。
  { name: '手機 360×740', viewport: { width: 360, height: 740 } },
  { name: '近方形 1000×1000', viewport: { width: 1000, height: 1000 } },
  { name: '近方形 1024×1124', viewport: { width: 1024, height: 1124 } },
  // 常見的直式平板（iPad 9.7／10.9 吋）：寬 ≥ 60rem 的直向，站名要放在人形下方
  { name: '直式平板 768×1024', viewport: { width: 768, height: 1024 } },
  { name: '直式平板 820×1180', viewport: { width: 820, height: 1180 } },
];

for (const device of ALIGN_SIZES) {
  test.describe(`海報對齊：${device.name}`, () => {
    test.use({ viewport: device.viewport });

    test('海報人形與引擎 land 的外框對齊：中心與高度差都 ≤ 視窗的 5%', async ({ page }) => {
      await open(page);
      const { poster, engine } = await figureBoxes(page);

      const { width, height } = device.viewport;
      const measure = (box: Box) => ({
        cx: (box.left + box.right) / 2,
        cy: (box.top + box.bottom) / 2,
        h: box.bottom - box.top,
      });
      const p = measure(poster);
      const e = measure(engine);
      const note = `海報 ${JSON.stringify(p)} / 引擎 ${JSON.stringify(e)}`;
      test.info().annotations.push({
        type: 'alignment',
        description: `Δcx ${(((p.cx - e.cx) / width) * 100).toFixed(2)}%  Δcy ${(((p.cy - e.cy) / height) * 100).toFixed(2)}%  Δh ${(((p.h - e.h) / height) * 100).toFixed(2)}%`,
      });
      expect(Math.abs(p.cx - e.cx) / width, `中心 x 差（占視窗寬）：${note}`).toBeLessThanOrEqual(0.05);
      expect(Math.abs(p.cy - e.cy) / height, `中心 y 差（占視窗高）：${note}`).toBeLessThanOrEqual(0.05);
      expect(Math.abs(p.h - e.h) / height, `高度差（占視窗高）：${note}`).toBeLessThanOrEqual(0.05);
    });

    // Task 22b：直書站名與副標不壓到人形（手機首屏、近方形、直式平板、橫放手機）。海報與引擎的外框各量一次，
    // 兩個矩形不得有任何像素重疊（至少一軸上是分開的）。外框是矩形，人形是輪廓：矩形重疊比實際壓到人形更嚴，所以量到 0 就一定沒壓到。
    test('站名（h1）與副標不壓到人形：海報外框與引擎外框都沒有像素重疊', async ({ page }) => {
      await open(page);
      await settleAnimations(page); // 進場動畫（0.9 秒、上移 1rem）跑完，量到的才是站名的定位
      const { poster, engine } = await figureBoxes(page);
      const texts = await page.evaluate(() => {
        const box = (selector: string) => {
          const r = document.querySelector(selector)!.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        return { h1: box('.opening h1'), sub: box('.opening__sub') };
      });
      for (const [figure, box] of [['海報', poster], ['引擎', engine]] as const) {
        for (const [name, text] of Object.entries(texts)) {
          const { x, y } = overlap(box, text);
          expect(Math.min(x, y), `${figure}人形外框與 ${name} 的重疊（x ${x.toFixed(1)}px、y ${y.toFixed(1)}px；兩軸都 > 0 才算重疊）：人形 ${JSON.stringify(box)} / ${name} ${JSON.stringify(text)}`).toBeLessThanOrEqual(0);
        }
      }
    });
  });
}

test.describe('開場演一次', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('新 context 首次載入 playing → done；同一分頁重新整理 skipped；新 context 再次 playing', async ({ page, browser, baseURL }) => {
    await open(page, { intro: 'fresh' });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await run(page, 4500);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'done');

    await page.reload();
    await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'skipped');

    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    try {
      const other = await context.newPage();
      const log = await open(other, { intro: 'fresh' });
      await expect(html(other)).toHaveAttribute('data-qi-intro', 'playing');
      expectClean(log);
    } finally {
      await context.close();
    }
  });

  test('鍵盤略過：Tab 可聚焦 [data-skip-intro]，Enter 立刻 skipped', async ({ page }) => {
    await open(page, { intro: 'fresh' });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    const skip = page.locator('[data-skip-intro]');
    await expect(skip).toBeVisible();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      if (await skip.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'skipped');
    await expect(skip).toBeHidden();
  });

  test('Esc 略過：引擎的開場計時歸零（uIntroT -1）、記為 skipped（不是 done）、略過鈕收起，之後也不會被演完的回呼改成 done', async ({ page }) => {
    await open(page, { intro: 'fresh' });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await run(page, 800);
    const introT = () => page.evaluate(() => (window as unknown as W).__qi.debug.uniforms().uIntroT!);
    expect(await introT(), '按 Esc 之前開場正在演').toBeGreaterThan(0.3);
    await expect(page.locator('[data-skip-intro]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'skipped');
    await expect(page.locator('[data-skip-intro]')).toBeHidden();
    expect(await introT(), '引擎端的開場真的結束').toBe(-1);

    // 原本該演完的時間點過後：狀態仍是 skipped，引擎沒有重新開演
    await run(page, 4500);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'skipped');
    expect(await introT()).toBe(-1);
  });
});

// ── 減少動態、沒有 WebGL、引擎掛不上 ───────────────────────────────

for (const device of DEVICES) {
  test.describe(`減少動態：${device.name}`, () => {
    test.use({ viewport: device.viewport, reducedMotion: 'reduce' });

    test('靜態圖退回：不載入引擎、不請求形體檔、無略過鈕、顆粒不動、無水平外溢；課程、師資、預約都點得到', async ({ page, baseURL }) => {
      watch(page);
      const requests: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      await page.goto('./');
      await expectStaticHome(page, requests, 'reduced-motion');
      // 減少動態沒有進場動畫，所以共用的 hiddenByStyle 也成立（兩組面板切換後都看得到）
      expect(await hiddenByStyle(page, 'main')).toEqual([]);
      expect(await page.locator('.grain').evaluate((el) => getComputedStyle(el).animationName), '顆粒不動').toBe('none');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await expectClickThrough(page, baseURL);
    });
  });

  test.describe(`沒有 WebGL：${device.name}`, () => {
    test.use({ viewport: device.viewport });

    test('同樣退回靜態圖；沒有 pageerror；所有課程連結可點；課程、師資、預約都點得到', async ({ page, baseURL }) => {
      watch(page);
      await blockWebGL(page);
      const requests: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      await page.goto('./');
      await expectStaticHome(page, requests, 'no-webgl');

      // 面板切回大人後，每個看得到的課程連結都點得到（不被外框、頁首、導覽蓋住）
      await page.getByRole('button', { name: '大人' }).click();
      const links = page.locator('main a[href*="courses/"]').filter({ visible: true });
      const count = await links.count();
      expect(count, '首頁看得到的課程連結').toBeGreaterThanOrEqual(4);
      for (let i = 0; i < count; i++) {
        await links.nth(i).scrollIntoViewIfNeeded();
        await links.nth(i).click({ trial: true });
      }
      await links.first().click();
      await expect(page).toHaveURL(/courses\/[^/]+\/$/);
      await expectClickThrough(page, baseURL);
    });
  });
}

test.describe('引擎掛不上（init-failed）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('裝置沒有浮點／半精度 render target：退回靜態圖、釋放 GL context、只 warn 不報錯', async ({ page }) => {
    const log = watch(page);
    log.allowWarnings.push(/extension not supported/, /The qi engine could not start/);
    await page.addInitScript(() => {
      const proto = WebGL2RenderingContext.prototype as unknown as { getExtension(name: string): unknown };
      const original = proto.getExtension;
      proto.getExtension = function (this: WebGL2RenderingContext, name: string) {
        return name === 'EXT_color_buffer_float' || name === 'EXT_color_buffer_half_float' ? null : original.call(this, name);
      };
    });
    await page.goto(HOME);
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'static', READY);
    await expect(html(page)).toHaveAttribute('data-qi-reason', 'init-failed');
    await expect(html(page)).toHaveClass(/qi-static/);
    await expect(html(page)).not.toHaveAttribute('data-qi-ready', /.*/);
    await expect(page.locator('[data-skip-intro]')).toBeHidden();
    await expect(page.locator('.opening__poster')).toHaveCSS('opacity', '1');
    expect(log.warnings.some((w) => /The qi engine could not start/.test(w)), '掛不上要 warn').toBe(true);
    // 掛載失敗的路徑也要把 GL context 釋放掉
    expect(await page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]')!.getContext('webgl2')?.isContextLost())).toBe(true);
  });
});

// ── RF5：WebGL context 中途遺失 ───────────────────────────────────

test.describe('RF5：context 中途遺失', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const loseContext = (page: Page) =>
    page.evaluate(() => {
      const gl = document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]')!.getContext('webgl2')!;
      gl.getExtension('WEBGL_lose_context')!.loseContext();
    });

  test('引擎 ready 後 loseContext：1 秒內退回靜態圖、不報錯、DOM 文字與連結不變、海報回來、迴圈停止', async ({ page }) => {
    await open(page);
    const before = await domContent(page);
    const beforeFrames = await frames(page);

    await loseContext(page);
    await expect(html(page)).toHaveClass(/qi-static/, { timeout: 1000 });
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'static', { timeout: 1000 });
    await expect(html(page)).toHaveAttribute('data-qi-reason', 'context-lost');
    await expect(html(page)).not.toHaveAttribute('data-qi-ready', /.*/);
    await expect(page.locator('.opening__poster')).toHaveCSS('opacity', '1');
    await expect(page.locator('canvas[data-qi-canvas]')).toBeHidden();

    expect(await domContent(page), 'DOM 文字、連結、標題都不變').toEqual(before);
    expect(await page.evaluate(() => (window as unknown as W).__qi.mode)).toBe('static');

    // 每格迴圈已停（不再算、不再寫屬性）
    const stopped = await frames(page);
    await run(page, 1000);
    expect(await frames(page)).toBe(stopped);
    expect(stopped).toBeGreaterThanOrEqual(beforeFrames);

    // 靜態圖接手：捲到各段、可見的靜態圖都載入
    await expectStillsLoaded(page);
  });

  test('開場演到一半 context 遺失：開場收尾（skipped）、略過鈕收起、連結不變', async ({ page }) => {
    await open(page, { intro: 'fresh' });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await run(page, 1200);
    const before = (await domContent(page)).links;

    await loseContext(page);
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'static', { timeout: 1000 });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'skipped');
    await expect(page.locator('[data-skip-intro]')).toBeHidden();
    expect((await domContent(page)).links).toEqual(before);
  });

  test('焦點正在略過鈕時 context 遺失：焦點移到 main（不掉回 body，鍵盤使用者不必從頭 Tab）、略過鈕收起', async ({ page }) => {
    await open(page, { intro: 'fresh' });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    const skip = page.locator('[data-skip-intro]');
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      if (await skip.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(skip).toBeFocused();

    await loseContext(page);
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'static', { timeout: 1000 });
    await expect(skip).toBeHidden();
    await expect(page.locator('main#main')).toBeFocused();
    // 焦點環不能蓋住整個 main（程式移焦點不該畫出外框）
    expect(await page.locator('main#main').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
    // 接著按 Tab 仍從頁面內容往下走
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement !== document.body && document.activeElement?.closest('main') !== null)).toBe(true);
  });
});

// ── 自動降級時重建失敗（Task 22）──────────────────────────────────
// 降級＝重建 GPGPU，一開始就把舊的 sim 放掉；中途丟錯（顯示卡記憶體不足、著色器編不出來）就沒有東西可畫。
// 停在空白畫布比靜態圖糟：引擎通知首頁、首頁退回靜態圖（reason `tier-failed`），DOM 內容不變。

test.describe('自動降級時重建失敗（tier-failed）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const LOW_HOME = './?qi-tier=low&qi-debug=1';

  test('feedFrameTime 餵慢幀、降級的重建丟錯：退回靜態圖、warn 一次、不報錯、釋放 GL context、DOM 不變、迴圈停止', async ({ page }) => {
    const log = watch(page);
    log.allowWarnings.push(/The qi engine failed while lowering its tier/);
    await open(page, {
      url: LOW_HOME,
      before: (p) =>
        p.addInitScript(() => {
          const proto = WebGL2RenderingContext.prototype;
          const original = proto.createFramebuffer;
          proto.createFramebuffer = function (this: WebGL2RenderingContext) {
            if ((window as unknown as { __failFramebuffers?: boolean }).__failFramebuffers) throw new Error('forced framebuffer failure');
            return original.call(this);
          };
        }),
    });
    await expect(html(page)).toHaveAttribute('data-qi-tier', 'low');
    const before = await domContent(page);

    await page.evaluate(() => {
      (window as unknown as { __failFramebuffers: boolean }).__failFramebuffers = true;
      const { debug } = (window as unknown as W).__qi;
      for (let at = 0; at < 20_000; at += 40) debug.feedFrameTime(40);
    });
    await page.evaluate(() => ((window as unknown as { __failFramebuffers: boolean }).__failFramebuffers = false));

    await expect(html(page)).toHaveAttribute('data-qi-mode', 'static', { timeout: 1000 });
    await expect(html(page)).toHaveAttribute('data-qi-reason', 'tier-failed');
    await expect(html(page)).toHaveClass(/qi-static/);
    await expect(html(page)).not.toHaveAttribute('data-qi-ready', /.*/);
    await expect(page.locator('.opening__poster')).toHaveCSS('opacity', '1');
    await expect(page.locator('canvas[data-qi-canvas]')).toBeHidden();
    expect(await domContent(page), 'DOM 文字、連結、標題都不變').toEqual(before);
    expect(await page.evaluate(() => (window as unknown as W).__qi.mode)).toBe('static');
    expect(log.warnings.filter((w) => /lowering its tier/.test(w)), '只 warn 一次').toHaveLength(1);
    expect(await page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]')!.getContext('webgl2')?.isContextLost())).toBe(true);

    const stopped = await frames(page);
    await run(page, 1000);
    expect(await frames(page)).toBe(stopped);
    await expectStillsLoaded(page);
  });
});

// ── 沒有 JavaScript ───────────────────────────────────────────────

for (const device of DEVICES) {
  test.describe(`沒有 JavaScript：${device.name}`, () => {
    test.use({ javaScriptEnabled: false, viewport: device.viewport });

    test('兩組面板都顯示、每個靜態圖可見；略過鈕、切換鈕隱藏；段落導覽桌機可見、手機不顯示；無水平外溢', async ({ page }) => {
      await page.goto('./');
      await expect(html(page)).not.toHaveClass(/(^|\s)js(\s|$)/);

      // 兩組面板（大人、小孩）的每一門課都顯示
      for (const audience of ['adult', 'kid'] as const) {
        const titles = homeTitles(page, audience);
        expect(await titles.count(), audience).toBe(3);
        for (const title of await titles.all()) await expect(title, audience).toBeVisible();
      }

      // 每個面板（含其他段落）的靜態圖都可見、載入完成
      const panels = page.locator('main .beat__panel');
      const total = await panels.count();
      expect(total).toBeGreaterThanOrEqual(10);
      for (let i = 0; i < total; i++) {
        const still = panels.nth(i).locator('img.beat__still');
        if ((await still.count()) === 0) continue; // 收費課表沒有靜態圖
        await still.scrollIntoViewIfNeeded();
        await expect(still, `面板 #${i}`).toBeVisible();
        await expect.poll(() => still.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), `面板 #${i}`).toBeGreaterThan(0);
      }
      expect(await page.locator('main img.beat__still').count()).toBeGreaterThanOrEqual(11);

      // 段落導覽是錨點連結、不需要 JS：桌機（≥ 60rem）沒有 JS 也看得到，手機不顯示（頁首選單已有頁面連結）
      if (device.viewport.width >= 960) await expect(page.locator('nav.home-rail')).toBeVisible();
      else await expect(page.locator('nav.home-rail')).toBeHidden();
      await expect(page.locator('[data-skip-intro]')).toBeHidden();
      for (const option of await page.locator('[data-audience-option]').all()) await expect(option).toBeHidden();
      await expect(page.locator('canvas[data-qi-canvas]')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });

    test('段落導覽的連結不需 JS：桌機點「預約」「師資」就跳到該段（錨點）；手機沒有這列導覽', async ({ page }) => {
      await page.goto('./');
      const rail = page.getByRole('navigation', { name: '首頁段落' });
      if (device.viewport.width < 960) {
        await expect(rail).toBeHidden();
        return;
      }
      await expect(rail.getByRole('link')).toHaveText(['開場', '課程', '師資', '收費課表', '預約']);
      await rail.getByRole('link', { name: '預約' }).click();
      await expect(page).toHaveURL(/#booking$/);
      await expect(page.locator('#booking')).toBeInViewport();
      await rail.getByRole('link', { name: '師資' }).click();
      await expect(page).toHaveURL(/#coaches$/);
      await expect(page.locator('#coaches')).toBeInViewport();
    });

    test('「看這門課」進入課程頁；「預約體驗」的 href 是 #line，點了看到 LINE QR', async ({ page, baseURL }) => {
      await page.goto('./');

      const bookings = page.getByRole('link', { name: '預約體驗' });
      expect(await bookings.count()).toBeGreaterThanOrEqual(2);
      for (const link of await bookings.all()) await expect(link).toHaveAttribute('href', '#line');

      const booking = page.locator('#booking a.button--solid');
      await booking.scrollIntoViewIfNeeded();
      await booking.click();
      await expect(page).toHaveURL(/#line$/);
      await expect(page.locator('#line').getByRole('img', { name: /LINE/ })).toBeVisible();

      await page.goto('./');
      const course = page.getByRole('link', { name: /^看這門課/ }).first();
      await course.scrollIntoViewIfNeeded();
      await course.click();
      await expect(page).toHaveURL(new RegExp(`${basePath(baseURL)}courses/[^/]+/$`));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  });
}

// ── 無障礙 ────────────────────────────────────────────────────────

test.describe('無障礙', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('canvas aria-hidden 且不可聚焦；切換鈕有 aria-pressed；靜態圖 alt 為空字串', async ({ page }) => {
    await open(page);
    const canvas = page.locator('canvas[data-qi-canvas]');
    await expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(await canvas.evaluate((el: HTMLCanvasElement) => ({ tabIndex: el.tabIndex, hasTabindexAttr: el.hasAttribute('tabindex') }))).toEqual({ tabIndex: -1, hasTabindexAttr: false });

    const adult = page.getByRole('button', { name: '大人' });
    const kid = page.getByRole('button', { name: '小孩' });
    await expect(adult).toHaveAttribute('aria-pressed', 'true');
    await expect(kid).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#courses').scrollIntoViewIfNeeded();
    await kid.click();
    await expect(kid).toHaveAttribute('aria-pressed', 'true');
    await expect(adult).toHaveAttribute('aria-pressed', 'false');

    const alts = await page.locator('main img.beat__still, .opening__poster img').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('alt')));
    expect(alts.length).toBeGreaterThanOrEqual(12);
    expect(alts.every((alt) => alt === '')).toBe(true);
  });

  test('Tab 序：跳到主要內容 → 頁首 →〔略過〕→ 切換鈕 → … → 預約按鈕，沒有陷阱、不經過 canvas', async ({ page }) => {
    await open(page, { intro: 'fresh' });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');

    const rank = { 'skip-link': 0, header: 1, 'skip-intro': 2, switch: 3, content: 4, booking: 5 } as const;
    const stops: { region: keyof typeof rank; text: string; index: number; tag: string }[] = [];
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const region = el.matches('a.skip-link')
          ? 'skip-link'
          : el.closest('header')
            ? 'header'
            : el.matches('[data-skip-intro]')
              ? 'skip-intro'
              : el.closest('.audience-switch')
                ? 'switch'
                : el.closest('#booking')
                  ? 'booking'
                  : el.closest('main')
                    ? 'content'
                    : 'other';
        return { region, text: (el.textContent ?? '').trim().slice(0, 14), index: Array.from(document.querySelectorAll('*')).indexOf(el), tag: el.tagName };
      });
      expect(stop, `第 ${i + 1} 次 Tab 後焦點落在文件裡`).not.toBeNull();
      expect(stop!.region, `「${stop!.text}」在預期的區域內`).not.toBe('other');
      stops.push(stop! as (typeof stops)[number]);
      if (stop!.region === 'booking' && stop!.text === '預約體驗') break;
    }

    const last = stops.at(-1)!;
    expect(last, '走得到預約按鈕').toMatchObject({ region: 'booking', text: '預約體驗' });
    expect(stops[0], '第一站是「跳到主要內容」').toMatchObject({ region: 'skip-link', text: '跳到主要內容' });
    // 區域依序前進，不倒退
    const ranks = stops.map((s) => rank[s.region]);
    expect(ranks, '區域順序').toEqual([...ranks].sort((a, b) => a - b));
    expect(stops.filter((s) => s.region === 'skip-intro'), '略過鈕在頁首之後、切換鈕之前，恰一站').toHaveLength(1);
    expect(stops.filter((s) => s.region === 'switch').map((s) => s.text), '切換鈕兩顆').toEqual(['大人', '小孩']);
    expect(stops.filter((s) => s.region === 'header').length, '頁首有導覽連結').toBeGreaterThanOrEqual(5);
    // 沒有陷阱：沒有重複的元素、沒有 canvas
    expect(new Set(stops.map((s) => s.index)).size, '每一站都是不同的元素').toBe(stops.length);
    expect(stops.some((s) => s.tag === 'CANVAS')).toBe(false);

    // 預約按鈕之後還能繼續往前、也能退回來
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('#booking') !== null && document.activeElement?.matches('a.button--solid'))).toBe(false);
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#booking a.button--solid')).toBeFocused();
  });
});

// ── 引擎接線補強 ──────────────────────────────────────────────────

test.describe('引擎接線補強', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('每格迴圈丟錯一次：錯誤照常冒出，但迴圈不停擺（frame 持續增加、之後捲動仍換姿勢）', async ({ page }) => {
    const log = await open(page, {
      before: (p) =>
        p.addInitScript(() => {
          const original = Object.getOwnPropertyDescriptor(window, 'scrollY')!;
          Object.defineProperty(window, 'scrollY', {
            configurable: true,
            get() {
              if ((window as unknown as { __boom?: boolean }).__boom) {
                (window as unknown as { __boom?: boolean }).__boom = false;
                throw new Error('boom: scrollY');
              }
              return original.get!.call(window) as number;
            },
          });
        }),
    });
    log.allowErrors.push(/boom: scrollY/);

    await page.evaluate(() => ((window as unknown as { __boom?: boolean }).__boom = true));
    // 假時鐘在 runFor 裡跑 rAF 回呼，回呼丟的錯會直接讓 runFor reject（真瀏覽器則是 pageerror）；兩者擇一冒出、且只丟一次
    const thrown = await run(page, 100).then(
      () => '',
      (error: unknown) => String(error),
    );
    expect(thrown + log.errors.join('\n'), '錯誤照常冒出').toMatch(/boom: scrollY/);
    expect((thrown.match(/boom: scrollY/g) ?? []).length + log.errors.filter((e) => /boom: scrollY/.test(e)).length, '剛好丟了一次').toBe(1);

    const afterThrow = await frames(page);
    await run(page, 500);
    expect(await frames(page), '丟錯之後迴圈仍在跑').toBeGreaterThan(afterThrow + 5);
    await scrollToBeat(page, 'combat-a');
    await run(page, 300);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'chengchui');
  });

  test('RF1 邊角：第一個姿勢還在載入時視窗大小變了，載入完成後仍會重新取景', async ({ page }) => {
    watch(page);
    let releaseShapes!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseShapes = resolve;
      setTimeout(resolve, 30_000);
    });
    await page.route(/\.bin(\?.*)?$/, async (route) => {
      await gate;
      await route.continue();
    });
    await page.addInitScript(() => sessionStorage.setItem('liuyi:qi-intro', '1'));
    await page.goto(HOME);
    // 引擎 chunk 到了、掛上（畫布從預設的 300 被設成 CSS 大小），但形體還沒到
    await expect.poll(() => canvasSizes(page).then((s) => s.buffer), READY).not.toBe(300);
    await expect(html(page)).not.toHaveAttribute('data-qi-ready', /.*/);

    await resizeTo(page, 1100, 900);
    releaseShapes();
    await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
    const sizes = await canvasSizes(page);
    expect(sizes.buffer, '引擎的取景要跟著現在的畫布大小（不是掛上當時的）').toBe(sizes.css);
    expect(sizes.css).toBeLessThan(1440);
  });

  test('後續姿勢載入失敗：warn 一次（不靜默）、留在原姿勢、不每格重發請求；其他姿勢照常換', async ({ page }) => {
    const log = watch(page);
    log.allowErrors.push(/Failed to load resource/);
    log.allowWarnings.push(/dingzhou/);
    const hits: string[] = [];
    await page.route(/dingzhou[^/]*\.bin(\?.*)?$/, (route) => {
      hits.push(route.request().url());
      return route.abort();
    });
    await open(page);

    await scrollToBeat(page, 'fist');
    await run(page, 300);
    await expect.poll(() => log.warnings.filter((w) => /dingzhou/.test(w)).length, { timeout: 10_000 }).toBe(1);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'land'); // 留在原姿勢
    await expect(html(page)).toHaveAttribute('data-qi-beat', 'fist');

    const requestsSoFar = hits.length;
    const framesSoFar = await frames(page);
    await run(page, 3000); // 幾十格
    expect(await frames(page)).toBeGreaterThan(framesSoFar + 20);
    expect(hits.length, '失敗後不再每格重發請求').toBe(requestsSoFar);
    expect(log.warnings.filter((w) => /dingzhou/.test(w)), '只 warn 一次').toHaveLength(1);

    await scrollToBeat(page, 'combat-a');
    await run(page, 300);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'chengchui');
  });

  const dispatchPageEvent = (page: Page, type: 'pagehide' | 'pageshow', persisted: boolean) =>
    page.evaluate(([name, flag]) => window.dispatchEvent(new PageTransitionEvent(name as string, { persisted: flag as boolean })), [type, persisted] as const);
  const uTimeOf = (page: Page) => page.evaluate(() => (window as unknown as W).__qi.debug.uniforms().uTime!);

  test('bfcache（pagehide／pageshow persisted）：引擎保留；回來時重設時間戳與捲動（速度不暴衝）、迴圈繼續；之後 context 被收走仍退回靜態圖', async ({ page }) => {
    await open(page);
    const speedOf = () => page.evaluate(() => (window as unknown as W).__qi.debug.uniforms().uScrollSpeed!);

    await dispatchPageEvent(page, 'pagehide', true);
    const t0 = await uTimeOf(page);
    await run(page, 300);
    expect(await uTimeOf(page), 'bfcache：引擎保留，時間照走').toBeGreaterThan(t0);
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'webgl');

    // 凍結期間捲動位置變了（瀏覽器還原捲動）：回來的第一格不能把「一大段位移 ÷ 很短的 dt」當成捲動速度
    await scrollToY(page, 3000);
    await dispatchPageEvent(page, 'pageshow', true);
    await run(page, 16);
    expect(await speedOf(), 'pageshow 重設了上一格的捲動位置').toBeLessThan(0.5);
    const f0 = await frames(page);
    await run(page, 300);
    expect(await frames(page), 'pageshow 之後迴圈繼續').toBeGreaterThan(f0);
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'webgl');

    // 回來之後 context 若被瀏覽器收走，一樣退回靜態圖
    await page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]')!.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext());
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'static', { timeout: 1000 });
    await expect(html(page)).toHaveAttribute('data-qi-reason', 'context-lost');
  });

  test('pagehide（!persisted，真的離開）：走 enterStatic——引擎與 GL context 釋放、不留下一張死掉的畫布（頁面若又顯示，看到的是靜態圖）', async ({ page }) => {
    await open(page);
    await dispatchPageEvent(page, 'pagehide', false);
    await expect(html(page)).toHaveClass(/qi-static/);
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'static');
    await expect(html(page)).toHaveAttribute('data-qi-reason', 'page-hide');
    await expect(html(page)).not.toHaveAttribute('data-qi-ready', /.*/);
    await expect(page.locator('canvas[data-qi-canvas]')).toBeHidden();
    await expect(page.locator('.opening__poster')).toHaveCSS('opacity', '1');

    const t1 = await uTimeOf(page);
    const f1 = await frames(page);
    await run(page, 1000);
    expect(await uTimeOf(page), '引擎已釋放，不再前進').toBe(t1);
    expect(await frames(page), '每格迴圈也停了').toBe(f1);
    expect(await page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]')!.getContext('webgl2')?.isContextLost())).toBe(true);
    await expectStillsLoaded(page);
  });
});
