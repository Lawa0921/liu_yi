import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { QiDebug } from '../../src/qi/engine/qi-stage';
import type { BeatId } from '../../src/qi/config/poses';
import { HOME_FG_LEFT_BEATS } from '../../src/lib/scene/config';
import { FG_OPAQUE_BOX } from '../../src/lib/scene/fg-dodge';

// 首頁景深層（Task 27，使用者要求「前中後遠景的效果沒有出現」）：光點拳師照舊，後面有遠景屋脊與中景（依段落換，在人形旁邊）、前面有框在左右的前景（簷角、窗櫺）。
//   - 層都在、圖已載入、純裝飾（aria-hidden、不接收指標事件）。
//   - 中景依目前的段落換：開場與拳是院門、格鬥是木人樁、兵器三段是兵器架、其他課程是鼓、師資與課表是旗；中景在人形旁邊（不是正後方）。
//   - 看得見（審查：遠景與中景的對比太低）：隱藏光點畫布，用截圖量每一層「有／沒有」的亮度差——引擎在跑、引擎到達之前（海報）、減少動態（靜態圖）、沒有 JS 四種狀態都要量。
//   - 捲動視差：遠景最慢（位移最小）、前景最快，方向相反；減少動態時不位移。
//   - 前景不遮文字與光點主體：每一張前景的矩形與每段文字、段落導覽、光點外框都不相交（每一段、三種視窗尺寸）。
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
        blendBack: getComputedStyle(document.querySelector('.depth')!).mixBlendMode,
        blendFront: getComputedStyle(document.querySelector('.depth-fg')!).mixBlendMode,
        zCanvas: getComputedStyle(document.querySelector('.home-canvas')!).zIndex,
        zBeat: getComputedStyle(document.querySelector('[data-beat]')!).zIndex,
      };
    });
    expect(info.loaded).toBe(true);
    expect(info.alts.every((alt) => alt === '')).toBe(true);
    expect(info.far).toBe(1);
    expect([...info.mid].sort()).toEqual(['banner', 'drum', 'dummy', 'gate', 'rack']);
    expect([...info.fg].sort(), '前景兩張：簷角與窗櫺').toEqual(['fg-eave', 'fg-lattice']);
    expect(info.hidden).toBe(true);
    expect(info.pointer).toEqual(['none', 'none']);
    // 層次：遠景與中景用 lighten 疊在最上面（比後面亮的才提亮：海報、靜態圖、光點、文字都原樣透出，每個狀態都看得見），前景（近黑，一般混合）同在最上面；兩組都在頁首、段落導覽與外框之下
    expect(Number(info.zBack)).toBeGreaterThan(Number(info.zBeat));
    expect(Number(info.zFront)).toBeGreaterThan(Number(info.zBeat));
    expect(Number(info.zBack)).toBeGreaterThan(Number(info.zCanvas));
    expect(info.blendBack).toBe('lighten');
    expect(info.blendFront).toBe('normal');
    expect(Number(info.zBack)).toBeLessThan(45); // 段落導覽的 z-index
  });

  test('光點畫布用 screen（它的黑底對頁面底色是中性的，不會在底色上多出一塊更黑的矩形）；開場海報在引擎接手後淡出', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.home-canvas')!).mixBlendMode)).toBe('screen');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.opening__poster')!).opacity)).toBe('0');
  });

  test('中景在人形旁邊、不是正後方：橫向版面中景的中心在人形（--figure-x）左邊至少 15% 視窗寬', async ({ page }) => {
    await open(page);
    const geometry = await page.evaluate(() => {
      const depth = document.querySelector<HTMLElement>('.depth')!;
      const visible = document.querySelector<HTMLElement>('.depth__layer[data-depth-layer="mid"] img[data-mid="gate"]')!;
      const rect = visible.getBoundingClientRect();
      const box = depth.getBoundingClientRect();
      return { center: (rect.left + rect.right) / 2, width: box.width, left: box.left, figureX: parseFloat(getComputedStyle(depth).getPropertyValue('--figure-x')) / 100 };
    });
    const centerShare = (geometry.center - geometry.left) / geometry.width;
    expect(geometry.figureX - centerShare, '中景中心離人形中心').toBeGreaterThanOrEqual(0.15);
  });
});

test.describe('中景依段落換', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const CASES: { beat: BeatId; pose: string; mid: string }[] = [
    { beat: 'opening', pose: 'land', mid: 'gate' },
    { beat: 'fist', pose: 'dingzhou', mid: 'gate' },
    { beat: 'combat-a', pose: 'guard', mid: 'dummy' },
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
        .toEqual(Object.fromEntries(['gate', 'rack', 'drum', 'banner', 'dummy'].map((key) => [key, key === mid ? 0.85 : 0])));
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

// ── 景深看得見：隱藏光點畫布，量每一層「有／沒有」的亮度差 ─────────────────────

/** 視窗截圖的亮度（0–255）。 */
async function lumaOf(buffer: Buffer): Promise<Float32Array> {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = new Float32Array(info.width * info.height);
  for (let i = 0; i < out.length; i++) out[i] = 0.2126 * data[i * 3]! + 0.7152 * data[i * 3 + 1]! + 0.0722 * data[i * 3 + 2]!;
  return out;
}

/** 兩張截圖的平均亮度差：只算有差的像素（差 > 3），也就是那一層的剪影蓋住的地方。 */
function meanDifference(a: Float32Array, b: Float32Array): { mean: number; share: number } {
  let n = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d > 3) {
      n++;
      sum += d;
    }
  }
  return { mean: n === 0 ? 0 : sum / n, share: n / a.length };
}

const HIDE = {
  far: '[data-depth-layer="far"] { visibility: hidden !important }',
  mid: '[data-depth-layer="mid"] { visibility: hidden !important }',
  fg: '.depth-fg { visibility: hidden !important }',
};

/** 暫時加一段樣式、截圖、再拿掉。 */
async function shotWith(page: Page, css: string): Promise<Float32Array> {
  // 樣式改了要等瀏覽器真的重繪才截（真實時間：假時鐘會接管 rAF，不能用 rAF 等）；顆粒層（.grain）是動的，一併隱藏，不然兩張截圖之間到處都有雜訊差
  const handle = await page.addStyleTag({ content: `.grain { visibility: hidden !important } ${css}` });
  await page.waitForTimeout(150);
  const buffer = await page.screenshot();
  await handle.evaluate((el) => (el as Element).remove());
  return lumaOf(buffer);
}

type Contrast = Record<'far' | 'mid' | 'fg', { mean: number; share: number }>;

/** 量遠景、中景、前景的亮度差（先隱藏光點畫布，只剩景深層、海報或靜態圖、文字；文字在每張圖裡都一樣，不會有差）。 */
async function measureDepth(page: Page): Promise<Contrast> {
  await page.evaluate(() => document.querySelectorAll<HTMLImageElement>('.depth img[data-src]').forEach((img) => (img.src ||= img.dataset.src!)));
  await page.evaluate(async () => {
    // 直向版面的窗櫺是 display: none 的 lazy 圖（不下載），略過
    const imgs = [...document.querySelectorAll<HTMLImageElement>('.depth img, .depth-fg img')].filter((img) => img.getAttribute('src') && getComputedStyle(img).display !== 'none');
    await Promise.all(imgs.map((img) => img.decode().catch(() => undefined)));
  });
  // 頁面上所有有限長度的動畫與轉場都跑完才截（複審：開場海報的淡化 0.6 s、opening-in 0.9–1.05 s、beat-text-in 0.7 s 還在跑時截到的第一張，
  // 和後面幾張的底不一樣，亮度差會掉到門檻邊上，曾量到 11.95–11.97；前景本身早就是 1）。已結束但帶 fill 的動畫會留在 getAnimations() 裡，
  // 所以排除 finished；無限循環的（例如飄塵）永遠不會結束，也排除。動畫走文件時間軸、不受假時鐘控制；從 Node 端輪詢（假時鐘會接管頁面裡的計時器與 rAF）。
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          document.getAnimations().filter((animation) => animation.playState !== 'finished' && animation.effect?.getTiming().iterations !== Infinity).length,
        ),
      { timeout: 10_000, message: '有限長度的動畫都跑完' },
    )
    .toBe(0);
  await page.addStyleTag({ content: '.home-canvas { visibility: hidden !important }' });
  const all = await shotWith(page, '');
  return {
    far: meanDifference(all, await shotWith(page, HIDE.far)),
    mid: meanDifference(all, await shotWith(page, HIDE.mid)),
    fg: meanDifference(all, await shotWith(page, HIDE.fg)),
  };
}

/**
 * 門檻：審查量到第一版遠景約 2.4、中景約 12–15（亮度 0–255），都太淡。現在四種狀態、兩種視窗都量到：遠景 22–25、中景 22–33、前景 18–22；
 * 門檻取約六成，留給字型、取樣與軟體繪製的誤差。
 */
const MIN_DIFF = { far: 14, mid: 16, fg: 12 };
/** 剪影蓋住的面積占視窗的下限：前景在手機只有一張簷角（約 0.4%），不是一小撮雜訊。 */
const MIN_SHARE = { far: 0.03, mid: 0.03, fg: 0.003 };

function expectVisibleDepth(result: Contrast, label: string): void {
  for (const layer of ['far', 'mid', 'fg'] as const) {
    expect(result[layer].mean, `${label}：${layer} 與背景的平均亮度差`).toBeGreaterThanOrEqual(MIN_DIFF[layer]);
    expect(result[layer].share, `${label}：${layer} 占畫面的比例（不是一小塊）`).toBeGreaterThan(MIN_SHARE[layer]);
  }
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`景深看得見：${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    test('引擎在跑（光點畫布隱藏）：遠景、中景、前景與背景的亮度差都夠大，開場（院門）與格鬥（木人樁）兩段都量', async ({ page }) => {
      await open(page);
      expectVisibleDepth(await measureDepth(page), `${size.width}px 開場`);
      await settlePose(page, 'combat-a', 'guard');
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.depth__img[data-mid="dummy"]')!).opacity), { timeout: 10_000 }).toBe('0.85');
      expectVisibleDepth(await measureDepth(page), `${size.width}px 格鬥`);
    });
  });

  test.describe(`靜態狀態也看得見景深：${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    test.describe('減少動態', () => {
      test.use({ reducedMotion: 'reduce' });

      test('退回靜態圖：海報與每段的靜態圖是不透明的暗底，景深層照樣看得見', async ({ page }) => {
        await page.addInitScript(() => sessionStorage.setItem('liuyi:qi-intro', '1'));
        await page.goto(HOME);
        await expect(page.locator('html')).toHaveClass(/qi-static/);
        await page.waitForTimeout(500);
        expectVisibleDepth(await measureDepth(page), '減少動態：開場（海報）');
        await scrollToBeat(page, 'combat-b');
        await page.waitForTimeout(500);
        await expect(page.locator('[data-beat="combat-b"] .beat__still:visible')).toHaveCount(1);
        expectVisibleDepth(await measureDepth(page), '減少動態：格鬥（靜態圖）');
      });
    });

    test('引擎到達之前（擋掉引擎腳本，只剩海報）', async ({ page }) => {
      await page.addInitScript(() => sessionStorage.setItem('liuyi:qi-intro', '1'));
      await page.route(/\/_astro\/[^/]*(qi|home|init)[^/]*\.js(\?.*)?$/, (route) => route.abort());
      await page.goto('./');
      await page.waitForTimeout(800);
      await expect(page.locator('html')).not.toHaveAttribute('data-qi-ready', 'true');
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.opening__poster')!).opacity), '海報還在').toBe('1');
      expectVisibleDepth(await measureDepth(page), '引擎之前：開場（海報）');
    });

    test.describe('沒有 JS', () => {
      test.use({ javaScriptEnabled: false });

      test('海報與靜態圖：遠景與中景（預設的院門）看得見', async ({ page }) => {
        // 沒有 JS 就不能 addStyleTag：改在文件回應裡塞一段 <style>，同一頁載三次（全部、沒有遠景、沒有中景）
        const shot = async (css: string): Promise<Float32Array> => {
          await page.unroute('**/*');
          await page.route('**/*', async (route) => {
            if (route.request().resourceType() !== 'document') return route.continue();
            const response = await route.fetch();
            await route.fulfill({ response, body: (await response.text()).replace('</head>', `<style>.home-canvas, .grain { visibility: hidden !important } ${css}</style></head>`) });
          });
          await page.goto('./');
          await page.waitForTimeout(400);
          return lumaOf(await page.screenshot());
        };
        const all = await shot('');
        const far = meanDifference(all, await shot(HIDE.far));
        const mid = meanDifference(all, await shot(HIDE.mid));
        expect(far.mean, '沒有 JS：遠景').toBeGreaterThanOrEqual(MIN_DIFF.far);
        expect(mid.mean, '沒有 JS：中景（院門）').toBeGreaterThanOrEqual(MIN_DIFF.mid);
      });
    });
  });
}

// ── 前景不遮文字與光點主體 ───────────────────────────────────────────

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 每一張前景的不透明外框（視窗座標）：把圖畫到 canvas 取 alpha > 40 的像素範圍，再換算到目前的顯示矩形（含視差位移、翻轉），並裁到景深層的矩形內。 */
const fgBoxes = (page: Page): Promise<{ asset: string; box: Box }[]> =>
  page.evaluate(async () => {
    const area = document.querySelector('.depth-fg')!.getBoundingClientRect();
    const out: { asset: string; box: Box }[] = [];
    for (const img of document.querySelectorAll<HTMLImageElement>('.depth-fg img')) {
      if (Number(getComputedStyle(img).opacity) < 0.5 || getComputedStyle(img).display === 'none') continue; // 這一段沒有顯示的前景（窗櫺只在左下角沒有字的段落出現、直向版面不顯示）
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
      out.push({
        asset: img.dataset.asset ?? '',
        box: { left: Math.max(left, area.left), right: Math.min(right, area.right), top: Math.max(rect.top + y0 * sy, area.top), bottom: Math.min(rect.top + (y1 + 1) * sy, area.bottom) },
      });
    }
    return out;
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

/** 每一段都量（不只是有光點人形的那幾段）：前景是固定在視窗角落的，每一段停下來時都不得壓到文字。 */
const ALL_BEATS: { beat: BeatId; pose: string }[] = [
  { beat: 'opening', pose: 'land' },
  { beat: 'fist', pose: 'dingzhou' },
  { beat: 'combat-a', pose: 'guard' },
  { beat: 'combat-b', pose: 'jab' },
  { beat: 'weapon-a', pose: 'jian' },
  { beat: 'weapon-b', pose: 'miaodao' },
  { beat: 'weapon-c', pose: 'spear' },
  { beat: 'others', pose: 'others' },
  { beat: 'coaches', pose: 'salute' },
  { beat: 'pricing', pose: 'scroll' },
  { beat: 'booking', pose: 'crest' },
];

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test.describe(`前景不遮文字與光點主體：${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    test('每一張前景（簷角、窗櫺）的不透明外框與每段可見的文字、段落導覽、光點外框都不相交；每段都量', async ({ page }) => {
      await open(page);
      for (const { beat, pose } of ALL_BEATS) {
        await settlePose(page, beat, pose);
        // 窗櫺的淡入淡出是 CSS 轉場（走文件時間軸，不受假時鐘控制）：用真實時間等到它停在該有的值
        const portrait = size.width / size.height <= 0.8; // 直向版面：只有一張簷角（翻到左上），窗櫺不顯示
        const wantLattice = !portrait && HOME_FG_LEFT_BEATS.includes(beat) ? '1' : '0';
        if (portrait) await expect(page.locator('.depth-fg img[data-asset="fg-lattice"]'), `${beat} 直向沒有窗櫺`).toBeHidden();
        else {
          await expect
            .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.depth-fg img[data-asset="fg-lattice"]')!).opacity), { message: `${beat} 的窗櫺`, timeout: 10_000 })
            .toBe(wantLattice);
        }
        // 簷角同樣是 CSS 轉場淡入（opening 段在整套負載下曾經量到還沒淡入）：等到看得見的前景就是這一段該有的那幾張再量
        const wantAssets = wantLattice === '1' ? ['fg-eave', 'fg-lattice'] : ['fg-eave'];
        await expect
          .poll(
            () =>
              page.evaluate(() =>
                [...document.querySelectorAll<HTMLImageElement>('.depth-fg img')]
                  .filter((img) => Number(getComputedStyle(img).opacity) >= 0.5 && getComputedStyle(img).display !== 'none')
                  .map((img) => img.dataset.asset!)
                  .sort(),
              ),
            { message: `${beat} 看得見的前景（等淡入完成）`, timeout: 10_000 },
          )
          .toEqual(wantAssets);
        const fgs = await fgBoxes(page);
        expect(fgs.map((fg) => fg.asset).sort(), `${beat} 看得見的前景`).toEqual(wantAssets);
        const texts = await textBoxes(page);
        const rail = await page.locator('nav.home-rail').boundingBox();
        const extent = await page.evaluate(() => (window as unknown as W).__qi.debug.extent());
        for (const { asset, box } of fgs) {
          expect(box.right - box.left, `${asset} 有大小`).toBeGreaterThan(40);
          for (const text of texts) expect(overlaps(box, text), `${beat}：${asset} 壓到文字 ${JSON.stringify(text)}（${JSON.stringify(box)}）`).toBe(false);
          if (rail) expect(overlaps(box, { left: rail.x, right: rail.x + rail.width, top: rail.y, bottom: rail.y + rail.height }), `${beat}：${asset} 壓到段落導覽`).toBe(false);
          if (extent.right > extent.left) expect(overlaps(box, extent), `${beat}：${asset} 壓到光點主體 ${JSON.stringify(extent)}（${JSON.stringify(box)}）`).toBe(false);
        }
      }
    });
  });
}

// ── 連續捲動：捲動途中前景也不得壓住文字（複審 Critical）──────────────────────
//
// 前景是固定在視窗角落的，在 [data-beat] 的文字之上（z-index 2，為了蓋在不透明的海報與靜態圖前面）。
// 每段停在正中央時不壓字（上面的測試），但捲動途中文字會從前景底下經過：複審員在建置結果上每 40 px 捲一次，
// 桌機 206 個位置有 51 個、手機 218 個位置有 21 個，窗櫺或簷角蓋住文字矩形超過 5%（最高 62%，「看這門課」幾乎看不見）。
// 解法是前景在文字經過時淡出（`scripts/home/depth.ts`），這裡從頂捲到底、每 ≤ 40 px 量一次：
// 任何文字矩形被「看得見的前景」的不透明外框蓋住的比例都要 ≤ 5%。
// 前景淡出是 CSS 轉場（走文件時間軸，不受假時鐘控制）：這支測試把轉場關掉，量的是目標狀態；轉場只是修飾。

const SCROLL_STEP = 40;
const MAX_COVERED = 0.05;

/** 捲到 y，等頁面真的到了那裡、前景的腳本也處理過這一格（depth.ts 在 .depth-fg 上記 data-fg-sync）。 */
async function scrollAndSync(page: Page, y: number): Promise<void> {
  await page.evaluate((target) => window.scrollTo(0, target), y);
  await expect
    .poll(
      async () => {
        await page.clock.runFor(50);
        return page.evaluate((target) => {
          if (Math.abs(window.scrollY - target) >= 2) return 'scrolling';
          const sync = document.querySelector('.depth-fg')?.getAttribute('data-fg-sync');
          if (sync === null || sync === undefined) return 'no-script';
          return Math.abs(Number(sync) - window.scrollY) < 2 ? 'ok' : 'waiting';
        }, y);
      },
      { timeout: 15_000, message: `捲到 ${y}` },
    )
    .toBe('ok');
}

const coveredShare = (fg: Box, text: Box): number => {
  const w = Math.min(fg.right, text.right) - Math.max(fg.left, text.left);
  const h = Math.min(fg.bottom, text.bottom) - Math.max(fg.top, text.top);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1, (text.right - text.left) * (text.bottom - text.top));
};

for (const size of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`連續捲動不壓字：${size.width}×${size.height}`, () => {
    test.use({ viewport: size });
    test.describe.configure({ timeout: 420_000 });

    test(`從頂捲到底、每 ${SCROLL_STEP} px 量一次：任何文字矩形被前景蓋住的比例 ≤ 5%（並且前景確實有露出來，不是整段都關掉）`, async ({ page }) => {
      await open(page);
      await page.addStyleTag({ content: '.depth-fg .depth__img { transition: none !important }' });
      const total = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      expect(total, '頁面比視窗高很多').toBeGreaterThan(size.height * 3);

      let positions = 0;
      let withFg = 0;
      const worst: { y: number; share: number; asset: string; text: Box }[] = [];
      for (let y = 0; y <= total + SCROLL_STEP; y += SCROLL_STEP) {
        await scrollAndSync(page, Math.min(y, total));
        positions++;
        const fgs = await fgBoxes(page);
        if (fgs.length > 0) withFg++;
        const texts = await textBoxes(page);
        for (const { asset, box } of fgs) {
          for (const text of texts) {
            const share = coveredShare(box, text);
            if (share > MAX_COVERED) worst.push({ y, share, asset, text });
          }
        }
      }
      test.info().annotations.push({ type: 'scroll-positions', description: `${positions} 個位置，${withFg} 個位置有前景露出，${worst.length} 個違規` });
      expect(worst.slice(0, 6).map((w) => `scrollY=${w.y}：${w.asset} 蓋住文字 ${(w.share * 100).toFixed(0)}% ${JSON.stringify(w.text)}`), `${worst.length}／${positions} 個位置有文字被前景蓋住超過 5%`).toEqual([]);
      expect(positions, '每 40 px 一格').toBeGreaterThan(total / (SCROLL_STEP + 1));
      expect(withFg / positions, '前景在大多數位置仍露出（淡出只在文字經過時）').toBeGreaterThan(0.5);
    });
  });
}

// ── 真實速度的連續捲動：前景的淡出來得及（複審 Important）──────────────────────
//
// 上面「每 40 px 量一次」關掉了轉場、量的是目標狀態，抓不到「前景要等文字進入之後才開始淡出」：文字以每秒上千 px 掃過前景，
// 淡出要 0.3 s，文字早就過去了（複審員用 rAF 逐格量到：手機 500 px/s 有 5 格超過 5%、1200 px/s 有 14 格、最高 75%；桌機 2500 px/s 有 3 格）。
// 這裡不關轉場，在頁面裡用 rAF 以固定速度連續捲動（每格 scrollTo），每一格量「文字被前景不透明部分蓋住的比例」，
// 並以前景實際畫出來的 computed opacity 加權（量的是真正畫到螢幕上的樣子，不是目標狀態）：每一格都要 ≤ 5%。
//   - 量測順序：我的 rAF 回呼先於頁面腳本的回呼，所以這一格看到的幾何（文字位置）是上一格畫出去的那一個，
//     opacity 要用上一格開頭讀到的（轉場在每格開頭才推進）——兩個合起來才是上一格實際畫出去的畫面。
//   - 文字只算看得見的部分：夾在景深層的矩形裡（頁首在它上面、外框下緣在它下面），被頁首蓋住的文字不算。
//   - 速度用真實時間（performance.now）積分，所以畫格掉了也是同樣的速度。

interface SweepResult {
  frames: number;
  /** 前景（加權後）蓋住文字的比例超過 5% 的畫格：每格最大的那一個。 */
  bad: { y: number; share: number; asset: string; text: string; gap: number }[];
  worst: number;
  /** 至少有一張前景的 opacity > 0.5 的畫格數。 */
  visibleFrames: number;
  /** 簷角（每種版面都有、位置固定在角落的那一張）opacity > 0.5 的畫格數。 */
  eaveFrames: number;
  seconds: number;
}

async function sweep(page: Page, options: { speed: number; start: number; end: number }): Promise<SweepResult> {
  await page.waitForFunction(() => document.querySelector('.depth-fg')?.hasAttribute('data-fg-ready') === true, undefined, { timeout: 15_000 });
  return page.evaluate(
    async ({ speed, start, end, opaque }) => {
      const area = document.querySelector('.depth-fg')!;
      const images = [...document.querySelectorAll<HTMLImageElement>('.depth-fg img')];
      const range = document.createRange();
      const texts: Text[] = [];
      const walker = document.createTreeWalker(document.querySelector('main')!, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        if (text.data.trim() && !text.parentElement?.closest('.depth, .depth-fg, script, style, noscript, [hidden]')) texts.push(text);
      }
      const opacities = () => images.map((img) => Number(getComputedStyle(img).opacity));

      window.scrollTo({ top: start, behavior: 'instant' });
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await new Promise((resolve) => setTimeout(resolve, 700)); // 起點的前景轉場走完
      let painted = opacities();

      const bad: { y: number; share: number; asset: string; text: string; gap: number }[] = [];
      let worst = 0;
      let frames = 0;
      let visibleFrames = 0;
      let eaveFrames = 0;
      let y = start;
      let last = performance.now();
      const began = last;

      return new Promise<{ frames: number; bad: typeof bad; worst: number; visibleFrames: number; eaveFrames: number; seconds: number }>((resolve) => {
        const step = (now: number): void => {
          // 1. 上一格實際畫出去的畫面：現在的幾何 × 上一格開頭的 opacity
          const clip = area.getBoundingClientRect();
          const boxes = images.map((img, index) => {
            const rect = img.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return null;
            const fraction = opaque[img.dataset.asset ?? ''] ?? { x0: 0, x1: 1, y0: 0, y1: 1 };
            const flipped = new DOMMatrixReadOnly(getComputedStyle(img).transform).a < 0;
            const x0 = flipped ? 1 - fraction.x1 : fraction.x0;
            const x1 = flipped ? 1 - fraction.x0 : fraction.x1;
            const w = rect.width;
            const h = rect.height;
            return {
              asset: img.dataset.asset ?? '',
              opacity: painted[index]!,
              left: Math.max(rect.left + x0 * w, clip.left),
              right: Math.min(rect.left + x1 * w, clip.right),
              top: Math.max(rect.top + fraction.y0 * h, clip.top),
              bottom: Math.min(rect.top + fraction.y1 * h, clip.bottom),
            };
          });
          if (boxes.some((box) => box && box.opacity > 0.5)) visibleFrames++;
          if (boxes.some((box) => box && box.asset === 'fg-eave' && box.opacity > 0.5)) eaveFrames++;
          let frameWorst = 0;
          let frameBad: { share: number; asset: string; text: string } | undefined;
          for (const text of texts) {
            range.selectNodeContents(text);
            for (const r of range.getClientRects()) {
              const left = Math.max(r.left, clip.left);
              const right = Math.min(r.right, clip.right);
              const top = Math.max(r.top, clip.top);
              const bottom = Math.min(r.bottom, clip.bottom);
              if (right <= left || bottom <= top) continue; // 看不到的部分（在頁首底下、外框下緣之外）不算
              const textArea = (right - left) * (bottom - top);
              for (const box of boxes) {
                if (!box) continue;
                const w = Math.min(right, box.right) - Math.max(left, box.left);
                const h = Math.min(bottom, box.bottom) - Math.max(top, box.top);
                if (w <= 0 || h <= 0) continue;
                const share = ((w * h) / textArea) * box.opacity;
                if (share > frameWorst) {
                  frameWorst = share;
                  frameBad = { share, asset: box.asset, text: (text.data.trim() || '').slice(0, 14) };
                }
              }
            }
          }
          frames++;
          if (frameWorst > worst) worst = frameWorst;
          if (frameWorst > 0.05 && frameBad) bad.push({ y: Math.round(window.scrollY), ...frameBad, gap: Math.round(now - last) });
          painted = opacities();

          // 2. 往前捲：固定速度（px/s），用真實時間積分（畫格掉了也是同樣速度；單格最多當 100 ms，避免卡頓後一口氣跳太遠）
          const dt = Math.min(0.1, (now - last) / 1000);
          last = now;
          y += speed * dt;
          if (y >= end) {
            resolve({ frames, bad, worst, visibleFrames, eaveFrames, seconds: (now - began) / 1000 });
            return;
          }
          window.scrollTo({ top: y, behavior: 'instant' });
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    },
    { ...options, opaque: FG_OPAQUE_BOX },
  );
}

// 複審員量到的三組速度：手機 500 與 1200 px/s、桌機 2500 px/s（觸控慣性捲動與滑鼠滾輪快速轉動的量級）。
// 轉場要真的開著：偏好是「不減少動態」（減少動態時全站規則把轉場壓成 0，量不到淡出）；光點引擎的腳本擋掉（只剩海報），
// 畫格才穩定（軟體繪製的 WebGL 會把畫格拖慢，量到的就是引擎而不是前景）；另有一組「減少動態」（沒有轉場、只剩提前量）。
for (const scenario of [
  // minVisible：這一組速度下至少要有這個比例的畫格看得到前景（不是「一捲動就把前景整個關掉」混過去）。
  // minEave：簷角自己露出的畫格比例下限（複審：桌機簷角被固定在畫面上的段落導覽「提前」藏起來，800 px/s 時被藏的格數 193／208 是固定文字觸發的）。
  //   桌機的簷角在右上角，會捲動的文字不從它底下經過，只有固定的段落導覽在它附近：提前量不看固定文字之後，三種速度實測都是 100% 的畫格露出
  //   （修之前 500 px/s 76%、800 px/s 37%、2500 px/s 4%），門檻 0.9。手機的簷角在左上，標題真的會從底下經過，維持原本的 minVisible。
  { name: '手機 390×844，500 px/s', viewport: { width: 390, height: 844 }, speed: 500, motion: 'no-preference' as const, minVisible: 0.4 },
  { name: '手機 390×844，1200 px/s', viewport: { width: 390, height: 844 }, speed: 1200, motion: 'no-preference' as const, minVisible: 0.3 },
  { name: '桌機 1440×900，500 px/s', viewport: { width: 1440, height: 900 }, speed: 500, motion: 'no-preference' as const, minVisible: 0.9, minEave: 0.9 },
  { name: '桌機 1440×900，800 px/s', viewport: { width: 1440, height: 900 }, speed: 800, motion: 'no-preference' as const, minVisible: 0.9, minEave: 0.9 },
  { name: '桌機 1440×900，2500 px/s', viewport: { width: 1440, height: 900 }, speed: 2500, motion: 'no-preference' as const, minVisible: 0.9, minEave: 0.9 },
  { name: '手機 390×844，1200 px/s（減少動態：沒有轉場）', viewport: { width: 390, height: 844 }, speed: 1200, motion: 'reduce' as const, minVisible: 0.3 },
  // 光點引擎也開著（?qi-tier=min，軟體繪製的 WebGL 會把畫格拖慢，單格位移更大）：提前量是依真實時間算的，畫格慢也要來得及
  { name: '手機 390×844，1200 px/s（光點引擎開著）', viewport: { width: 390, height: 844 }, speed: 1200, motion: 'no-preference' as const, minVisible: 0.2, engine: true },
]) {
  test.describe(`真實速度連續捲動：${scenario.name}`, () => {
    test.use({ viewport: scenario.viewport, reducedMotion: scenario.motion });
    test.describe.configure({ timeout: 240_000 });

    test('不關前景的轉場，rAF 固定速度從頂捲到底：每一格文字被前景（以實際 opacity 加權）蓋住的比例都 ≤ 5%', async ({ page }) => {
      await page.addInitScript(() => sessionStorage.setItem('liuyi:qi-intro', '1'));
      if (scenario.motion === 'no-preference' && !scenario.engine) await page.route(/\/_astro\/[^/]*(qi|home|init)[^/]*\.js(\?.*)?$/, (route) => route.abort());
      await page.goto(HOME);
      if (scenario.engine) await expect(page.locator('html')).toHaveAttribute('data-qi-ready', 'true', { timeout: 60_000 });
      else await expect(page.locator('html')).not.toHaveAttribute('data-qi-ready', 'true');
      const fade = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.depth-fg img')!).transitionDuration));
      // 不減少動態：前景的淡入轉場開著（0.3 s；有文字經過的那一張淡出 0.1 s）；減少動態：全站規則把轉場壓到近 0
      if (scenario.motion === 'no-preference') expect(fade, '前景的轉場開著（沒有被關掉）').toBeCloseTo(0.3, 5);
      else expect(fade, '減少動態：沒有轉場').toBeLessThan(0.01);
      const total = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      const result = await sweep(page, { speed: scenario.speed, start: 0, end: total });
      test.info().annotations.push({
        type: 'sweep',
        description: `${scenario.name}：${result.frames} 格、${result.seconds.toFixed(1)} 秒，最大蓋住比例 ${(result.worst * 100).toFixed(0)}%，${result.bad.length} 格超過 5%，${result.visibleFrames} 格有前景露出，${result.eaveFrames} 格簷角露出`,
      });
      console.log(`[sweep] ${test.info().annotations.at(-1)!.description}`);
      expect(result.frames, '畫格數夠多（不是卡住）').toBeGreaterThan(30);
      expect(result.visibleFrames / result.frames, '前景在這個速度下仍有露出（不是一捲動就整個關掉）').toBeGreaterThan(scenario.minVisible);
      if (scenario.minEave !== undefined) expect(result.eaveFrames / result.frames, '簷角露出的畫格比例（固定在畫面上的文字不該讓它提前躲開）').toBeGreaterThan(scenario.minEave);
      expect(
        result.bad.slice(0, 5).map((b) => `scrollY=${b.y}：${b.asset} 蓋住「${b.text}」${(b.share * 100).toFixed(0)}%（這一格距上一格 ${b.gap} ms）`),
        `${result.bad.length}／${result.frames} 格超過 5%（最大 ${(result.worst * 100).toFixed(0)}%）`,
      ).toEqual([]);
    });
  });
}

// 被頁首蓋住的文字不算（複審：手機上看不到的文字也會讓簷角淡出）：頁首在景深層的矩形之上，文字捲進頁首底下就看不到了，不該讓前景閃。
// 前景的視差位移會讓簷角在頁面後段有一截伸到景深層的上緣之外（被裁掉、被頁首蓋住）：在那一截上面放一段文字——
// 文字也在頁首底下（看不到），簷角不得淡出；再把文字移到簷角看得見的那一塊上面（對照組，證明量測有效），簷角就要淡出。
// 舊程式把文字與前景都不夾進景深層的矩形，第一種情況也會淡出。
test.describe('被頁首蓋住的文字不會讓前景淡出：手機 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('簷角被頁首蓋住的那一截上面的文字不觸發、移到看得見的那一塊上面才觸發', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('liuyi:qi-intro', '1'));
    await page.route(/\/_astro\/[^/]*(qi|home|init)[^/]*\.js(\?.*)?$/, (route) => route.abort()); // 只剩海報，畫面穩定
    await page.goto(HOME);
    await page.waitForFunction(() => document.querySelector('.depth-fg')?.hasAttribute('data-fg-ready') === true);
    const eave = page.locator('.depth-fg img[data-asset="fg-eave"]');

    const geometry = () =>
      page.evaluate(() => {
        const area = document.querySelector('.depth-fg')!.getBoundingClientRect();
        const rect = document.querySelector('.depth-fg img[data-asset="fg-eave"]')!.getBoundingClientRect();
        return { areaTop: area.top, top: rect.top, bottom: rect.bottom, left: rect.left, hidden: document.querySelector('.depth-fg img[data-asset="fg-eave"]')!.hasAttribute('data-fg-hide') };
      });

    // 找一個捲動位置：簷角有一截（≥ 8 px）在景深層上緣之外、看得見的那一塊 ≥ 20 px 高，而且沒有別的文字讓它淡出
    const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    let found: Awaited<ReturnType<typeof geometry>> | undefined;
    for (let p = 0.5; p <= 0.99 && !found; p += 0.01) {
      await page.evaluate((y) => window.scrollTo(0, y), Math.round(max * p));
      await page.waitForFunction((y) => Math.abs(Number(document.querySelector('.depth-fg')?.getAttribute('data-fg-sync')) - y) < 2, Math.round(max * p));
      await page.waitForTimeout(150);
      const g = await geometry();
      if (g.top < g.areaTop - 8 && g.bottom > g.areaTop + 20 && !g.hidden) found = g;
    }
    expect(found, '找得到簷角有一截伸到頁首底下的捲動位置').toBeTruthy();
    const scrollY = await page.evaluate(() => window.scrollY);

    const place = (where: 'under-header' | 'over-eave') =>
      page.evaluate(
        ({ where: spot, y }) => {
          const area = document.querySelector('.depth-fg')!.getBoundingClientRect();
          const rect = document.querySelector('.depth-fg img[data-asset="fg-eave"]')!.getBoundingClientRect();
          let probe = document.querySelector<HTMLElement>('[data-probe]');
          if (!probe) {
            probe = document.createElement('p');
            probe.dataset.probe = '';
            probe.textContent = '探針文字';
            probe.style.cssText = 'position:absolute;margin:0;font-size:16px;line-height:20px;white-space:nowrap';
            document.querySelector('main')!.appendChild(probe);
          }
          // 視窗座標 → 文件座標（加上捲動位置）：頁首底下＝景深層上緣之上 25 px（高 20 px，整段在上緣之外）；看得見的那一塊＝景深層上緣之下 4 px
          probe.style.left = String(Math.max(0, rect.left) + 8) + 'px';
          probe.style.top = String(y + (spot === 'under-header' ? area.top - 25 : area.top + 4)) + 'px';
          window.dispatchEvent(new Event('resize')); // 重建文字清單
          return { areaTop: area.top, probeBottom: probe.getBoundingClientRect().bottom, probeTop: probe.getBoundingClientRect().top };
        },
        { where, y: scrollY },
      );

    const under = await place('under-header');
    expect(under.probeBottom, '探針整段在景深層上緣之上（被頁首蓋住）').toBeLessThanOrEqual(under.areaTop);
    await page.waitForTimeout(500); // 讓腳本量過、轉場走完
    expect((await geometry()).hidden, '被頁首蓋住的文字不讓簷角淡出').toBe(false);

    const over = await place('over-eave');
    expect(over.probeTop, '對照：探針在景深層裡面（看得見）').toBeGreaterThanOrEqual(over.areaTop);
    await expect(eave, '對照：看得見的文字壓在簷角上，簷角淡出').toHaveAttribute('data-fg-hide', /.*/);
  });
});

// ── 快速捲動後突然停下：前景要回來（複審 Important）──────────────────────────────
//
// 前景依捲動速度提前淡出（上面那幾組），但速度只在 scroll 事件那一格更新：捲到一半突然停下，最後一格的速度留著，
// 前景就一直躲著，要等下一個事件才回來（複審員量到：手機 1200 px/s 停下 4／20、滾輪刻度 手機 10／20 桌機 24／40、錨點 3／5、滾到頁底 5.5 秒後簷角仍是 0）。
// 這裡每次停下之後，等到「最後一個 scroll 事件之後 RECOVER_MS」，量每一張畫得出來的前景：附近（CLEAR_MARGIN 內）沒有看得見的文字的，
// 實際的 computed opacity 要 ≥ 0.5（轉場開著）。附近有文字的本來就該躲，不在這裡驗（上面的連續捲動驗不壓字）。
// 判斷「附近有沒有文字」用測試自己量的幾何（前景不透明外框夾進景深層的矩形，文字也夾進去），不讀腳本的結論。

const RECOVER_MS = 600;
/** 比腳本的邊距（6 px）寬一點：文字離前景 6–12 px 的邊界情況不驗，免得兩邊的取整差一兩 px 就誤判。 */
const CLEAR_MARGIN = 12;

interface RestFg {
  asset: string;
  clear: boolean;
  opacity: number;
}

async function openForRest(page: Page): Promise<void> {
  await page.addInitScript(() => sessionStorage.setItem('liuyi:qi-intro', '1'));
  await page.route(/\/_astro\/[^/]*(qi|home|init)[^/]*\.js(\?.*)?$/, (route) => route.abort()); // 只剩海報：畫格穩定
  await page.goto(HOME);
  await page.waitForFunction(() => document.querySelector('.depth-fg')?.hasAttribute('data-fg-ready') === true, undefined, { timeout: 15_000 });
  const fade = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.depth-fg img')!).transitionDuration));
  expect(fade, '前景的轉場開著').toBeCloseTo(0.3, 5);
  await page.evaluate(() => {
    const w = window as unknown as { __lastScroll: number };
    w.__lastScroll = performance.now();
    window.addEventListener('scroll', () => void (w.__lastScroll = performance.now()), { passive: true });
  });
}

/** 等到最後一個 scroll 事件之後 RECOVER_MS（期間又有捲動就再等），量每一張畫得出來的前景。 */
function restState(page: Page): Promise<{ y: number; fgs: RestFg[] }> {
  return page.evaluate(
    async ({ wait, margin, opaque }) => {
      const w = window as unknown as { __lastScroll: number };
      await new Promise<void>((resolve) => {
        const tick = (): void => {
          const left = w.__lastScroll + wait - performance.now();
          if (left <= 0) resolve();
          else setTimeout(tick, Math.max(1, left));
        };
        tick();
      });
      const front = document.querySelector<HTMLElement>('.depth-fg')!;
      const clip = front.getBoundingClientRect();
      const clipTo = (b: { left: number; top: number; right: number; bottom: number }) => {
        const out = { left: Math.max(b.left, clip.left), right: Math.min(b.right, clip.right), top: Math.max(b.top, clip.top), bottom: Math.min(b.bottom, clip.bottom) };
        return out.right > out.left && out.bottom > out.top ? out : null;
      };
      const texts: { left: number; top: number; right: number; bottom: number }[] = [];
      const range = document.createRange();
      const walker = document.createTreeWalker(document.querySelector('main')!, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        if (!text.data.trim() || text.parentElement?.closest('.depth, .depth-fg, script, style, noscript, [hidden]')) continue;
        range.selectNodeContents(text);
        for (const r of range.getClientRects()) {
          const box = r.width > 0 && r.height > 0 ? clipTo(r) : null;
          if (box) texts.push(box);
        }
      }
      const fgs: { asset: string; clear: boolean; opacity: number }[] = [];
      for (const img of front.querySelectorAll<HTMLImageElement>('img')) {
        const asset = img.dataset.asset ?? '';
        const rect = img.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue; // display: none（直向的窗櫺）
        if (asset === 'fg-lattice' && front.dataset.depthLeft !== 'on') continue; // 這一段本來就不放窗櫺
        const fraction = opaque[asset] ?? { x0: 0, x1: 1, y0: 0, y1: 1 };
        const flipped = new DOMMatrixReadOnly(getComputedStyle(img).transform).a < 0;
        const x0 = flipped ? 1 - fraction.x1 : fraction.x0;
        const x1 = flipped ? 1 - fraction.x0 : fraction.x1;
        const visible = clipTo({ left: rect.left + x0 * rect.width, right: rect.left + x1 * rect.width, top: rect.top + fraction.y0 * rect.height, bottom: rect.top + fraction.y1 * rect.height });
        if (!visible) continue; // 整張被景深層裁掉
        const near = { left: visible.left - margin, right: visible.right + margin, top: visible.top - margin, bottom: visible.bottom + margin };
        const clear = !texts.some((t) => Math.min(near.right, t.right) - Math.max(near.left, t.left) > 0 && Math.min(near.bottom, t.bottom) - Math.max(near.top, t.top) > 0);
        fgs.push({ asset, clear, opacity: Number(getComputedStyle(img).opacity) });
      }
      return { y: Math.round(window.scrollY), fgs };
    },
    { wait: RECOVER_MS, margin: CLEAR_MARGIN, opaque: FG_OPAQUE_BOX },
  );
}

/** 瞬間捲到 start、等起點的轉場走完，再以固定速度（rAF、真實時間積分）捲 seconds 秒；then＝'stop' 突然停下，{ anchor } 緊接著點一個段落連結。 */
function flick(page: Page, options: { start: number; speed: number; seconds: number; then: 'stop' | { anchor: string } }): Promise<void> {
  return page.evaluate(async ({ start, speed, seconds, then }) => {
    window.scrollTo({ top: start, behavior: 'instant' });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const max = document.documentElement.scrollHeight - window.innerHeight;
    await new Promise<void>((resolve) => {
      const began = performance.now();
      let last = began;
      let y = start;
      const step = (now: number): void => {
        y = Math.min(max, y + speed * Math.min(0.1, Math.max(0, now - last) / 1000));
        last = now;
        window.scrollTo({ top: y, behavior: 'instant' });
        if (now - began >= seconds * 1000 || y >= max) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    if (then !== 'stop') document.querySelector<HTMLAnchorElement>(`a[href="#${then.anchor}"]`)!.click(); // 頁面裡的 click()，不是 OS 層級的輸入
  }, options);
}

type Stop = { label: string; fgs: RestFg[] };

function expectRecovered(stops: Stop[], minClear: number): void {
  const stuck = stops.flatMap((stop) => stop.fgs.filter((fg) => fg.clear && fg.opacity < 0.5).map((fg) => `${stop.label}：${fg.asset} opacity ${fg.opacity.toFixed(2)}`));
  const checked = stops.filter((stop) => stop.fgs.some((fg) => fg.clear)).length;
  const description = `${stops.length} 次停下，${checked} 次有附近沒有文字的前景，${stuck.length} 張卡在隱藏`;
  test.info().annotations.push({ type: 'rest', description });
  console.log(`[rest] ${test.info().title}：${description}`);
  expect(checked, '有足夠的停點真的驗到「該露出」（不是每次都剛好有文字在旁邊）').toBeGreaterThanOrEqual(minClear);
  expect(stuck, `停下 ${RECOVER_MS} ms 後，附近沒有文字的前景仍然隱藏`).toEqual([]);
}

for (const scenario of [
  { name: '手機 390×844', viewport: { width: 390, height: 844 }, speed: 1200 },
  { name: '桌機 1440×900', viewport: { width: 1440, height: 900 }, speed: 2000 },
]) {
  test.describe(`快速捲動後停下，前景在 ${RECOVER_MS} ms 內回來：${scenario.name}`, () => {
    test.use({ viewport: scenario.viewport });
    test.describe.configure({ timeout: 240_000 });

    test(`固定速度 ${scenario.speed} px/s 捲 0.4 秒後突然停下（20 個起點）`, async ({ page }) => {
      await openForRest(page);
      const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      const stops: Stop[] = [];
      for (let i = 0; i < 20; i++) {
        const start = Math.round(max * (0.02 + (0.9 * i) / 20));
        await flick(page, { start, speed: scenario.speed, seconds: 0.4, then: 'stop' });
        const rest = await restState(page);
        stops.push({ label: `${start} → ${rest.y}`, fgs: rest.fgs });
      }
      expectRecovered(stops, 8);
    });

    test('滾輪刻度（每 30 ms 一格 100 px，10 格）後停下（16 個起點），以及一路滾到頁底', async ({ page }) => {
      await openForRest(page);
      const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      await page.mouse.move(scenario.viewport.width / 2, scenario.viewport.height / 2); // Playwright 直接送進瀏覽器的滾輪事件，不是 OS 層級的輸入
      const stops: Stop[] = [];
      for (let i = 0; i < 16; i++) {
        const start = Math.round(max * (0.02 + (0.85 * i) / 16));
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), start);
        await page.waitForTimeout(700);
        for (let k = 0; k < 10; k++) {
          await page.mouse.wheel(0, 100);
          await page.waitForTimeout(30);
        }
        const rest = await restState(page);
        stops.push({ label: `滾輪 ${start} → ${rest.y}`, fgs: rest.fgs });
      }
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.round(max * 0.6));
      await page.waitForTimeout(700);
      for (let k = 0; k < 150 && (await page.evaluate(() => window.scrollY)) < max - 1; k++) {
        await page.mouse.wheel(0, 100);
        await page.waitForTimeout(30);
      }
      const bottom = await restState(page);
      expect(bottom.y, '滾到了頁底').toBeGreaterThanOrEqual(max - 2);
      stops.push({ label: `滾到頁底 ${bottom.y}`, fgs: bottom.fgs });
      expectRecovered(stops, 6);
    });

    test('快速捲動之後緊接著點段落連結（瞬間跳很遠）', async ({ page }) => {
      await openForRest(page);
      const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      const anchors = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('.home-rail a[href^="#"]')].map((a) => a.getAttribute('href')!.slice(1)));
      expect(anchors.length, '段落連結').toBeGreaterThanOrEqual(4);
      const stops: Stop[] = [];
      for (const [i, anchor] of anchors.entries()) {
        for (const start of [Math.round(max * 0.1), Math.round(max * (0.45 + i * 0.08))]) {
          await flick(page, { start, speed: scenario.speed, seconds: 0.3, then: { anchor } });
          const rest = await restState(page);
          stops.push({ label: `${start} 捲 0.3 秒 → #${anchor}（${rest.y}）`, fgs: rest.fgs });
        }
      }
      expectRecovered(stops, 4);
    });
  });
}

// 重新整理、瀏覽器還原捲動位置（複審 Minor）：還原發生在腳本量第一次之前後都有可能，載入當下文字還在升起動畫裡（beat-text-in、opening-in），
// 量到的是動畫中途的位置；動畫結束不會觸發任何事件，前景就停在「文字壓上來」的隱藏狀態（桌機 scrollY 4500 的窗櫺），直到下一次捲動。
// 這裡在各個位置重新整理，等動畫跑完、最後一個 scroll 事件之後 RECOVER_MS，附近沒有文字的前景都要看得見。
test.describe('重新整理還原捲動位置之後，前景照樣出現：桌機 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.describe.configure({ timeout: 240_000 });

  test('在 15 個位置重新整理（瀏覽器還原捲動位置；含複審員量到的 4500），附近沒有文字的前景都看得見', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('liuyi:qi-intro', '1');
      const w = window as unknown as { __lastScroll: number };
      w.__lastScroll = performance.now();
      window.addEventListener('scroll', () => void (w.__lastScroll = performance.now()), { passive: true });
    });
    await page.route(/\/_astro\/[^/]*(qi|home|init)[^/]*\.js(\?.*)?$/, (route) => route.abort()); // 只剩海報：畫格穩定
    await page.goto(HOME);
    await page.waitForFunction(() => document.querySelector('.depth-fg')?.hasAttribute('data-fg-ready') === true, undefined, { timeout: 15_000 });
    const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    const stops: Stop[] = [];
    const stale: string[] = [];
    const targets = [1500, 3000, 4500, 6000, 7500, ...Array.from({ length: 10 }, (_, i) => Math.round(max * (0.1 + (0.85 * i) / 10)))].filter((y) => y < max);
    for (const target of targets) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), target);
      await page.waitForTimeout(1000);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('.depth-fg')?.hasAttribute('data-fg-ready') === true, undefined, { timeout: 15_000 });
      // 升起動畫（最長約 1.05 s）都跑完
      await expect
        .poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.playState !== 'finished' && a.effect?.getTiming().iterations !== Infinity).length), { timeout: 10_000 })
        .toBe(0);
      const rest = await restState(page);
      expect(Math.abs(rest.y - target), `重新整理後還原到 ${target} 附近（版面高度在載入過程中會微調，差個十幾 px）`).toBeLessThan(150);
      stops.push({ label: `重新整理於 ${target}`, fgs: rest.fgs });
      // 停住的狀態要是「最新的」：叫腳本照現在的版面再算一次（resize），任何一張前景的隱藏與否都不能變（文字離前景 6–12 px 的情況上面的幾何判斷不驗，這裡驗）
      const hidden = () => page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.depth-fg img')].map((img) => `${img.dataset.asset}:${img.hasAttribute('data-fg-hide') ? 'hide' : 'show'}`));
      const settled = await hidden();
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.waitForFunction(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
      const fresh = await hidden();
      if (settled.join() !== fresh.join()) stale.push(`重新整理於 ${target}：停住時 ${settled.join(' ')}，重算後 ${fresh.join(' ')}`);
    }
    expectRecovered(stops, 6);
    expect(stale, '載入時量的是升起動畫中途的文字位置，動畫結束後沒有重算').toEqual([]);
  });
});
