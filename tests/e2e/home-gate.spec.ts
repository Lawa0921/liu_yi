import { expect, test, type Page } from '@playwright/test';
import type { QiDebug } from '../../src/qi/engine/qi-stage';
import { GATE_FADE_MS, GATE_SAFETY_MS } from '../../src/scripts/home/gate';

// 入館閘門（Task 25，使用者要求「進入頁面時應該要做一個點擊進入首頁的效果」）：
//   - 顯示條件：首次進站才擋；無 JS、減少動態、無 WebGL／引擎掛不上、再訪、站內其他頁來、帶 #錨點都不擋。
//   - 閘門（Task 28 起是低調的武館大門）：role=dialog、aria-modal、aria-label="入館"；焦點在「入館」按鈕；背景 inert；html 不得捲動；閘門期間畫面上沒有光點。
//   - 進入：點按鈕、點門或按 Enter／空白鍵 → 開門、推進、淡出（整段 GATE_FADE_MS ≤ 1.6 s）→ 還原捲動與 inert、焦點到 main → 開場才開始（從氣流直接吸氣）。
//   - 任何退出路徑都要還原（引擎掛不上、context 遺失、腳本載不到）。
// 本檔直接用 `@playwright/test` 的 test（不預先標記「進過館」）。headless 的 WebGL 是軟體繪製：引擎一律 ?qi-tier=min&qi-debug=1；
// 要看時間的測試用假時鐘（只有 runFor 會推進）。只用 page.*，不碰 OS 層級的滑鼠鍵盤。
test.describe.configure({ mode: 'default', timeout: 120_000 });

const HOME = './?qi-tier=min&qi-debug=1';
const T0 = new Date('2026-01-01T08:00:00');
const T1 = new Date('2026-01-01T09:00:00');
const READY = { timeout: 30_000 };
const KNOWN_WARNING = /GPU stall due to ReadPixels/;
const STORAGE_KEY = 'liuyi:qi-intro';

type W = { __qi: { ready: boolean; mode: string; debug: QiDebug } };

const seen = new WeakMap<Page, { errors: string[]; warnings: string[] }>();
function watch(page: Page): void {
  const log = { errors: [] as string[], warnings: [] as string[] };
  seen.set(page, log);
  page.on('pageerror', (error) => log.errors.push(`pageerror: ${error}`));
  page.on('console', (message) => {
    if (message.type() === 'error') log.errors.push(`console.error: ${message.text()}`);
    if (message.type() === 'warning') log.warnings.push(`console.warning: ${message.text()}`);
  });
}
test.afterEach(async ({ page }) => {
  const log = seen.get(page);
  if (!log) return;
  expect(log.errors, '頁面全程不得有 pageerror 或 console.error').toEqual([]);
  expect(log.warnings.filter((w) => !KNOWN_WARNING.test(w)), '頁面全程不得有 console.warning').toEqual([]);
});

const html = (page: Page) => page.locator('html');
const run = (page: Page, ms: number) => page.clock.runFor(ms);
const enterButton = (page: Page) => page.locator('[data-gate-enter]');
const introT = (page: Page) => page.evaluate(() => (window as unknown as W).__qi.debug.uniforms().uIntroT!);
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

/** 沒有 WebGL 的裝置：任何 webgl／webgl2 的 getContext 都回 null。 */
const blockWebGL = (page: Page) =>
  page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (/webgl/i.test(type)) return null;
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });

interface OpenOptions {
  url?: string;
  /** 假時鐘：先裝上、ready 後停住（之後只有 `run` 會推進）。 */
  clock?: boolean;
  /** 導覽之前要做的事。 */
  before?: (page: Page) => Promise<unknown>;
  /** 預設等引擎 ready（閘門後面照常載入）；false 時只等頁面載入。 */
  waitReady?: boolean;
}

/** 開首頁（新 context＝第一次進站，閘門擋著）、等引擎在閘門後面 ready。 */
async function open(page: Page, options: OpenOptions = {}): Promise<void> {
  watch(page);
  loadedShapes.set(page, []);
  page.on('requestfinished', (request) => {
    if (request.url().endsWith('.bin')) loadedShapes.get(page)!.push(request.url());
  });
  await options.before?.(page);
  if (options.clock) await page.clock.install({ time: T0 });
  await page.goto(options.url ?? HOME);
  if (options.waitReady !== false) {
    await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
    if (options.clock) await page.clock.pauseAt(T1);
  }
}

/** 閘門期間預取的 land、lift 兩個形體都已載完（真實網路，不受假時鐘控制）。 */
const loadedShapes = new WeakMap<Page, string[]>();
const shapesLoaded = (page: Page) =>
  // 從 Node 端輪詢（page.waitForFunction 在頁面裡用 rAF 輪詢，假時鐘停住時不會動）；open() 掛的 requestfinished 記下完成的 .bin
  expect.poll(() => ['land', 'lift'].every((id) => (loadedShapes.get(page) ?? []).some((url) => url.includes(`/${id}.`))), { timeout: 30_000, message: 'land、lift 兩個形體都載完' }).toBe(true);

// ── 閘門的樣子與語意 ───────────────────────────────────────────────

for (const device of [
  { name: '桌機 1440×900', viewport: { width: 1440, height: 900 } },
  { name: '手機 390×844', viewport: { width: 390, height: 844 } },
]) {
  test.describe(`第一次進站：閘門擋著（${device.name}）`, () => {
    test.use({ viewport: device.viewport });

    test('role=dialog、aria-modal、aria-label="入館"；焦點在「入館」按鈕；背景 inert；html 不可捲動；開場還沒開始', async ({ page }) => {
      await open(page);
      await expect(html(page)).toHaveAttribute('data-gate', 'open');
      const dialog = page.getByRole('dialog', { name: '入館' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await expect(dialog).toHaveAttribute('aria-label', '入館');
      const button = enterButton(page);
      await expect(button).toBeVisible();
      await expect(button).toHaveText('入館');
      await expect(button).toBeFocused();

      // 背景：body 底下閘門以外的內容都是 inert（不可聚焦、不進無障礙樹）；閘門自己不是
      const inert = await page.evaluate(() => {
        const gate = document.querySelector('[data-gate-dialog]');
        const backdrop = document.querySelector('[data-gate-backdrop]');
        return [...document.body.children]
          .filter((el): el is HTMLElement => el instanceof HTMLElement && !['SCRIPT', 'STYLE', 'LINK'].includes(el.tagName))
          .map((el) => ({ tag: el.tagName, cls: el.className, inert: el.inert, gate: el === gate || el === backdrop }));
      });
      for (const item of inert) expect(item.inert, `${item.tag}.${item.cls}`).toBe(item.gate ? false : true);
      expect(inert.some((item) => item.tag === 'MAIN' && item.inert), 'main 是 inert').toBe(true);

      // html 不可捲動（overflow:hidden）；滾輪與鍵盤都捲不動
      expect(await html(page).evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden');
      await page.mouse.wheel(0, 1200);
      await page.keyboard.press('PageDown');
      expect(await scrollY(page), '閘門期間不捲動').toBe(0);

      // 引擎在閘門後面照常 ready、停在氣流（flow，藏在背板後面）；開場還沒開始
      await expect(html(page)).toHaveAttribute('data-qi-pose', 'flow');
      await expect(html(page)).not.toHaveAttribute('data-qi-intro', /.*/);
      expect(await introT(page), '引擎的開場計時還沒起算').toBe(-1);
      await expect(page.locator('[data-skip-intro]')).toBeHidden();
    });

    test('疊放與畫面：背板 200 不透明、對話框 202；閘門期間畫布留在背板底下、畫面上沒有光點；武館大門三層圖都已載入、置中、對齊；按鈕在門前、在視窗內', async ({ page }) => {
      await open(page);
      const layers = await page.evaluate(() => {
        const z = (selector: string) => Number.parseInt(getComputedStyle(document.querySelector(selector)!).zIndex, 10);
        const backdrop = document.querySelector('[data-gate-backdrop]')!;
        return {
          backdrop: z('[data-gate-backdrop]'),
          canvas: z('canvas[data-qi-canvas]'),
          dialog: z('[data-gate-dialog]'),
          backdropBg: getComputedStyle(backdrop).backgroundColor,
          dialogBg: getComputedStyle(document.querySelector('[data-gate-dialog]')!).backgroundColor,
        };
      });
      expect(layers.backdrop).toBe(200);
      expect(layers.canvas, '畫布不抬到閘門之上').toBeLessThan(layers.backdrop);
      expect(layers.dialog).toBe(202);
      expect(layers.backdropBg, '背板是不透明的黑底').toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      expect(layers.dialogBg, '對話框本身透明').toBe('rgba(0, 0, 0, 0)');
      expect(await page.locator('.gate__crest-img, [data-gate-dialog] [data-crest]').count(), '舊的閘門館徽（兩張 <img>）已拿掉').toBe(0);

      // 門的樣式表（gate.css）由 <head> 的行內腳本插入、標 blocking="render"，而且已經套用
      const sheet = await page.evaluate(() => {
        const link = document.querySelector<HTMLLinkElement>('head link[rel="stylesheet"][href*="/gate."]');
        return { found: !!link, blocking: link?.getAttribute('blocking') ?? null, loaded: !!link?.sheet };
      });
      expect(sheet).toEqual({ found: true, blocking: 'render', loaded: true });

      // 門的三層圖（門框與牆、左右門扇）都載入了，載完場景才淡入
      const door = page.locator('[data-gate-door]');
      for (const layer of ['.gate__frame', '.gate__leaf--left', '.gate__leaf--right']) {
        await expect.poll(() => page.locator(layer).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), { message: `${layer} 載入` }).toBeGreaterThan(0);
      }
      await expect(door).toHaveAttribute('data-ready', '');
      await expect.poll(() => door.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

      const boxes = await page.evaluate(() => {
        const box = (selector: string) => {
          const r = document.querySelector(selector)!.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        };
        return {
          gate: box('[data-gate-dialog]'),
          door: box('.gate__door'),
          left: box('.gate__leaf--left'),
          right: box('.gate__leaf--right'),
          plaque: box('.gate__plaque'),
          button: box('[data-gate-enter]'),
          view: { w: window.innerWidth, h: window.innerHeight },
        };
      });
      // 閘門（fixed、inset:0）比視窗窄一個捲軸寬（≤ 20px，經典捲軸的裝置；scrollbar-gutter 保留捲軸的位置）
      expect(boxes.gate.width, '閘門蓋滿視窗（只讓出捲軸的位置）').toBeGreaterThanOrEqual(boxes.view.w - 20);
      expect(boxes.gate.height, '閘門蓋滿視窗高').toBeGreaterThanOrEqual(boxes.view.h - 1);
      const gateCenter = (boxes.gate.left + boxes.gate.right) / 2;
      expect(Math.abs((boxes.door.left + boxes.door.right) / 2 - gateCenter), '門大致置中（門洞在圖上偏右 1%）').toBeLessThanOrEqual(boxes.gate.width * 0.03);
      expect(boxes.door.left, '門完整：左緣在視窗內').toBeGreaterThanOrEqual(0);
      expect(boxes.door.right, '門完整：右緣在視窗內').toBeLessThanOrEqual(boxes.gate.right);
      expect(boxes.door.top, '門完整：上緣在視窗內').toBeGreaterThanOrEqual(0);
      expect(boxes.door.bottom, '門完整：下緣在視窗內').toBeLessThanOrEqual(boxes.view.h);
      expect(boxes.door.width, '門夠大（≥ 視窗寬的 35%）').toBeGreaterThanOrEqual(boxes.view.w * 0.35);
      // 兩扇門在門縫上接合：左扇右緣＝右扇左緣，上下對齊門洞
      expect(Math.abs(boxes.left.right - boxes.right.left), '門縫對齊').toBeLessThanOrEqual(1);
      expect(Math.abs(boxes.left.left - boxes.door.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(boxes.right.right - boxes.door.right)).toBeLessThanOrEqual(1);
      for (const leaf of [boxes.left, boxes.right]) {
        expect(Math.abs(leaf.top - boxes.door.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(leaf.bottom - boxes.door.bottom)).toBeLessThanOrEqual(1);
      }
      expect(boxes.plaque.top, '匾在視窗內').toBeGreaterThanOrEqual(0);
      // 構圖：門在畫面垂直的中間附近；匾到按鈕這一組不偏上也不偏下（手機直式不留一大片上方空白）、按鈕緊接在門下（台階前）
      expect(Math.abs((boxes.door.top + boxes.door.bottom) / 2 - boxes.view.h / 2), '門大致垂直置中').toBeLessThanOrEqual(boxes.view.h * 0.06);
      const above = boxes.plaque.top;
      const below = boxes.view.h - boxes.button.bottom;
      expect(Math.abs(above - below), '匾上方與按鈕下方的留白差不多').toBeLessThanOrEqual(boxes.view.h * 0.12);
      expect(boxes.button.top - boxes.door.bottom, '按鈕靠近門（台階前）').toBeLessThanOrEqual(boxes.view.h * 0.12);
      expect(boxes.plaque.bottom, '匾在門的上方').toBeLessThanOrEqual(boxes.door.top);
      await expect(page.locator('.gate__plaque')).toHaveText('六藝武術');
      // 匾正中的燙金館徽：用開場區館徽的同一個檔案（已載入），在匾的範圍內、清楚可辨（≥ 44px 寬）
      const crest = page.locator('[data-gate-crest]');
      await expect.poll(() => crest.evaluate((el) => getComputedStyle(el).backgroundImage), { message: '館徽圖設好了' }).toMatch(/crest-lion[^"]*\.webp/);
      const crestInfo = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('[data-gate-crest]')!;
        const url = /url\("?([^")]+)"?\)/.exec(getComputedStyle(el).backgroundImage)![1]!;
        const opening = document.querySelector<HTMLImageElement>('.opening__crest-img')!;
        const r = el.getBoundingClientRect();
        return { url, opening: opening.currentSrc, sheen: getComputedStyle(el, '::after').animationName, box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width } };
      });
      if (crestInfo.opening) expect(crestInfo.url, '與開場區館徽同一個檔案（快取命中）').toBe(crestInfo.opening);
      expect(crestInfo.sheen, '金屬掃光').toBe('crest-sweep');
      expect(crestInfo.box.width, '館徽清楚可辨').toBeGreaterThanOrEqual(44);
      expect(crestInfo.box.left).toBeGreaterThanOrEqual(boxes.plaque.left);
      expect(crestInfo.box.right).toBeLessThanOrEqual(boxes.plaque.right);
      expect(crestInfo.box.top, '館徽在匾的範圍內（上下可略出 4px）').toBeGreaterThanOrEqual(boxes.plaque.top - 4);
      expect(crestInfo.box.bottom).toBeLessThanOrEqual(boxes.plaque.bottom + 4);
      expect(Math.abs((crestInfo.box.left + crestInfo.box.right) / 2 - (boxes.plaque.left + boxes.plaque.right) / 2), '館徽在匾的正中').toBeLessThanOrEqual(2);
      expect(Math.abs((boxes.button.left + boxes.button.right) / 2 - gateCenter), '按鈕水平置中').toBeLessThanOrEqual(1);
      expect(boxes.button.top, '按鈕在門的下方（門前或門檻下）').toBeGreaterThanOrEqual(boxes.door.bottom - 1);
      expect(boxes.button.height, '按鈕夠大（≥ 44px）').toBeGreaterThanOrEqual(44);
      expect(boxes.button.bottom, '按鈕在視窗內').toBeLessThanOrEqual(boxes.view.h);

      // 閘門期間畫面上沒有任何光點：引擎在背板後面照常跑（畫布讀回有內容），但截圖量不到光點——
      // 把畫面的門與按鈕藏起來只看背板，亮點（亮度 > 60）的像素數必須是 0
      const covered = await page.evaluate(() => (window as unknown as W).__qi.debug.snapshot().covered);
      expect(covered, '引擎在背後照常畫（只是被背板擋住）').toBeGreaterThan(0.0005);
      await page.addStyleTag({ content: '[data-gate-dialog] { visibility: hidden !important; }' });
      const bright = await brightPixels(page);
      expect(bright, '閘門期間背板上沒有任何光點').toBe(0);
    });
  });
}

/** 截圖、數亮度 > 60 的像素（在頁面裡用 canvas 解 PNG）。 */
async function brightPixels(page: Page): Promise<number> {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < px.length; i += 4) if (0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]! > 60) count++;
    return count;
  }, png);
}

test.describe('武館大門的互動', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('一進站門是關的、按鈕有看得見的焦點（細框、不是金色填滿）；指到門上門扇微開（rotateY 1–4 度）、門縫透光；用鍵盤 Tab 回到按鈕也一樣', async ({ page }) => {
    await open(page);
    const leafAngle = (side: 'left' | 'right') =>
      page.locator(`.gate__leaf--${side}`).evaluate((el) => {
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        return (Math.atan2(-m.m13, m.m11) * 180) / Math.PI;
      });
    const seam = () => page.locator('.gate__door').evaluate((el) => Number(getComputedStyle(el, '::after').opacity));
    await expect(page.locator('[data-gate-door]')).toHaveAttribute('data-ready', '');
    await expect(enterButton(page)).toBeFocused();
    const focusStyle = await enterButton(page).evaluate((el) => ({
      visible: el.matches(':focus-visible'),
      outline: getComputedStyle(el).outlineStyle,
      outlineWidth: Number.parseFloat(getComputedStyle(el).outlineWidth),
      fill: new DOMMatrixReadOnly(getComputedStyle(el, '::before').transform).a,
    }));
    expect(focusStyle.visible, '一進站的焦點看得見（WCAG 2.4.7）').toBe(true);
    expect(focusStyle.outline, '焦點是細框').not.toBe('none');
    expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(1);
    expect(focusStyle.fill, '不是 .button 的金色填滿（門口保持安靜）').toBe(0);
    expect(await leafAngle('left'), '一進站的焦點不讓門動：門是關的').toBeCloseTo(0, 3);
    expect(await seam()).toBe(0);

    const box = (await page.locator('.gate__door').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => leafAngle('left')).toBeGreaterThan(1);
    await expect.poll(() => seam()).toBeGreaterThan(0.9);
    const left = await leafAngle('left');
    const right = await leafAngle('right');
    expect(left, '左扇向內微開，不誇張').toBeLessThanOrEqual(4);
    expect(right, '右扇向內微開（反方向）').toBeLessThan(-1);
    expect(right).toBeGreaterThanOrEqual(-4);

    // 移開：門回到關著
    await page.mouse.move(5, 5);
    await expect.poll(() => leafAngle('left')).toBeCloseTo(0, 1);
    // 鍵盤：Shift+Tab 再 Tab 回到按鈕（焦點只會在閘門裡繞）：用鍵盤操作過之後，按鈕 focus-visible 時門一樣微開
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(enterButton(page)).toBeFocused();
    expect(await enterButton(page).evaluate((el) => el.matches(':focus-visible'))).toBe(true);
    await expect.poll(() => leafAngle('left')).toBeGreaterThan(1);
  });

  test('點門也能進入：開門過程中兩扇門向內轉（rotateY 左正右負）、場景往前推；整段 GATE_FADE_MS（≤ 1.6 s）後收起、開場開始', async ({ page }) => {
    await open(page, { clock: true });
    await expect(page.locator('[data-gate-door]')).toHaveAttribute('data-ready', '');
    expect(GATE_FADE_MS).toBeLessThanOrEqual(1600);
    const box = (await page.locator('.gate__door').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await expect(html(page)).toHaveAttribute('data-gate', 'leaving');

    // CSS 的 transition 走真實時間（假時鐘只管計時器）：等門扇轉到明顯的角度
    const angles = () =>
      page.evaluate(() => {
        const angle = (selector: string) => {
          const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector(selector)!).transform);
          return (Math.atan2(-m.m13, m.m11) * 180) / Math.PI;
        };
        return { left: angle('.gate__leaf--left'), right: angle('.gate__leaf--right'), scale: new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.gate__scene')!).transform).a };
      });
    await expect.poll(async () => (await angles()).left, { message: '左扇向內打開' }).toBeGreaterThan(20);
    const mid = await angles();
    expect(mid.right, '右扇向內打開（反方向）').toBeLessThan(-20);
    expect(mid.scale, '場景往前推').toBeGreaterThan(1);
    await expect.poll(async () => (await angles()).left, { message: '開到底（約 80 度）' }).toBeGreaterThan(75);

    await run(page, GATE_FADE_MS - 1);
    await expect(html(page)).toHaveAttribute('data-gate', 'leaving');
    await run(page, 2);
    await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    expect(await scrollY(page)).toBe(0);
    expect(await page.evaluate(() => [...document.querySelectorAll('[inert]')].length)).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('MAIN');
  });
});

// ── 進入 ──────────────────────────────────────────────────────────

test.describe('進入閘門', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('點「入館」：開門、推進、淡出（整段 GATE_FADE_MS ≤ 1.6 s，差 1 ms 時還在進行、之後收起）→ 還原捲動與 inert、焦點到 main（不捲動）→ 開場才開始（從氣流吸氣，計時 ≥ 1.0）', async ({ page }) => {
    await open(page, { clock: true });
    expect(GATE_FADE_MS).toBeLessThanOrEqual(1600);
    await enterButton(page).click();
    await expect(html(page), '淡出中').toHaveAttribute('data-gate', 'leaving');
    expect(await html(page).evaluate((el) => getComputedStyle(el).overflow), '淡出中仍不可捲動').toBe('hidden');
    await expect(html(page)).not.toHaveAttribute('data-qi-intro', /.*/); // 閘門淡出之後才開始開場
    expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY), '一按就記：進過館').toBe('1');
    // 站名組在門後不演：開門、淡出中仍是 animation:none、不透明度 0（CSS 走真實時間：等到淡出已經開始）
    const lockup = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.opening__lockup > *')].map((el) => ({ name: getComputedStyle(el).animationName, opacity: getComputedStyle(el).opacity })),
      );
    await page.waitForTimeout(1100);
    const behind = await lockup();
    expect(behind.length).toBeGreaterThan(0);
    for (const item of behind) expect(item, '閘門還在：站名組不演、不顯示').toEqual({ name: 'none', opacity: '0' });

    await run(page, GATE_FADE_MS - 1);
    await expect(html(page), '還沒到淡出結束').toHaveAttribute('data-gate', 'leaving');
    await run(page, 2);
    await expect(html(page), '淡出結束：閘門收起').not.toHaveAttribute('data-gate', /.*/);
    expect(await html(page).evaluate((el) => getComputedStyle(el).overflow), '還原捲動').not.toBe('hidden');
    await expect(page.locator('[data-gate-dialog]')).toBeHidden();
    for (const item of await lockup()) expect(item.name, '閘門收起才演站名組的進場').not.toBe('none');
    expect(await page.evaluate(() => [...document.querySelectorAll('[inert]')].length), '背景的 inert 都拿掉了').toBe(0);
    const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id, y: window.scrollY }));
    expect(focus, '焦點在 main、沒有捲動').toEqual({ tag: 'MAIN', id: 'main', y: 0 });

    // 開場此刻才開始：從氣流直接吸氣（計時從 1.0 起算），略過鈕出現
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await expect.poll(() => introT(page)).toBeGreaterThanOrEqual(1);
    await expect(page.locator('[data-skip-intro]')).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('canvas[data-qi-canvas]')!).zIndex), '畫布回到內容底下').toBe('0');
    // 約 2.5 s 後演完（落地 2.7 s 的那一刻館徽擦出）
    await run(page, 1800);
    await expect(html(page)).toHaveAttribute('data-qi-crest', 'in');
    await run(page, 1000);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'done');
  });

  test('按 Enter、按空白鍵都能進入（焦點在按鈕上，或焦點掉到別處時）', async ({ page }) => {
    await open(page, { clock: true });
    await expect(enterButton(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(html(page)).toHaveAttribute('data-gate', 'leaving');
    await run(page, GATE_FADE_MS + 50);
    await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);

    // 空白鍵：新的一次進站（同一個 context，把標記清掉重載）
    await page.evaluate((key) => sessionStorage.removeItem(key), STORAGE_KEY);
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-gate', 'open');
    await expect(enterButton(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(html(page)).toHaveAttribute('data-gate', 'leaving');
    await run(page, GATE_FADE_MS + 50);
    await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);

    // 焦點掉到別處（點了背板）：Enter 仍然進得去，而且按鍵不會捲動頁面
    await page.evaluate((key) => sessionStorage.removeItem(key), STORAGE_KEY);
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-gate', 'open');
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.keyboard.press('Space');
    await expect(html(page)).toHaveAttribute('data-gate', 'leaving');
    expect(await scrollY(page), '空白鍵沒有把頁面捲走').toBe(0);
  });

  test('閘門期間 Tab 出不去（背景 inert）、Esc 不會略過開場；進入後 Tab 的第一站是「略過」鈕', async ({ page }) => {
    await open(page, { clock: true });
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      const where = await page.evaluate(() => {
        const el = document.activeElement;
        return { inGate: !!el?.closest('[data-gate-dialog]'), body: el === document.body };
      });
      expect(where.inGate || where.body, `第 ${i + 1} 次 Tab 後焦點仍在閘門內（或離開頁面進到瀏覽器介面）`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(html(page), '閘門期間 Esc 沒有略過一個還沒開始的開場').toHaveAttribute('data-gate', 'open');
    await expect(html(page)).not.toHaveAttribute('data-qi-intro', /.*/);

    await enterButton(page).focus();
    await page.keyboard.press('Enter');
    await run(page, GATE_FADE_MS + 100);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-skip-intro]'), '焦點在 main 時，下一個可聚焦的就是「略過」鈕').toBeFocused();
  });

  test('進入後：略過與 Esc 照常可用；滾輪可以捲動（捲走開場就收尾）', async ({ page }) => {
    await open(page, { clock: true });
    await enterButton(page).click();
    await run(page, GATE_FADE_MS + 100);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await run(page, 500);
    await page.locator('[data-skip-intro]').click();
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'skipped');
    await expect(html(page)).toHaveAttribute('data-qi-crest', 'shown');

    await page.mouse.wheel(0, 700);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(300);
  });

  test('再訪（同一個工作階段）：重新載入不再有閘門、不演開場，館徽直接是終態', async ({ page }) => {
    await open(page, { clock: true });
    await enterButton(page).click();
    await run(page, GATE_FADE_MS + 100);
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
    await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);
    await expect(page.locator('[data-gate-dialog]')).toBeHidden();
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'skipped');
    await expect(html(page)).toHaveAttribute('data-qi-crest', 'shown');
    expect(await page.evaluate(() => [...document.querySelectorAll('[inert]')].length)).toBe(0);
    // 閘門沒顯示：門的三層圖是 lazy、不下載
    expect(await page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('[data-gate-door] img')].map((img) => img.loading))).toEqual(['lazy', 'lazy', 'lazy']);
    // 門的樣式表也不插入、不下載（再訪的首屏不為閘門多付）
    expect(await page.evaluate(() => document.querySelectorAll('link[href*="/gate."]').length)).toBe(0);
    // 匾上的館徽也沒有設（不為閘門載任何圖）
    expect(await page.locator('[data-gate-crest]').evaluate((el) => el.style.getPropertyValue('--crest'))).toBe('');
  });

  test('sessionStorage 被封鎖（隱私模式）：閘門照樣顯示、照樣進得去、開場照演；重新載入又擋一次（沒有記憶）', async ({ page }) => {
    await open(page, {
      clock: true,
      before: (p) =>
        p.addInitScript(() => {
          Storage.prototype.getItem = () => {
            throw new DOMException('blocked', 'SecurityError');
          };
          Storage.prototype.setItem = () => {
            throw new DOMException('blocked', 'SecurityError');
          };
        }),
    });
    await expect(html(page)).toHaveAttribute('data-gate', 'open');
    await enterButton(page).click();
    await run(page, GATE_FADE_MS + 100);
    await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');

    await page.reload();
    await expect(html(page), '沒有記憶：再擋一次').toHaveAttribute('data-gate', 'open');
    await expect(enterButton(page)).toBeVisible();
  });
});

// ── 不擋內容的情況 ────────────────────────────────────────────────

test.describe('不顯示閘門', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /** 閘門整層不渲染、頁面不被鎖、背景沒有 inert。 */
  async function expectNoGate(page: Page): Promise<void> {
    await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);
    await expect(page.locator('[data-gate-dialog]')).toBeHidden();
    await expect(page.locator('[data-gate-backdrop]')).toBeHidden();
    expect(await html(page).evaluate((el) => getComputedStyle(el).overflow), '沒有鎖捲動').not.toBe('hidden');
    expect(await page.evaluate(() => [...document.querySelectorAll('[inert]')].length), '沒有 inert').toBe(0);
    await expect(page.getByRole('heading', { level: 1, name: '六藝武術' }), 'h1 看得到').toBeVisible();
  }

  test.describe('減少動態', () => {
    test.use({ reducedMotion: 'reduce' });
    test('直接靜態首頁，沒有閘門', async ({ page }) => {
      watch(page);
      await page.goto('./');
      await expect(html(page)).toHaveClass(/qi-static/);
      await expectNoGate(page);
    });
  });

  test('沒有 WebGL（html.qi-static）：沒有閘門', async ({ page }) => {
    watch(page);
    await blockWebGL(page);
    await page.goto('./');
    await expect(html(page)).toHaveClass(/qi-static/);
    await expectNoGate(page);
  });

  test('再訪（這個工作階段進過館）：沒有閘門', async ({ page }) => {
    watch(page);
    await page.addInitScript((key) => sessionStorage.setItem(key, '1'), STORAGE_KEY);
    await page.goto(HOME);
    await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
    await expectNoGate(page);
  });

  test('網址帶 #錨點（例如 #booking）直接前往：沒有閘門、直接到那一段', async ({ page }) => {
    watch(page);
    await page.goto('./?qi-tier=min&qi-debug=1#booking');
    await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
    await expectNoGate(page);
    await expect(page.locator('#booking')).toBeInViewport();
    expect(await scrollY(page), '真的捲到預約段').toBeGreaterThan(500);
  });

  test('從站內其他頁進來（點頁首的首頁連結）：沒有閘門', async ({ page }) => {
    watch(page);
    await page.goto('./courses/');
    const base = await html(page).getAttribute('data-base');
    expect(base, 'html 帶 data-base（行內腳本比對 referrer 用）').toMatch(/^\/.*\/$/);
    await page.locator(`header a[href="${base}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${base}(\\?.*)?$`));
    await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
    await expectNoGate(page);
  });

  test('別的網站的 referrer：照擋（不是站內來）', async ({ page }) => {
    watch(page);
    await page.goto(HOME, { referer: 'https://www.example.com/somewhere' });
    await expect(html(page)).toHaveAttribute('data-gate', 'open');
  });
});

test.describe('沒有 JavaScript', () => {
  test.use({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });

  test('閘門不渲染；h1 仍是站名、內容與連結完整（爬蟲看到的就是這個）；閘門在 DOM 的最後、不改變內容順序', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-gate-dialog]')).toBeHidden();
    await expect(page.locator('[data-gate-backdrop]')).toBeHidden();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('六藝武術');
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
    expect(await html(page).evaluate((el) => getComputedStyle(el).overflow), '沒有鎖捲動').not.toBe('hidden');
    // DOM 順序：h1（在 main 的開場區）→ main 結束 → 頁尾 → …→ 閘門（body 的最後一個內容節點）
    const order = await page.evaluate(() => {
      const index = (selector: string) => [...document.querySelectorAll('*')].indexOf(document.querySelector(selector)!);
      return { h1: index('h1'), main: index('main'), footer: index('footer'), gate: index('[data-gate-dialog]') };
    });
    expect(order.h1, 'h1 在 main 裡').toBeGreaterThan(order.main);
    expect(order.gate, '閘門在頁尾之後').toBeGreaterThan(order.footer);
  });
});

// ── 任何退出路徑都要還原 ───────────────────────────────────────────

test.describe('閘門的退出路徑', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('WebGL context 在閘門開著時遺失：退回靜態圖、閘門立刻收起（不淡出）、捲動與 inert 都還原', async ({ page }) => {
    await open(page);
    await expect(html(page)).toHaveAttribute('data-gate', 'open');
    await page.evaluate(() => {
      document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]')!.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext();
    });
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'static', { timeout: 1000 });
    await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);
    await expect(page.locator('[data-gate-dialog]')).toBeHidden();
    expect(await html(page).evaluate((el) => getComputedStyle(el).overflow)).not.toBe('hidden');
    expect(await page.evaluate(() => [...document.querySelectorAll('[inert]')].length)).toBe(0);
    await expect(page.locator('main#main'), '焦點不留在消失的按鈕上').toBeFocused();
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'skipped');
    await page.mouse.wheel(0, 600);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(200);
  });

  test('引擎的 chunk 載不到（init-failed）：閘門立刻收起、頁面是靜態圖、不報錯到 pageerror', async ({ page }) => {
    watch(page);
    await page.route(/qi-stage[^/]*\.js(\?.*)?$/, (route) => route.abort());
    await page.goto(HOME);
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'static', { timeout: 20_000 });
    await expect(html(page)).toHaveAttribute('data-qi-reason', 'init-failed');
    await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);
    await expectGateGone(page);
    // 引擎 chunk 的載入失敗會留下 console.error（瀏覽器自己印的），這個測試要的是「閘門收起、不擋內容」
    seen.delete(page);
  });

  test('形體載不到（.bin 全部失敗）：閘門照常（氣流不需要形體），按「入館」後開場取消、頁面照常、館徽直接露出', async ({ page }) => {
    watch(page);
    await page.route(/\.bin(\?|$)/, (route) => route.abort());
    await page.goto(HOME);
    await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
    await expect(html(page)).toHaveAttribute('data-gate', 'open');
    await enterButton(page).click();
    await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);
    await expect(html(page), '形體載不到：開場不演，收尾為 done').toHaveAttribute('data-qi-intro', 'done', READY);
    await expect(html(page)).toHaveAttribute('data-qi-crest', 'shown');
    // 瀏覽器自己印的請求失敗訊息不算頁面的錯誤
    seen.delete(page);
  });

  /** 首頁腳本（index 的行內 module）載不到：引擎、閘門的接線都不會跑，只剩 <head> 的行內腳本。 */
  const blockHomeScript = (page: Page) => page.route(/index\.astro_astro_type_script_index_0_lang\.[^/]+\.js/, (route) => route.abort());

  test('首頁腳本載不到：閘門不會永遠擋著——保險（GATE_SAFETY_MS ＝ 10 秒）到了由 <head> 的行內腳本拿掉，頁面可捲動', async ({ page }) => {
    expect(GATE_SAFETY_MS).toBe(10_000);
    await page.clock.install({ time: T0 });
    await blockHomeScript(page);
    await page.goto(HOME);
    await expect(html(page)).toHaveAttribute('data-gate', 'open');
    await page.clock.pauseAt(new Date(T0.getTime() + GATE_SAFETY_MS - 500));
    await expect(html(page), '9.5 秒：還在').toHaveAttribute('data-gate', 'open');
    await page.clock.runFor(600);
    await expect(html(page), '10.1 秒：拿掉').not.toHaveAttribute('data-gate', /.*/);
    await expectGateGone(page);
  });

  test('首頁腳本載不到、而且時鐘一口氣跳過一小時：同樣拿掉（保險是計時器，一跳就到）', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await blockHomeScript(page);
    await page.goto(HOME);
    await expect(html(page)).toHaveAttribute('data-gate', 'open');
    await page.clock.pauseAt(T1);
    await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);
  });

  test('首頁腳本被扣住時「入館」按鈕不可見、點不到；腳本接手後才出現並取得焦點（不會有一顆點了沒反應的按鈕）', async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
      setTimeout(resolve, 8000); // 保險：比 <head> 的 10 秒保險早放行
    });
    await page.route(/index\.astro_astro_type_script_index_0_lang\.[^/]+\.js/, async (route) => {
      await held;
      await route.continue();
    });
    watch(page);
    try {
      await page.goto(HOME, { waitUntil: 'commit' });
      await page.waitForSelector('[data-gate-enter]', { state: 'attached' });
      await expect(html(page), '行內腳本已標好閘門').toHaveAttribute('data-gate', 'open');
      await expect(page.locator('[data-gate-dialog]')).not.toHaveAttribute('data-ready', /.*/);
      await expect(enterButton(page), '腳本還沒到：按鈕不可見').toBeHidden();
      expect(await enterButton(page).evaluate((el) => getComputedStyle(el).visibility)).toBe('hidden');
      await expect(page.locator('.gate__frame'), '門與背板照常在').toBeAttached();
    } finally {
      release();
    }
    await expect(page.locator('[data-gate-dialog]')).toHaveAttribute('data-ready', '', READY);
    await expect(enterButton(page), '腳本接手後按鈕出現').toBeVisible();
    await expect(enterButton(page)).toBeFocused();
    await enterButton(page).click();
    await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);
  });

  test('首頁腳本有載入：閘門由腳本接手（window.__qiGate），保險計時到了也不會把還沒按的閘門拿掉', async ({ page }) => {
    await open(page, { clock: true });
    expect(await page.evaluate(() => (window as unknown as { __qiGate?: boolean }).__qiGate)).toBe(true);
    await run(page, GATE_SAFETY_MS + 5000);
    await expect(html(page), '腳本接手了：閘門還在等使用者').toHaveAttribute('data-gate', 'open');
    await expect(enterButton(page)).toBeVisible();
  });
});

/** 閘門整層不在了：不渲染、沒有鎖捲動、沒有 inert。 */
async function expectGateGone(page: Page): Promise<void> {
  await expect(page.locator('[data-gate-dialog]')).toBeHidden();
  await expect(page.locator('[data-gate-backdrop]')).toBeHidden();
  expect(await html(page).evaluate((el) => getComputedStyle(el).overflow)).not.toBe('hidden');
  expect(await page.evaluate(() => [...document.querySelectorAll('[inert]')].length)).toBe(0);
}

// ── 館徽的逾時保險與閘門 ────────────────────────────────────────────

// ── 開場用的形體（lift）載不到 ──────────────────────────────────────
// 前次審查轉來（Task 26）：閘門後面的光點停在氣流（flow），按下「入館」後開場要等 land、lift 都載到才演；lift 載不到時開場被取消，
// 但引擎的 `setPose('land')` 在開場 pending 時被擋下、首頁的 `requested` 又已經是 land，不會重試——光點就永遠停在氣流。
test.describe('入館後開場形體載入失敗', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('lift.bin 載不到：開場取消後引擎回到目前段落的姿勢（land），光點聚成拳師，不停在氣流', async ({ page }) => {
    watch(page);
    await page.route(/lift[^/]*\.bin(\?|$)/, (route) => route.abort());
    await page.goto(HOME);
    await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
    await expect(html(page), '前提：閘門後面停在氣流').toHaveAttribute('data-qi-pose', 'flow');
    await enterButton(page).click();
    await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);
    await expect(html(page), 'lift 載不到：開場取消，收尾為 done').toHaveAttribute('data-qi-intro', 'done', READY);
    await expect(html(page), '引擎回到 land').toHaveAttribute('data-qi-pose', 'land', READY);
    expect(await page.evaluate(() => (window as unknown as W).__qi.debug.pose())).toBe('land');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as W).__qi.debug.meanError()), { timeout: 30_000, message: '光點聚成拳師' })
      .toBeLessThan(0.05);
    // 瀏覽器自己印的請求失敗訊息不算頁面的錯誤
    seen.delete(page);
  });
});

// ── 入館後、形體還沒載完就略過 ──────────────────────────────────────
// 閘門後面引擎停在氣流（flow）；按「入館」後開場在等 land、lift（pending）。這時略過（或 Esc），引擎必須回到 land，
// 形體放行之後光點聚成拳師——不能永遠停在氣流（開場區只剩飄煙）。
test.describe('入館後略過（形體還沒載完）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const how of ['skip-button', 'escape'] as const) {
    test(`${how === 'skip-button' ? '點「略過」鈕' : '按 Esc'}：形體放行後引擎回到 land、光點聚成拳師（不是停在氣流）`, async ({ page }) => {
      watch(page);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
        setTimeout(resolve, 60_000); // 保險：測試出錯也不要把請求一直扣著
      });
      await page.route(/\.bin(\?|$)/, async (route) => {
        await held;
        await route.continue();
      });
      const pose = () => page.evaluate(() => (window as unknown as W).__qi.debug.pose());
      try {
        await page.goto(HOME);
        await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
        await expect(html(page), '前提：閘門後面停在氣流').toHaveAttribute('data-qi-pose', 'flow');
        await enterButton(page).click();
        await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);
        await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
        expect(await introT(page), '前提：開場在等形體（pending），計時還沒起算').toBe(-1);

        if (how === 'skip-button') await page.locator('[data-skip-intro]').click();
        else await page.keyboard.press('Escape');
        await expect(html(page)).toHaveAttribute('data-qi-intro', 'skipped');
        expect(await pose(), '形體還沒到：引擎仍在氣流').toBe('flow');

        release();
        await expect.poll(pose, { timeout: 30_000, message: '形體放行後回到 land' }).toBe('land');
        await expect(html(page)).toHaveAttribute('data-qi-pose', 'land', READY);
        await expect
          .poll(() => page.evaluate(() => (window as unknown as W).__qi.debug.meanError()), { timeout: 30_000, message: '光點聚成拳師' })
          .toBeLessThan(0.05);
      } finally {
        release();
      }
    });
  }
});

test.describe('館徽的逾時保險與閘門', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('閘門擋著時保險不起算：開著 8 秒（注入 1 秒的保險）館徽也不會被放出來；按「入館」之後才起算，之後仍是落地才擦出', async ({ page }) => {
    await open(page, { url: `${HOME}&qi-crest-failsafe=1000`, clock: true });
    await shapesLoaded(page); // 閘門期間預取的 land、lift 都到了：按下「入館」後引擎計時當場起算（不然假時鐘下保險可能搶在形體載入之前到期）
    await run(page, 8000);
    await expect(html(page), '閘門開著、開場還沒開始：館徽沒有被保險放出來').not.toHaveAttribute('data-qi-crest', /.*/);
    await enterButton(page).click();
    await run(page, GATE_FADE_MS + 100);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    // 開場一開始就解除保險：之後再久也不會搶先放出（落地的衝擊波才擦出）
    await run(page, 1500);
    await expect(html(page)).not.toHaveAttribute('data-qi-crest', /.*/);
    await run(page, 1500);
    await expect(html(page)).toHaveAttribute('data-qi-crest', 'in');
  });
});
