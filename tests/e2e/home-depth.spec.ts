import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { QiDebug } from '../../src/qi/engine/qi-stage';
import type { BeatId } from '../../src/qi/config/poses';
import { HOME_FG_LEFT_BEATS } from '../../src/lib/scene/config';

// 首頁景深層（Task 27，使用者要求「前中後遠景的效果沒有出現」）：光點拳師照舊，後面有遠景屋脊與中景（依段落換，在人形旁邊）、前面有框在左右的前景（簷角、窗櫺）。
//   - 層都在、圖已載入、純裝飾（aria-hidden、不接收指標事件）。
//   - 中景依目前的段落換：開場與拳是院門、格鬥是木人樁、兵器三段是兵器架、其他課程是鼓、師資與收費是旗；中景在人形旁邊（不是正後方）。
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
    { beat: 'combat-a', pose: 'chengchui', mid: 'dummy' },
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
      await settlePose(page, 'combat-a', 'chengchui');
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
  { beat: 'combat-a', pose: 'chengchui' },
  { beat: 'combat-b', pose: 'kao' },
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
        const fgs = await fgBoxes(page);
        expect(fgs.map((fg) => fg.asset).sort(), `${beat} 看得見的前景`).toEqual(wantLattice === '1' ? ['fg-eave', 'fg-lattice'] : ['fg-eave']);
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
