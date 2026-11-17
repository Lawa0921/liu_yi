import { expect, test, type Page } from '@playwright/test';
import type { QiDebug } from '../../src/qi/engine/qi-stage';
import type { BeatId } from '../../src/qi/config/poses';

// 首頁景深層（Task 27，使用者要求「前中後遠景的效果沒有出現」）：光點拳師照舊，後面有遠景屋脊與中景（依段落換）、前面有框在角落的簷角。
//   - 層都在、圖已載入、純裝飾（aria-hidden、不接收指標事件）。
//   - 中景依目前的段落換：開場與拳是院門、格鬥是石鎖、兵器三段是兵器架、其他課程是鼓、師資與收費是旗。
//   - 捲動視差：遠景最慢（位移最小）、前景最快，方向相反；減少動態時不位移。
//   - 前景不遮文字與光點主體：簷角的矩形與每段文字、段落導覽、光點外框都不相交。
// headless 的 WebGL 是軟體繪製：引擎相關一律 ?qi-tier=min&qi-debug=1，時間用停住的假時鐘；只用 page.*，不碰 OS 層級的滑鼠鍵盤。
test.describe.configure({ mode: 'default', timeout: 120_000 });

const HOME = './?qi-tier=min&qi-debug=1';
const T0 = new Date('2026-01-01T08:00:00');
const T1 = new Date('2026-01-01T09:00:00');
const READY = { timeout: 30_000 };

type W = { __qi: { debug: QiDebug } };

async function open(page: Page): Promise<void> {
  await page.addInitScript(() => sessionStorage.setItem('liuyi:qi-intro', '1')); // 跳過閘門與開場
  await page.clock.install({ time: T0 });
  await page.goto(HOME);
  await expect(page.locator('html')).toHaveAttribute('data-qi-ready', 'true', READY);
  await page.clock.pauseAt(T1);
}

const scrollToBeat = (page: Page, beat: BeatId) =>
  page.evaluate((id) => {
    const rect = document.querySelector(`[data-beat="${id}"]`)!.getBoundingClientRect();
    window.scrollTo(0, Math.round(rect.top + window.scrollY + rect.height / 2 - window.innerHeight / 2));
  }, beat);

/** 捲到該段、等姿勢換上並聚合（與 screen-polish.spec 同一套做法）。 */
async function settlePose(page: Page, beat: BeatId, pose: string): Promise<void> {
  await scrollToBeat(page, beat);
  await page.clock.runFor(200);
  await expect(page.locator('html')).toHaveAttribute('data-qi-pose', pose, READY);
  await page.clock.runFor(3500);
}

type Offset = { x: number; y: number };
const offsetOf = (page: Page, kind: 'far' | 'mid' | 'fg'): Promise<Offset> =>
  page.evaluate((layer) => {
    const el = document.querySelector<HTMLElement>(`[data-depth-layer="${layer}"]`)!;
    const value = getComputedStyle(el).transform;
    if (value === 'none') return { x: 0, y: 0 };
    const m = new DOMMatrixReadOnly(value);
    return { x: m.m41, y: m.m42 };
  }, kind);

/** 讓 rAF 跑幾格（時鐘被停住時 rAF 也被假時鐘接管，要用 clock 推進）。 */
const frames = (page: Page) => page.clock.runFor(100);

/** 捲到指定位置、等頁面真的到了那裡（html 可能是平滑捲動），再讓視差的 rAF 跑完。 */
async function scrollSettled(page: Page, y: number | 'end'): Promise<void> {
  await page.evaluate((target) => window.scrollTo(0, target === 'end' ? document.documentElement.scrollHeight : target), y);
  await expect
    .poll(async () => {
      await page.clock.runFor(60);
      return page.evaluate((target) => (target === 'end' ? Math.abs(document.documentElement.scrollHeight - innerHeight - scrollY) < 2 : Math.abs(scrollY - target) < 2), y);
    })
    .toBe(true);
  // scroll 事件跟著瀏覽器真正的畫格走（不受假時鐘控制），負載高時會晚到：等遠景的位移真的換到這個方向（頂端為負、頁尾為正）再讀
  const sign = y === 'end' ? 1 : y === 0 ? -1 : 0;
  if (sign !== 0) {
    await expect
      .poll(
        async () => {
          await page.clock.runFor(60);
          return Math.sign((await offsetOf(page, 'far')).y);
        },
        { timeout: 15_000 },
      )
      .toBe(sign);
  }
  await frames(page);
}

test.describe('層與素材：桌機 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('遠景一張、中景五張、前景簷角都在，圖已載入；純裝飾（aria-hidden、不接收指標事件）', async ({ page }) => {
    await open(page);
    const info = await page.evaluate(async () => {
      // 非預設的四種中景延後載入（引擎就緒後 2 秒）：等它們都載到
      const imgs = [...document.querySelectorAll<HTMLImageElement>('.depth img, .depth-fg img')];
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && imgs.some((img) => !img.getAttribute('src') || !img.complete || img.naturalWidth === 0)) await new Promise((resolve) => setTimeout(resolve, 200));
      return {
        count: imgs.length,
        loaded: imgs.every((img) => img.complete && img.naturalWidth > 0),
        alts: imgs.map((img) => img.getAttribute('alt')),
        far: document.querySelectorAll('[data-depth-layer="far"] img').length,
        mid: [...document.querySelectorAll<HTMLElement>('[data-depth-layer="mid"] img')].map((img) => img.dataset.mid),
        fg: [...document.querySelectorAll<HTMLElement>('[data-depth-layer="fg"] img')].map((img) => img.dataset.asset),
        hidden: [...document.querySelectorAll('.depth, .depth-fg')].every((el) => el.getAttribute('aria-hidden') === 'true'),
        pointer: [...document.querySelectorAll('.depth, .depth-fg')].map((el) => getComputedStyle(el).pointerEvents),
        zBack: getComputedStyle(document.querySelector('.depth')!).zIndex,
        zFront: getComputedStyle(document.querySelector('.depth-fg')!).zIndex,
        zCanvas: getComputedStyle(document.querySelector('.home-canvas')!).zIndex,
        zBeat: getComputedStyle(document.querySelector('[data-beat]')!).zIndex,
      };
    });
    expect(info.loaded).toBe(true);
    expect(info.alts.every((alt) => alt === '')).toBe(true);
    expect(info.far).toBe(1);
    expect([...info.mid].sort()).toEqual(['banner', 'drum', 'gate', 'rack', 'stonelock']);
    expect(info.fg).toContain('fg-eave');
    expect(info.hidden).toBe(true);
    expect(info.pointer).toEqual(['none', 'none']);
    // 層次：遠景與中景在光點畫布後面，前景在畫布前面、在文字（beat）之下
    expect(Number(info.zBack)).toBeLessThan(Number(info.zCanvas));
    expect(Number(info.zFront)).toBeGreaterThanOrEqual(Number(info.zCanvas));
    expect(Number(info.zFront)).toBeLessThan(Number(info.zBeat));
  });

  test('光點畫布用 screen 疊在景深層上：黑的地方透出後面的遠景與中景（不是不透明的黑板）', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.home-canvas')!).mixBlendMode)).toBe('screen');
    // 開場的靜態海報淡出之後，畫面上看得到遠景（量遠景所在列的亮度比同一列的純底色高）
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.opening__poster')!).opacity)).toBe('0');
  });
});

test.describe('中景依段落換', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const CASES: { beat: BeatId; pose: string; mid: string }[] = [
    { beat: 'opening', pose: 'land', mid: 'gate' },
    { beat: 'fist', pose: 'dingzhou', mid: 'gate' },
    { beat: 'combat-a', pose: 'chengchui', mid: 'stonelock' },
    { beat: 'weapon-a', pose: 'jian', mid: 'rack' },
    { beat: 'weapon-b', pose: 'miaodao', mid: 'rack' },
    { beat: 'weapon-c', pose: 'spear', mid: 'rack' },
    { beat: 'others', pose: 'others', mid: 'drum' },
    { beat: 'coaches', pose: 'salute', mid: 'banner' },
    { beat: 'pricing', pose: 'scroll', mid: 'banner' },
  ];

  test('每一段的中景：只有該段的那一種看得見（其餘透明），兵器三段是兵器架', async ({ page }) => {
    await open(page);
    for (const { beat, pose, mid } of CASES) {
      await settlePose(page, beat, pose);
      await expect(page.locator('.depth'), `${beat} 的中景`).toHaveAttribute('data-depth-mid', mid);
      // CSS 轉場（0.9 s）走文件時間軸，不受 page.clock 控制：用真實時間輪詢到交叉淡化結束
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              Object.fromEntries([...document.querySelectorAll<HTMLElement>('[data-depth-layer="mid"] img')].map((img) => [img.dataset.mid, Number(getComputedStyle(img).opacity)])),
            ),
          { message: `${beat}：只有 ${mid} 看得見`, timeout: 10_000 },
        )
        .toEqual(Object.fromEntries(['gate', 'rack', 'drum', 'banner', 'stonelock'].map((key) => [key, key === mid ? 0.5 : 0])));
    }
  });
});

test.describe('捲動視差', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('頁首與頁尾：遠景位移最小、中景次之、前景最大，前景與遠景方向相反；捲回頂端回到原位', async ({ page }) => {
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-depth-motion', 'on');
    await frames(page);
    const top = { far: await offsetOf(page, 'far'), mid: await offsetOf(page, 'mid'), fg: await offsetOf(page, 'fg') };
    await scrollSettled(page, 'end');
    const bottom = { far: await offsetOf(page, 'far'), mid: await offsetOf(page, 'mid'), fg: await offsetOf(page, 'fg') };

    const travel = (kind: 'far' | 'mid' | 'fg') => bottom[kind].y - top[kind].y;
    expect(Math.abs(travel('far')), '遠景位移').toBeGreaterThan(5);
    expect(Math.abs(travel('far'))).toBeLessThan(Math.abs(travel('mid')));
    expect(Math.abs(travel('mid'))).toBeLessThan(Math.abs(travel('fg')));
    expect(Math.sign(travel('far'))).toBe(-Math.sign(travel('fg')));
    expect(Math.abs(travel('fg')), '前景位移不超過視窗高的 25%').toBeLessThan(900 * 0.25);
    for (const kind of ['far', 'mid', 'fg'] as const) expect(Math.abs(top[kind].x) + Math.abs(bottom[kind].x), `${kind} 只有垂直位移`).toBe(0);

    await scrollSettled(page, 0);
    for (const kind of ['far', 'mid', 'fg'] as const) expect((await offsetOf(page, kind)).y).toBeCloseTo(top[kind].y, 0);
  });
});

test.describe('減少動態', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('景深層還在（靜態），但不做視差、不換中景的轉場；html[data-depth-motion="off"]', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('liuyi:qi-intro', '1'));
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('data-depth-motion', 'off');
    await page.evaluate(() => window.scrollTo(0, 3000));
    await page.waitForTimeout(300);
    for (const kind of ['far', 'mid', 'fg'] as const) {
      expect(await offsetOf(page, kind), kind).toEqual({ x: 0, y: 0 });
      expect(await page.evaluate((layer) => document.querySelector<HTMLElement>(`[data-depth-layer="${layer}"]`)!.style.transform, kind)).toBe('');
    }
    const transition = await page.evaluate(() => getComputedStyle(document.querySelector('[data-depth-layer="mid"] img')!).transitionDuration);
    expect(parseFloat(transition), '全站的減少動態規則把轉場壓到近 0').toBeLessThan(0.01);
    await expect(page.locator('.depth [data-depth-layer="far"] img')).toBeAttached();
  });
});

// ── 前景不遮文字與光點主體 ───────────────────────────────────────────

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 簷角的不透明外框（視窗座標）：把圖畫到 canvas 取 alpha > 40 的像素範圍，再換算到目前的顯示矩形（含視差位移）。 */
const eaveBox = (page: Page): Promise<Box> =>
  page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('.depth-fg img[data-asset="fg-eave"]')!;
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
        if (data[(y * width + x) * 4 + 3]! <= 40) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    const rect = img.getBoundingClientRect(); // 含 transform（視差、翻轉）
    const sx = rect.width / width;
    const sy = rect.height / height;
    const flipped = getComputedStyle(img).transform !== 'none' && new DOMMatrixReadOnly(getComputedStyle(img).transform).a < 0;
    const left = flipped ? rect.right - (x1 + 1) * sx : rect.left + x0 * sx;
    const right = flipped ? rect.right - x0 * sx : rect.left + (x1 + 1) * sx;
    return { left, right, top: rect.top + y0 * sy, bottom: rect.top + (y1 + 1) * sy };
  });

const overlaps = (a: Box, b: Box): boolean => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;

const textBoxes = (page: Page): Promise<Box[]> =>
  page.evaluate(() => {
    const out: Box[] = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(document.querySelector('main')!, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || node.parentElement?.closest('.depth, .depth-fg, script, style, noscript, [hidden]')) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight) out.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      }
    }
    return out;
  });

const FIGURE_BEATS: { beat: BeatId; pose: string }[] = [
  { beat: 'opening', pose: 'land' },
  { beat: 'fist', pose: 'dingzhou' },
  { beat: 'combat-b', pose: 'kao' },
  { beat: 'coaches', pose: 'salute' },
  { beat: 'booking', pose: 'crest' },
];

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test.describe(`前景不遮文字與光點主體：${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    test('簷角（不透明外框）與每段可見的文字、段落導覽、光點外框都不相交', async ({ page }) => {
      await open(page);
      for (const { beat, pose } of FIGURE_BEATS) {
        await settlePose(page, beat, pose);
        const eave = await eaveBox(page);
        expect(eave.right - eave.left, '簷角有大小').toBeGreaterThan(40);
        for (const box of await textBoxes(page)) expect(overlaps(eave, box), `${beat}：簷角壓到文字 ${JSON.stringify(box)}（簷角 ${JSON.stringify(eave)}）`).toBe(false);
        const rail = await page.locator('nav.home-rail').boundingBox();
        if (rail) expect(overlaps(eave, { left: rail.x, right: rail.x + rail.width, top: rail.y, bottom: rail.y + rail.height }), `${beat}：簷角壓到段落導覽`).toBe(false);
        const extent = await page.evaluate(() => (window as unknown as W).__qi.debug.extent());
        if (extent.right > extent.left) expect(overlaps(eave, extent), `${beat}：簷角壓到光點主體 ${JSON.stringify(extent)}（簷角 ${JSON.stringify(eave)}）`).toBe(false);
      }
    });
  });
}
