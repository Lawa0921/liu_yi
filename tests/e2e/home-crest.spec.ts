import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { QiDebug } from '../../src/qi/engine/qi-stage';
import { CREST_FAILSAFE_MS } from '../../src/scripts/home/crest-sheen';
import { GATE_FADE_MS } from '../../src/scripts/home/gate';
import { figureBoxes, overlap, totalBytes, trackTransfers, type Box } from './helpers';

// 首頁開場的燙金獅子館徽（Task 24；使用者要求「原本那個燙金金屬質感 logo 可以考慮整合」）：
//   - 幾何：與光點人形（海報與引擎外框）、站名、副標、略過鈕、往下捲提示都不重疊（0 px），多個尺寸。
//   - 掃光：桌機跟著指標；觸控／沒有指標時緩慢自動掃過；減少動態時靜止（沒有動畫、沒有監聽）。掃光是漸層遮罩，不是 background-clip:text。
//   - 進場：開場演出時在落地的衝擊波擦出；略過、捲走、再訪不演時直接出現；退回靜態圖時一直在。
//   - 無障礙與傳輸量：純裝飾（aria-hidden、alt=""），同一張圖只下載一次。
// headless 的 WebGL 是軟體繪製：引擎一律 ?qi-tier=min&qi-debug=1；要看時間軸的測試用停住的假時鐘，量掃光的測試用真時鐘。只用 page.*，不碰 OS 層級的滑鼠鍵盤。
test.describe.configure({ mode: 'default', timeout: 120_000 });

const HOME = './?qi-tier=min&qi-debug=1';
/** 時間軸類的測試（假時鐘、pauseAt 一口氣跳一小時）不靠逾時保險：用 ?qi-crest-failsafe=off 關掉它，不必再全域吞掉計時器。逾時保險自己有專門的測試。 */
const HOME_NO_FAILSAFE = `${HOME}&qi-crest-failsafe=off`;
const T0 = new Date('2026-01-01T08:00:00');
const T1 = new Date('2026-01-01T09:00:00');
const READY = { timeout: 30_000 };
const KNOWN_WARNING = /GPU stall due to ReadPixels/;

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
const crestOf = (page: Page) => page.locator('.opening__crest');
const sheenOf = (page: Page) => page.locator('.opening__crest-sheen');
const run = (page: Page, ms: number) => page.clock.runFor(ms);

interface OpenOptions {
  intro?: 'seen' | 'fresh';
  /** 用假時鐘（時間軸測試）；預設用真時鐘。 */
  clock?: boolean;
}

const introT = (page: Page) => page.evaluate(() => (window as unknown as W).__qi.debug.uniforms().uIntroT!);

/** 閘門期間預取的 land、lift 兩個形體都已載完（真時鐘）。 */
const shapesLoaded = (page: Page) =>
  page.waitForFunction(
    () => ['land', 'lift'].every((id) => performance.getEntriesByType('resource').some((e) => e.name.includes('/' + id + '.') && e.name.endsWith('.bin'))),
    undefined,
    READY,
  );

/** 按「入館」（真時鐘）：閘門淡出收起（html[data-gate] 拿掉）之後開場才開始。 */
async function enterGateNow(page: Page): Promise<void> {
  await page.locator('[data-gate-enter]').click();
  await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);
}

/**
 * 開首頁、等引擎 ready。預設先標記看過開場（跳過）；`clock` 時再把時鐘停住（之後只有 `run` 會推進）。
 * 'fresh'（第一次進站）：首頁先蓋著入館閘門，引擎在後面 ready；這裡按「入館」、等閘門淡出收起（假時鐘下推進淡出的時間），之後開場才開始。
 */
async function open(page: Page, options: OpenOptions = {}): Promise<void> {
  watch(page);
  if (options.intro !== 'fresh') await page.addInitScript(() => sessionStorage.setItem('liuyi:qi-intro', '1'));
  if (options.clock) await page.clock.install({ time: T0 });
  // pauseAt(T1) 會一口氣跳過一小時、把到期的計時器全部觸發，包括館徽的逾時保險；時間軸測試要看的是「不靠逾時」的行為，所以關掉它。
  await page.goto(options.clock ? HOME_NO_FAILSAFE : HOME);
  await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
  if (options.clock) await page.clock.pauseAt(T1);
  if (options.intro === 'fresh') {
    await page.locator('[data-gate-enter]').click();
    if (options.clock) await run(page, GATE_FADE_MS + 100);
    await expect(html(page)).not.toHaveAttribute('data-gate', /.*/);
  }
}

/** 等所有「會結束」的動畫跑完（進場動畫 0.9 秒）：量到的才是定位後的位置。 */
const settleAnimations = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );

/** 沒有 WebGL 的裝置：任何 webgl／webgl2 的 getContext 都回 null。 */
const blockWebGL = (page: Page) =>
  page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (/webgl/i.test(type)) return null;
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });

/** 館徽圖在視窗中的位置（沒有占位＝display:none 時回 null）。 */
async function crestBox(page: Page): Promise<(Box & { width: number; height: number }) | null> {
  return page.evaluate(() => {
    const el = document.querySelector('.opening__crest-img');
    if (!el || el.getClientRects().length === 0) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  });
}

/** 截圖裡館徽那一塊的平均亮度：擦掉時只剩黑底（很低），出現時有金色線條（明顯較高）。 */
async function crestLuma(page: Page): Promise<number> {
  const box = (await crestBox(page))!;
  const png = await page.screenshot({ clip: { x: box.left, y: box.top, width: box.width, height: box.height } });
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < info.width * info.height; i++) sum += 0.2126 * data[i * 3]! + 0.7152 * data[i * 3 + 1]! + 0.0722 * data[i * 3 + 2]!;
  return sum / (info.width * info.height);
}
/** 館徽的 clip-path 是 inset(上 右 下 左)：回傳「上」的百分比（100 ＝ 整個擦掉、0 ＝ 完全露出，含沒有 clip-path；瀏覽器序列化成 inset(100% 0px 0px)、inset(0% 0px 0px)、none）。 */
const clipTop = (page: Page) =>
  crestOf(page).evaluate((el) => {
    if (getComputedStyle(el).clipPath === 'none') return 0;
    const match = /^inset\(\s*([\d.]+)(%|px)/.exec(getComputedStyle(el).clipPath);
    return match ? (match[2] === '%' ? Number(match[1]) : Number(match[1]) > 0 ? 100 : 0) : -1;
  });
/** 館徽上正在跑的動畫名稱（含子元素）。 */
const crestAnimations = (page: Page) => crestOf(page).evaluate((el) => el.getAnimations({ subtree: true }).map((a) => (a as CSSAnimation).animationName));
const LUMA_VISIBLE = 40; // 實測：有館徽約 60（金色線條占約 25%）
const LUMA_HIDDEN = 28; // 實測：沒有館徽約 20（黑底、顆粒與環境煙）

const sheenX = (page: Page) => crestOf(page).evaluate((el) => (el as HTMLElement).style.getPropertyValue('--sheen-x'));
const sheenY = (page: Page) => crestOf(page).evaluate((el) => (el as HTMLElement).style.getPropertyValue('--sheen-y'));
/** 瀏覽器可能把指標座標取整到整數像素：館徽約 100 px 寬，所以 ±2% 內都算對。 */
const near = async (read: () => Promise<string>, target: number): Promise<boolean> => Math.abs(Number.parseFloat(await read()) - target) <= 2;

// ── 幾何 ──────────────────────────────────────────────────────────

const SIZES = [
  { name: '桌機 1440×900', width: 1440, height: 900, required: true },
  { name: '桌機 1280×800', width: 1280, height: 800, required: true },
  { name: '手機 390×844', width: 390, height: 844, required: true },
  { name: '手機 360×740', width: 360, height: 740, required: true },
  { name: '手機 375×667', width: 375, height: 667, required: true },
  // 其餘尺寸：有顯示館徽時一樣不重疊（太矮的橫向視窗不放，見下方）
  { name: '桌機 1920×1080', width: 1920, height: 1080, required: false },
  { name: '平板橫向 1024×768', width: 1024, height: 768, required: false },
  { name: '近方形 1000×1000', width: 1000, height: 1000, required: false },
  { name: '直式平板 768×1024', width: 768, height: 1024, required: false },
  { name: '直式平板 820×1180', width: 820, height: 1180, required: false },
  { name: '小手機 360×640', width: 360, height: 640, required: false },
  { name: '舊手機 320×568', width: 320, height: 568, required: false },
  { name: '橫放手機 844×390', width: 844, height: 390, required: false },
  { name: '小筆電 900×600', width: 900, height: 600, required: false },
];

for (const size of SIZES) {
  test.describe(`館徽幾何：${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('與人形（海報與引擎外框）、站名、副標、略過鈕、往下捲提示的重疊都是 0 px，且在開場區內', async ({ page }) => {
      await open(page, { intro: 'fresh', clock: true }); // 開場演出中：略過鈕可見
      await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
      await settleAnimations(page);

      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${size.name} 無水平外溢`).toBeLessThanOrEqual(0);
      const crest = await crestBox(page);
      if (!crest) {
        expect(size.required, `${size.name} 必須顯示館徽`).toBe(false);
        return;
      }
      const { poster, engine } = await figureBoxes(page);
      const others = await page.evaluate(() => {
        const box = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        const visible = (el: Element | null): el is Element => !!el && el.getClientRects().length > 0;
        const out: Record<string, { left: number; right: number; top: number; bottom: number }> = {};
        const h1 = document.querySelector('.opening h1');
        const sub = document.querySelector('.opening__sub');
        const skip = document.querySelector('.opening__skip');
        const lockup = document.querySelector('.opening__lockup');
        if (visible(lockup)) out['站名組'] = box(lockup);
        if (visible(h1)) out['站名 h1'] = box(h1);
        if (visible(sub)) out['副標'] = box(sub);
        if (visible(skip)) out['略過鈕'] = box(skip);
        // 往下捲提示整條是滿寬的盒子，文字與線只占中間：量裡面的 span
        document.querySelectorAll('.opening__hint > span').forEach((el, i) => {
          if (visible(el)) out[`往下捲提示 #${i}`] = box(el);
        });
        const opening = box(document.querySelector('.opening')!);
        return { out, opening };
      });

      expect(Object.keys(others.out), '量得到站名與副標').toEqual(expect.arrayContaining(['站名組', '站名 h1', '副標']));
      expect(others.out['略過鈕'], '演出中略過鈕可見').toBeDefined();
      const note = `館徽 ${JSON.stringify(crest)}`;
      // 站名組（含 h1 與副標）是館徽的對照物：不是館徽要避開的另一個東西，所以不放進下面的迴圈
      const { 站名組: lockup, ...avoid } = others.out;
      // 館徽不能把別的東西推到撞上：站名組若被館徽推向右邊（直向），會偏離人形的中軸、站名也會和右下角的略過鈕相撞。
      // （副標與略過鈕在 375×667、360×640 有既有的 8–14px 盒子重疊，不是館徽造成的，不在這裡檢查，另行回報。）
      const { x: titleX, y: titleY } = overlap(avoid['站名 h1']!, avoid['略過鈕']!);
      expect(Math.min(titleX, titleY), `站名 h1 與略過鈕重疊（x ${titleX.toFixed(1)}px、y ${titleY.toFixed(1)}px）`).toBeLessThanOrEqual(0);
      if (size.width / size.height <= 0.8) {
        expect(Math.abs((lockup!.left + lockup!.right) / 2 - size.width / 2), `直向：站名組仍在中軸上（站名組 ${JSON.stringify(lockup)}）`).toBeLessThanOrEqual(2);
      }
      for (const [label, target] of [['海報人形', poster], ['引擎人形', engine], ...Object.entries(avoid)] as [string, Box][]) {
        const { x, y } = overlap(crest, target);
        expect(Math.min(x, y), `館徽與${label}重疊（x ${x.toFixed(1)}px、y ${y.toFixed(1)}px；兩軸都 > 0 才算重疊）：${note} / ${label} ${JSON.stringify(target)}`).toBeLessThanOrEqual(0);
      }
      const { opening } = others;
      expect(crest.left, `館徽在開場區內：${note}`).toBeGreaterThanOrEqual(opening.left - 0.5);
      expect(crest.right).toBeLessThanOrEqual(opening.right + 0.5);
      expect(crest.top).toBeGreaterThanOrEqual(opening.top - 0.5);
      expect(crest.bottom).toBeLessThanOrEqual(opening.bottom + 0.5);
      expect(crest.width, `館徽不能小到看不出來：${note}`).toBeGreaterThanOrEqual(64);
    });
  });
}

test.describe('館徽幾何：必測尺寸都有顯示館徽；太矮的橫向視窗不放，站名字級不被讓出的高度縮小', () => {
  test.use({ viewport: { width: 900, height: 600 } });

  test('900×600：館徽 display:none、站名字級仍是 min(8.5rem, 15.5vh) ＝ 93px', async ({ page }) => {
    await open(page);
    expect(await crestBox(page), '沒有占位').toBeNull();
    expect(await page.locator('.opening__title').evaluate((el) => getComputedStyle(el).fontSize)).toBe('93px');
  });
});

test.describe('橫向版面：館徽在站名正上方、對齊站名那一欄的中線', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('1440×900：館徽底在 h1 頂之上、水平中心與 h1 中心差 ≤ 2px；站名字級幾乎沒變（原本 136px，讓出館徽那一段後 ≥ 130px）', async ({ page }) => {
    await open(page);
    await settleAnimations(page);
    const m = await page.evaluate(() => {
      const c = document.querySelector('.opening__crest-img')!.getBoundingClientRect();
      const h = document.querySelector('.opening h1')!.getBoundingClientRect();
      return { crestBottom: c.bottom, crestCx: (c.left + c.right) / 2, h1Top: h.top, h1Cx: (h.left + h.right) / 2, font: getComputedStyle(document.querySelector('.opening__title')!).fontSize };
    });
    expect(m.crestBottom, '館徽在站名上方').toBeLessThanOrEqual(m.h1Top);
    expect(Math.abs(m.crestCx - m.h1Cx), `水平中心差（館徽 ${m.crestCx}、站名 ${m.h1Cx}）`).toBeLessThanOrEqual(2);
    expect(Number.parseFloat(m.font), `站名字級 ${m.font}`).toBeGreaterThanOrEqual(130);
    expect(Number.parseFloat(m.font)).toBeLessThanOrEqual(136);
  });
});

// ── 掃光 ──────────────────────────────────────────────────────────

test.describe('掃光：桌機跟著指標', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('指標在館徽上移動：--sheen-x／--sheen-y 跟著指標（館徽盒內的百分比）、標 data-pointer、自動掃過停下', async ({ page }) => {
    await open(page);
    await settleAnimations(page);
    const box = (await crestBox(page))!;
    await expect(sheenOf(page)).toHaveCSS('animation-name', 'crest-sweep'); // 指標還沒動過：自動掃過
    await expect(crestOf(page)).not.toHaveAttribute('data-pointer', /.*/);

    await page.mouse.move(box.left + box.width * 0.2, box.top + box.height * 0.3);
    await page.mouse.move(box.left + box.width * 0.25, box.top + box.height * 0.3);
    await expect.poll(() => near(() => sheenX(page), 25)).toBe(true);
    expect(await near(() => sheenY(page), 30), `--sheen-y ${await sheenY(page)}`).toBe(true);
    await expect(crestOf(page)).toHaveAttribute('data-pointer', '');
    await expect(sheenOf(page)).toHaveCSS('animation-name', 'none');

    await page.mouse.move(box.left + box.width * 0.75, box.top + box.height * 0.6);
    await expect.poll(() => near(() => sheenX(page), 75)).toBe(true);

    // 指標離館徽很遠：夾在 [-30%, 130%]
    await page.mouse.move(1439, box.bottom + 5);
    await expect.poll(() => sheenX(page)).toBe('130.0%');
    await page.mouse.move(2, box.bottom + 5);
    await expect.poll(() => sheenX(page)).toBe('-30.0%');
  });

  test('觸控的指標事件被忽略（手指拖動是捲動）：不標 data-pointer、不寫 --sheen-x', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: 200, clientY: 200 }));
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(crestOf(page)).not.toHaveAttribute('data-pointer', /.*/);
    expect(await sheenX(page)).toBe('');
  });

  test('掃光是漸層遮罩（mask-image）蓋在 logo 上：沒有 background-clip:text、沒有混色模式、沒有外發光', async ({ page }) => {
    await open(page);
    const style = await page.evaluate(() => {
      const out: Record<string, { clip: string; webkitClip: string; blend: string; mask: string; shadow: string; filter: string }> = {};
      for (const [name, el] of Object.entries({ wrapper: document.querySelector('.opening__crest')!, img: document.querySelector('.opening__crest-img')!, sheen: document.querySelector('.opening__crest-sheen')! })) {
        const s = getComputedStyle(el);
        out[name] = { clip: s.backgroundClip, webkitClip: s.getPropertyValue('-webkit-background-clip'), blend: s.mixBlendMode, mask: s.maskImage, shadow: s.boxShadow, filter: s.filter };
      }
      return out;
    });
    for (const [name, s] of Object.entries(style)) {
      expect(s.clip, `${name} background-clip`).not.toBe('text');
      expect(s.webkitClip, `${name} -webkit-background-clip`).not.toBe('text');
      expect(s.blend, `${name} mix-blend-mode`).toBe('normal');
      expect(s.shadow, `${name} box-shadow`).toBe('none');
    }
    expect(style.sheen!.mask, '掃光層的遮罩是漸層').toMatch(/gradient/);
    expect(style.sheen!.filter, '掃光層提亮').toMatch(/brightness/);
  });
});

test.describe('掃光：觸控裝置（沒有指標）自動緩慢掃過', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('動畫 crest-sweep 無限循環、跑著；--sheen-x 隨時間由 -50% 掃到 160%（每 9 秒一輪、1.4 秒後開始）', async ({ page }) => {
    await open(page);
    const sheen = sheenOf(page);
    await expect(sheen).toHaveCSS('animation-name', 'crest-sweep');
    await expect(sheen).toHaveCSS('animation-iteration-count', 'infinite');
    expect(await sheen.evaluate((el) => el.getAnimations()[0]?.playState)).toBe('running');

    // 直接定位時間軸（不等真實時間）：開始時在畫面外左側、一半時在中間、45% 之後停在畫面外右側
    const at = (ms: number) =>
      sheen.evaluate((el, time) => {
        const animation = el.getAnimations()[0]!;
        animation.pause();
        animation.currentTime = time;
        return Number.parseFloat(getComputedStyle(el).getPropertyValue('--sheen-x'));
      }, ms);
    expect(await at(1400), '剛開始').toBeCloseTo(-50, 0);
    expect(await at(1400 + 0.225 * 9000), '掃過一半（ease-in-out 的中點）').toBeCloseTo(55, -1);
    expect(await at(1400 + 0.6 * 9000), '掃完之後停在畫面外').toBeCloseTo(160, 0);
    expect(await at(1400 + 9000 + 0.225 * 9000), '下一輪').toBeCloseTo(55, -1);
  });

  test('沒有 data-pointer、也沒有 inline 的 --sheen-x（觸控事件不會停掉自動掃過）', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: 100, clientY: 700 })));
    await expect(crestOf(page)).not.toHaveAttribute('data-pointer', /.*/);
    expect(await sheenX(page)).toBe('');
  });
});

test.describe('掃光：沒有 WebGL 的靜態圖模式（非減少動態）照樣有', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('html.qi-static：館徽一直在，指標移動掃光照樣跟著', async ({ page }) => {
    watch(page);
    await blockWebGL(page);
    await page.goto('./');
    await expect(html(page)).toHaveClass(/qi-static/);
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'static');
    await settleAnimations(page);
    expect(await crestLuma(page), '館徽可見').toBeGreaterThan(LUMA_VISIBLE);
    const box = (await crestBox(page))!;
    await page.mouse.move(box.left + box.width * 0.4, box.top + box.height * 0.4);
    await page.mouse.move(box.left + box.width * 0.5, box.top + box.height * 0.4);
    await expect.poll(() => near(() => sheenX(page), 50)).toBe(true);
  });
});

test.describe('減少動態：館徽靜止', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('一直在（沒有擦出的進場）、沒有任何動畫、掃光靜止；指標移動不寫任何值', async ({ page }) => {
    watch(page);
    await page.goto('./');
    await expect(html(page)).toHaveClass(/qi-static/);
    await expect(html(page)).toHaveAttribute('data-qi-reason', 'reduced-motion');

    const state = await page.evaluate(() => {
      const crest = document.querySelector<HTMLElement>('.opening__crest')!;
      const sheen = document.querySelector('.opening__crest-sheen')!;
      const imgs = [...crest.querySelectorAll('img')];
      return {
        animations: crest.getAnimations({ subtree: true }).length,
        sheenAnimation: getComputedStyle(sheen).animationName,
        crestAnimation: getComputedStyle(crest).animationName,
        clip: getComputedStyle(crest).clipPath,
        opacity: getComputedStyle(crest).opacity,
        loaded: imgs.map((img) => img.complete && img.naturalWidth > 0),
        sheenX: getComputedStyle(sheen).getPropertyValue('--sheen-x'),
      };
    });
    expect(state.animations, '館徽與子元素沒有任何動畫').toBe(0);
    expect(state.sheenAnimation).toBe('none'); // 靜止：沒有掃光動畫
    expect(state.crestAnimation).toBe('none');
    expect(state.clip, '沒有被擦掉').toBe('none');
    expect(state.opacity).toBe('1');
    expect(state.loaded, '兩層圖都載入了').toEqual([true, true]);
    expect(state.sheenX, '掃光停在固定位置（--sheen-x 的初始值）').toBe('38%');
    expect(await crestLuma(page), '館徽可見').toBeGreaterThan(LUMA_VISIBLE);

    const box = (await crestBox(page))!;
    await page.mouse.move(box.left + box.width * 0.3, box.top + box.height * 0.3);
    await page.mouse.move(box.left + box.width * 0.6, box.top + box.height * 0.5);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(crestOf(page)).not.toHaveAttribute('data-pointer', /.*/);
    expect(await sheenX(page), '減少動態不掛指標監聽').toBe('');
  });
});

// ── 進場 ──────────────────────────────────────────────────────────

test.describe('進場：開場演出時在落地的衝擊波擦出', () => {
  test.use({ viewport: { width: 1440, height: 900 } });


  test('演出中先是擦掉的（黑底）；落地那一格才標 data-qi-crest="in" 並擦出，此時開場還沒結束', async ({ page }) => {
    await open(page, { intro: 'fresh', clock: true });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await settleAnimations(page);
    expect(await clipTop(page), '擦掉：整個被裁掉').toBe(100);
    expect(await crestLuma(page), '截圖上看不到館徽').toBeLessThan(LUMA_HIDDEN);
    await expect(html(page)).not.toHaveAttribute('data-qi-crest', /.*/);

    // 逐段推進時間；落地（開場計時 2.7 s）之前一直是擦掉的
    let landedAt = -1;
    for (let i = 0; i < 60 && landedAt < 0; i++) {
      await run(page, 100);
      if ((await html(page).getAttribute('data-qi-crest')) === 'in') landedAt = await introT(page);
      else expect(await introT(page), '落地之前不出現').toBeLessThan(2.8);
    }
    expect(landedAt, '落地（2.7 s）那一格出現').toBeGreaterThanOrEqual(2.7);
    expect(landedAt).toBeLessThan(3.0);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing'); // 衝擊波在演、開場還沒結束（3.4 s）
    expect(await crestAnimations(page), '落地這條路徑才有擦出與閃光').toEqual(expect.arrayContaining(['crest-wipe', 'crest-flash']));

    await settleAnimations(page); // 擦出 0.9 秒（真實時間）
    expect(await clipTop(page), '擦出完成').toBe(0);
    expect(await crestLuma(page), '截圖上看得到館徽').toBeGreaterThan(LUMA_VISIBLE);

    await run(page, 1000); // 開場演完（done）：不能把 'in' 改成別的值而打斷擦出
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'done');
    await expect(html(page)).toHaveAttribute('data-qi-crest', 'in');
  });

  test('落地之前按 Esc 略過：館徽直接顯示終態（不等落地、不跑擦出動畫）', async ({ page }) => {
    await open(page, { intro: 'fresh', clock: true });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await run(page, 500);
    await expect(html(page)).not.toHaveAttribute('data-qi-crest', /.*/);
    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'skipped');
    await expect(html(page)).toHaveAttribute('data-qi-crest', 'shown');
    expect(await crestAnimations(page), '沒有擦出與閃光').not.toEqual(expect.arrayContaining(['crest-wipe']));
    expect(await crestAnimations(page)).not.toEqual(expect.arrayContaining(['crest-flash']));
    expect(await clipTop(page), '一標上就是完整的').toBe(0);
    expect(await crestLuma(page), '不用等任何動畫').toBeGreaterThan(LUMA_VISIBLE);
  });

  test('落地之前捲走（RF2）：開場收尾、館徽直接顯示終態', async ({ page }) => {
    await open(page, { intro: 'fresh', clock: true });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await page.evaluate(() => window.scrollTo(0, 500));
    await run(page, 300);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'done');
    await expect(html(page)).toHaveAttribute('data-qi-crest', 'shown');
    expect(await crestAnimations(page), '沒有擦出與閃光').not.toEqual(expect.arrayContaining(['crest-wipe']));
    expect(await clipTop(page)).toBe(0);
  });

  test('再訪（這個工作階段看過開場）：不演開場，館徽一載入就是終態、沒有擦出動畫', async ({ page }) => {
    await open(page, { intro: 'seen' });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'skipped');
    await expect(html(page)).toHaveAttribute('data-qi-crest', 'shown');
    expect(await crestAnimations(page), '沒有擦出與閃光').not.toEqual(expect.arrayContaining(['crest-wipe']));
    expect(await crestAnimations(page)).not.toEqual(expect.arrayContaining(['crest-flash']));
    expect(await clipTop(page)).toBe(0);
    expect(await crestLuma(page), '不用等任何動畫').toBeGreaterThan(LUMA_VISIBLE);
  });

  test('再訪：首繪時就是完整可見——首頁腳本還沒載入（被扣住）也一樣，不靠任何腳本', async ({ page }) => {
    watch(page);
    await page.addInitScript(() => sessionStorage.setItem('liuyi:qi-intro', '1'));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
      setTimeout(resolve, 30_000);
    });
    await page.route(/index\.astro_astro_type_script_index_0_lang\.[^/]+\.js/, async (route) => {
      await gate;
      await route.continue();
    });
    try {
      await page.goto(HOME, { waitUntil: 'commit' });
      await page.waitForSelector('.opening__crest-img', { state: 'attached' });
      await expect(html(page), '首頁腳本確實還沒跑').not.toHaveAttribute('data-qi-ready', /.*/);
      await expect(html(page), '首繪前的行內腳本就標好了').toHaveAttribute('data-qi-crest', 'shown');
      await expect
        .poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.opening__crest img')].every((img) => img.complete && img.naturalWidth > 0)))
        .toBe(true);
      expect(await crestAnimations(page)).not.toEqual(expect.arrayContaining(['crest-wipe']));
      expect(await clipTop(page)).toBe(0);
      expect(await crestLuma(page), '腳本沒載入時館徽就看得到').toBeGreaterThan(LUMA_VISIBLE);
    } finally {
      release();
    }
  });

  test('引擎與形體載入卡住（.bin 永遠不回應）：館徽約 7 秒後以終態強制露出，8 秒內可見', async ({ page }) => {
    watch(page);
    await page.route(/\.bin(\?|$)/, () => {
      // 不回應、不放行：請求一直掛著
    });
    await page.goto(HOME);
    expect(await clipTop(page), '一開始（有 JS、引擎還沒好）是擦掉的').toBe(100);
    // 入館閘門擋著時保險還不起算（開場還沒開始）；按「入館」之後才起算 7 秒
    await enterGateNow(page);
    const startedAt = Date.now();
    // 閘門後面引擎照常 ready（氣流不需要形體）；卡住的是開場要用的 land、lift——開場一直等不到，保險才是館徽唯一的出路
    expect(await introT(page), '開場從沒起算').toBe(-1);
    await expect.poll(() => crestLuma(page), { timeout: 8000, intervals: [250], message: '8 秒內館徽要可見' }).toBeGreaterThan(LUMA_VISIBLE);
    expect(Date.now() - startedAt, '不是更早就出現（確實是逾時保險）').toBeGreaterThan(CREST_FAILSAFE_MS - 1500);
    await expect(html(page)).toHaveAttribute('data-qi-crest', 'shown');
    expect(await crestAnimations(page), '強制露出沒有擦出動畫').not.toEqual(expect.arrayContaining(['crest-wipe']));
    expect(await introT(page), '開場到最後都沒起算').toBe(-1);
  });

  test('?qi-crest-failsafe=<ms> 可注入：卡住的引擎在指定的毫秒後（不是 7 秒）以終態露出館徽', async ({ page }) => {
    watch(page);
    await page.route(/\.bin(\?|$)/, () => {
      // 不回應、不放行：請求一直掛著
    });
    await page.goto(`${HOME}&qi-crest-failsafe=1200`);
    expect(await clipTop(page), '一開始是擦掉的').toBe(100);
    await enterGateNow(page); // 保險從閘門收起才起算
    const startedAt = Date.now();
    await expect.poll(() => crestLuma(page), { timeout: 5000, intervals: [100], message: '注入的 1.2 秒到了館徽就要可見' }).toBeGreaterThan(LUMA_VISIBLE);
    expect(Date.now() - startedAt, '遠早於預設的 7 秒').toBeLessThan(CREST_FAILSAFE_MS - 2000);
    await expect(html(page)).toHaveAttribute('data-qi-crest', 'shown');
    expect(await introT(page), '開場從沒起算').toBe(-1);
  });

  test('?qi-crest-failsafe=off：保險關閉，卡住的引擎不會自己把館徽放出來', async ({ page }) => {
    watch(page);
    await page.route(/\.bin(\?|$)/, () => {
      // 不回應、不放行
    });
    await page.goto(`${HOME}&qi-crest-failsafe=off`);
    await enterGateNow(page);
    await page.waitForTimeout(2500);
    await expect(html(page)).not.toHaveAttribute('data-qi-crest', /.*/);
    expect(await clipTop(page), '一直是擦掉的').toBe(100);
  });

  test('非法值（abc）退回預設：2.5 秒時還沒露出（預設是 7 秒）', async ({ page }) => {
    watch(page);
    await page.route(/\.bin(\?|$)/, () => {
      // 不回應、不放行
    });
    await page.goto(`${HOME}&qi-crest-failsafe=abc`);
    await enterGateNow(page);
    await page.waitForTimeout(2500);
    await expect(html(page)).not.toHaveAttribute('data-qi-crest', /.*/);
  });

  test('開場一開始（引擎計時起算）就解除保險：保險時間比落地早，館徽也不會搶在落地之前露出，之後照常擦出', async ({ page }) => {
    watch(page);
    await page.goto(`${HOME}&qi-crest-failsafe=600`);
    await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
    await shapesLoaded(page); // 閘門期間預取的 land、lift 到了：按下「入館」後引擎計時當場起算（不然 0.6 秒的保險可能搶在形體載入之前到期）
    await enterGateNow(page); // 保險從閘門收起才起算，開場同時開始；引擎計時一起算就解除保險
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await page.waitForFunction(() => (window as unknown as W).__qi.debug.uniforms().uIntroT! >= 0, undefined, READY); // 計時真的起算
    await page.waitForTimeout(800); // 比保險（0.6 秒）久，但還沒到落地（從氣流起演，時間軸約 1.0 + 0.8 s；落地在 2.7 s）
    expect(await page.evaluate(() => (window as unknown as W).__qi.debug.uniforms().uIntroT!), '前提：還沒落地').toBeLessThan(2.6);
    await expect(html(page), '保險已解除，沒有搶先把館徽放出來').not.toHaveAttribute('data-qi-crest', /.*/);
    await expect(html(page)).toHaveAttribute('data-qi-crest', 'in', READY); // 落地才擦出
  });

  test('收尾（退回靜態圖）時清掉保險：之後保險的時間到了也不會去標 data-qi-crest', async ({ page }) => {
    watch(page);
    await page.route(/\.bin(\?|$)/, () => {
      // 不回應、不放行：引擎掛上了但第一個形體永遠載不到，保險一直在等
    });
    await page.goto(`${HOME}&qi-crest-failsafe=1500`);
    await enterGateNow(page); // 保險從閘門收起才起算：先進館讓計時器掛上，之後的收尾才清得到它
    // 引擎掛上後 WebGL context 遺失 → 退回靜態圖（shutdown）；在掛上之前送的事件沒有人聽，所以重複送到成功
    await expect
      .poll(
        async () => {
          await page.evaluate(() => document.querySelector('canvas[data-qi-canvas]')!.dispatchEvent(new Event('webglcontextlost')));
          return html(page).getAttribute('data-qi-mode');
        },
        { timeout: 20_000, intervals: [100] },
      )
      .toBe('static');
    await page.waitForTimeout(2500); // 超過 1.5 秒
    await expect(html(page), '計時器已清掉').not.toHaveAttribute('data-qi-crest', /.*/);
    expect(await crestOf(page).evaluate((el) => getComputedStyle(el).clipPath), '靜態圖由 CSS 直接露出').toBe('none');
  });

  test('開場演到一半 WebGL context 遺失：退回靜態圖，館徽立刻露出終態（不擦出）', async ({ page }) => {
    await open(page, { intro: 'fresh', clock: true });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await run(page, 1200);
    expect(await clipTop(page), '還沒落地：擦掉').toBe(100);
    await page.evaluate(() => {
      document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]')!.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext();
    });
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'static', { timeout: 1000 });
    await expect(html(page)).toHaveAttribute('data-qi-reason', 'context-lost');
    expect(await clipTop(page), '退回靜態圖：館徽露出').toBe(0);
    expect(await crestAnimations(page), '沒有擦出與閃光').not.toEqual(expect.arrayContaining(['crest-wipe']));
    expect(await crestLuma(page), '截圖上看得到館徽').toBeGreaterThan(LUMA_VISIBLE);
  });

  test('引擎掛不上（沒有 WebGL）：退回靜態圖，館徽不等任何事件、一直在', async ({ page }) => {
    watch(page);
    await blockWebGL(page);
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'static');
    expect(await crestOf(page).evaluate((el) => getComputedStyle(el).clipPath)).toBe('none');
    await expect(html(page)).not.toHaveAttribute('data-qi-crest', /.*/); // 靜態圖由 CSS 直接露出，不靠腳本標記
    expect(await crestLuma(page)).toBeGreaterThan(LUMA_VISIBLE);
  });
});

// ── 無障礙與傳輸量 ────────────────────────────────────────────────

test.describe('無障礙：純裝飾，站名已有 h1', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('外層 aria-hidden、兩層圖 alt=""，無障礙樹裡開場區沒有圖片、只有一個 h1', async ({ page }) => {
    await open(page);
    await expect(crestOf(page)).toHaveAttribute('aria-hidden', 'true');
    for (const img of await page.locator('.opening__crest img').all()) await expect(img).toHaveAttribute('alt', '');
    await expect(page.locator('.opening').getByRole('img')).toHaveCount(0);
    await expect(page.locator('.opening').getByRole('heading', { name: '六藝武術' })).toHaveCount(1);
    expect(await page.locator('.opening').getByText('六藝武術').count(), '站名文字只出現一次（館徽沒有重複朗讀）').toBe(1);
  });
});

for (const device of [
  { name: '桌機 1440×900', viewport: { width: 1440, height: 900 }, limit: 16 * 1024 },
  { name: '手機 390×844', viewport: { width: 390, height: 844 }, limit: 10 * 1024 },
]) {
  test.describe(`傳輸量：${device.name}`, () => {
    test.use({ viewport: device.viewport });

    test('館徽的圖是 webp、只下載一張（掃光層與底層共用）、小於 ' + device.limit / 1024 + ' KB', async ({ page }) => {
      const transfers = trackTransfers(page);
      await open(page);
      // 館徽的圖是 loading=lazy（不顯示的尺寸才不會下載），但引擎 ready 時它已經載好了：不讓首屏變慢
      expect(
        await page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.opening__crest img')].map((img) => img.complete && img.naturalWidth > 0)),
        '引擎 ready 時兩層圖都已載入',
      ).toEqual([true, true]);
      expect(await page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.opening__crest img')].map((img) => img.loading)), '首頁腳本一開始就把顯示的館徽圖改成 eager（不等引擎吃重時才有空檔的 lazy）').toEqual(['eager', 'eager']);
      await page.waitForLoadState('networkidle');
      const crest = transfers.filter((item) => /crest-lion[^/]*\.webp(\?|$)/.test(item.url));
      expect(crest.map((item) => item.url), '館徽的圖').toHaveLength(1);
      expect(totalBytes(crest), '館徽圖的大小').toBeLessThan(device.limit);
      test.info().annotations.push({ type: 'crest-bytes', description: `${totalBytes(crest)} B（${crest[0]!.url.split('/').pop()}）` });
      const loaded = await page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.opening__crest img')].map((img) => img.currentSrc));
      expect(new Set(loaded).size, '兩層挑到同一個候選').toBe(1);
    });
  });
}

// 館徽不顯示的尺寸（display:none）：圖是 loading=lazy，不顯示就不下載——不為看不到的東西付傳輸量
for (const size of [
  { name: '小筆電 900×600', width: 900, height: 600 },
  { name: '橫放手機 844×390', width: 844, height: 390 },
  { name: '舊手機 320×568', width: 320, height: 568 },
]) {
  test.describe(`傳輸量：館徽不顯示的尺寸 ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('沒有占位、不下載館徽的圖', async ({ page }) => {
      const transfers = trackTransfers(page);
      await open(page);
      await page.waitForLoadState('networkidle');
      expect(await crestBox(page), '館徽沒有占位').toBeNull();
      expect(await page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.opening__crest img')].map((img) => img.loading)), '沒有占位的維持 lazy').toEqual(['lazy', 'lazy']);
      expect(transfers.filter((item) => /crest-lion/.test(item.url)).map((item) => item.url), '沒有下載館徽的圖').toEqual([]);
    });
  });
}
