import { expect, test, type Page } from '@playwright/test';
import { BEATS, type BeatId } from '../../src/qi/config/poses';
import type { QiDebug } from '../../src/qi/engine/qi-stage';

// 首頁引擎接線（Task 19）：捲動模型、大人／小孩切換、開場閘門、視窗變動，跑在「正式首頁」上（不是 harness）。
// headless 的 WebGL 是軟體繪製：一律 ?qi-tier=min&qi-debug=1，時間用停住的假時鐘、只有 run 會推進；
// 只用 page.* 驅動，不碰 OS 層級的滑鼠鍵盤。
test.describe.configure({ mode: 'default', timeout: 120_000 });

const HOME = './?qi-tier=min&qi-debug=1';
const T0 = new Date('2026-01-01T08:00:00');
const T1 = new Date('2026-01-01T09:00:00');
const READY = { timeout: 30_000 };

const ADULT_POSES = ['land', 'dingzhou', 'chengchui', 'kao', 'jian', 'miaodao', 'spear', 'others', 'salute', 'flow', 'seal'];
const KID_POSES = ['land', 'kid-wushu', 'kid-defense-a', 'kid-defense-b', 'kid-weapon', 'miaodao', 'spear', 'others', 'salute', 'flow', 'seal'];

type QiGlobal = { ready: boolean; frames: number; tier: string; mode: string; debug?: QiDebug };
type W = { __qi: QiGlobal & { debug: QiDebug } };

/** 軟體 GL（SwiftShader）在讀回像素時印的效能提示；已知的雜訊（qi-engine.spec 同一條），其餘 warning 一律不允許。 */
const KNOWN_WARNING = /GPU stall due to ReadPixels/;

const seen = new WeakMap<Page, { errors: string[]; warnings: string[] }>();

interface OpenOptions {
  url?: string;
  /** 預設先標記「這個工作階段看過開場」（跳過開場）；'fresh' 才讓開場照演。 */
  intro?: 'seen' | 'fresh';
  /** 導覽之前（`addInitScript` 之類）要做的事。 */
  before?: (page: Page) => Promise<unknown>;
}

async function open(page: Page, options: OpenOptions = {}): Promise<void> {
  const log = { errors: [] as string[], warnings: [] as string[] };
  seen.set(page, log);
  page.on('pageerror', (error) => log.errors.push(`pageerror: ${error}`));
  page.on('console', (message) => {
    if (message.type() === 'error') log.errors.push(`console.error: ${message.text()}`);
    if (message.type() === 'warning') log.warnings.push(`console.warning: ${message.text()}`);
  });
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
}

test.afterEach(async ({ page }) => {
  const log = seen.get(page) ?? { errors: [], warnings: [] };
  expect(log.errors, '頁面全程不得有 pageerror 或 console.error').toEqual([]);
  expect(log.warnings.filter((w) => !KNOWN_WARNING.test(w)), '頁面全程不得有 console.warning（軟體繪製的 ReadPixels 效能提示除外）').toEqual([]);
});

const html = (page: Page) => page.locator('html');
const run = (page: Page, ms: number) => page.clock.runFor(ms);
const attr = (page: Page, name: string) => html(page).getAttribute(name);
const scatterOf = async (page: Page) => Number(await attr(page, 'data-qi-scatter'));
const uScatter = (page: Page) => page.evaluate(() => (window as unknown as W).__qi.debug.uniforms().uScatter!);
const generation = (page: Page) => page.evaluate(() => (window as unknown as W).__qi.debug.simGeneration());
const frames = (page: Page) => page.evaluate(() => (window as unknown as W).__qi.frames);
const pulses = (page: Page) => page.evaluate(() => (window as unknown as W).__qi.debug.pulseCount());
const canvasSize = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]')!;
    return { width: canvas.width, height: canvas.height };
  });

/** 讓該 beat 的中心對到視窗中央的 scrollY。 */
const beatCenterY = (page: Page, id: BeatId) =>
  page.evaluate((beat) => {
    const rect = document.querySelector(`[data-beat="${beat}"]`)!.getBoundingClientRect();
    return Math.round(rect.top + window.scrollY + rect.height / 2 - window.innerHeight / 2);
  }, id);

/** 讓兩個相鄰 beat 的邊界（前一個的底與後一個的頂的中點）對到視窗中央的 scrollY。 */
const boundaryY = (page: Page, before: BeatId, after: BeatId) =>
  page.evaluate(
    ([a, b]) => {
      const first = document.querySelector(`[data-beat="${a}"]`)!.getBoundingClientRect();
      const second = document.querySelector(`[data-beat="${b}"]`)!.getBoundingClientRect();
      return Math.round((first.bottom + second.top) / 2 + window.scrollY - window.innerHeight / 2);
    },
    [before, after] as const,
  );

/**
 * 改視窗大小，並等到頁面的 resize 事件處理完（測試的監聽註冊在首頁腳本之後，所以輪到它時首頁的處理已跑完）。
 * resize 事件由瀏覽器在下一次繪製時派送、不受假時鐘控制；不等的話，讀到的可能還是改大小之前的狀態。
 */
async function resizeTo(page: Page, width: number, height: number): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __resized: Promise<void> }).__resized = new Promise((resolve) => {
      window.addEventListener('resize', () => resolve(), { once: true });
    });
  });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => (window as unknown as { __resized: Promise<void> }).__resized);
}

const scrollToY = (page: Page, y: number) => page.evaluate((top) => window.scrollTo(0, top), y);
const scrollToBeat = async (page: Page, id: BeatId) => scrollToY(page, await beatCenterY(page, id));

test.describe('捲動：beat 對應姿勢與散開量（桌機 1440×900）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('逐個 beat 捲到中央：data-qi-pose 依序是大人的對應，停穩後 data-qi-scatter ≤ 0.05', async ({ page }) => {
    await open(page);
    for (const [index, beat] of BEATS.entries()) {
      await scrollToBeat(page, beat);
      await run(page, 200);
      await expect(html(page), beat).toHaveAttribute('data-qi-pose', ADULT_POSES[index]!);
      await expect(html(page), beat).toHaveAttribute('data-qi-beat', beat);
      await run(page, 1500);
      expect(await scatterOf(page), `${beat} 停穩`).toBeLessThanOrEqual(0.05);
    }
  });

  test('捲到兩個 beat 的邊界：scatter ≥ 0.9，捲離後回到 ≤ 0.05', async ({ page }) => {
    await open(page);
    for (let i = 1; i < BEATS.length; i++) {
      const [before, after] = [BEATS[i - 1]!, BEATS[i]!];
      await scrollToY(page, await boundaryY(page, before, after));
      await run(page, 200);
      expect(await scatterOf(page), `${before}｜${after} 邊界`).toBeGreaterThanOrEqual(0.9);
      await scrollToBeat(page, after);
      await run(page, 200);
      expect(await scatterOf(page), `${after} 中央`).toBeLessThanOrEqual(0.05);
    }
  });

  test('捲動速度餵給引擎：捲動中 uScrollSpeed > 0，停下後回到 0', async ({ page }) => {
    await open(page);
    await scrollToBeat(page, 'weapon-a');
    await run(page, 16);
    const moving = await page.evaluate(() => (window as unknown as W).__qi.debug.uniforms().uScrollSpeed!);
    expect(moving).toBeGreaterThan(0);
    await run(page, 3000);
    const still = await page.evaluate(() => (window as unknown as W).__qi.debug.uniforms().uScrollSpeed!);
    expect(still).toBeLessThan(0.01);
  });

  test('beat 的高度不等也對：把兵器第一段墊高後，邊界仍以實際高度為準', async ({ page }) => {
    await open(page);
    await page.addStyleTag({ content: '[data-beat="weapon-a"] { min-height: 2400px !important; }' });
    await page.evaluate(() => window.dispatchEvent(new Event('resize'))); // 版面變了，通知重算
    await run(page, 100);
    await scrollToBeat(page, 'weapon-a');
    await run(page, 300);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'jian');
    // 整個 weapon-a 很高：中心離兩側邊界都遠，離邊界 0.5 個視窗以外都是聚合的
    expect(await scatterOf(page)).toBeLessThanOrEqual(0.05);
    await scrollToY(page, await boundaryY(page, 'weapon-a', 'weapon-b'));
    await run(page, 200);
    expect(await scatterOf(page)).toBeGreaterThanOrEqual(0.9);
  });

  test('沒有任何 beat（隱藏、再整個移除）：不丟錯，引擎仍在、姿勢不變', async ({ page }) => {
    await open(page);
    await scrollToBeat(page, 'fist');
    await run(page, 200);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'dingzhou');

    // 全部高度 0：scrollState 回 index 0，但 beats[0] 存在且沒有高度
    await page.addStyleTag({ content: '[data-beat] { display: none !important; }' });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await run(page, 300);

    // 全部不存在：beats 是空陣列，beats[0] 是 undefined
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-beat]')) el.remove();
      window.dispatchEvent(new Event('resize'));
    });
    await run(page, 300);

    await expect(html(page)).toHaveAttribute('data-qi-ready', 'true');
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'dingzhou');
    expect(await frames(page)).toBeGreaterThan(0);
  });
});

test.describe('大人｜小孩切換（桌機 1440×900）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('按「小孩」：pose 換成小孩的對應；100 ms 時散開 > 0.5，1.5 s 後 ≤ 0.05', async ({ page }) => {
    await open(page);
    await scrollToBeat(page, 'fist');
    await run(page, 300);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'dingzhou');
    expect(await scatterOf(page)).toBeLessThanOrEqual(0.05);

    await page.locator('[data-audience-option="kid"]').click();
    await expect(html(page)).toHaveAttribute('data-audience', 'kid');
    await run(page, 100);
    expect(await scatterOf(page)).toBeGreaterThan(0.5);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'kid-wushu');
    await run(page, 1500);
    expect(await scatterOf(page)).toBeLessThanOrEqual(0.05);

    // 每個 beat 都換成小孩的對應
    for (const [index, beat] of BEATS.entries()) {
      await scrollToBeat(page, beat);
      await run(page, 200);
      await expect(html(page), beat).toHaveAttribute('data-qi-pose', KID_POSES[index]!);
    }
  });

  test('localStorage 預設小孩：第一個課程 beat 的 pose 就是小孩的，載入當下 scatter 不被切換觸發', async ({ page }) => {
    await open(page, {
      before: (p) => p.addInitScript(() => localStorage.setItem('liuyi:audience', 'kid')),
    });
    await expect(html(page)).toHaveAttribute('data-audience', 'kid');
    expect(await scatterOf(page), '載入當下').toBeLessThanOrEqual(0.05);
    await run(page, 300);
    expect(await scatterOf(page), '推進後').toBeLessThanOrEqual(0.05);
    await scrollToBeat(page, 'fist');
    await run(page, 300);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'kid-wushu');
    expect(await scatterOf(page)).toBeLessThanOrEqual(0.05);
  });

  test('有效 scatter 是 max(捲動, 切換)：切換剛按下時切換勝出，之後捲動的那份接手（不相加、不取代）', async ({ page }) => {
    await open(page);
    // 焦點在邊界前 0.15 個視窗高：u = 1/6，捲動的 scatter = sin(π/6) = 0.5
    const y = (await boundaryY(page, 'fist', 'combat-a')) - Math.round(900 * 0.15);
    await scrollToY(page, y);
    await run(page, 400);
    expect(await scatterOf(page)).toBeCloseTo(0.5, 1);
    expect(await uScatter(page)).toBeCloseTo(0.5, 1);

    await page.locator('[data-audience-option="kid"]').click();
    await run(page, 100); // switchScatter(100 ms) ≈ 0.89 > 0.5
    expect(await uScatter(page)).toBeGreaterThan(0.8);
    expect(await uScatter(page)).toBeLessThan(0.95);
    expect(await scatterOf(page)).toBeGreaterThan(0.8);

    await run(page, 500); // 600 ms：switchScatter ≈ 0.33 < 0.5，捲動那份接手
    expect(await uScatter(page)).toBeCloseTo(0.5, 1);
    await run(page, 1500); // 切換那份歸零，仍是捲動的 0.5
    expect(await uScatter(page)).toBeCloseTo(0.5, 1);
  });

  test('切換鈕黏性：停在 fist、weapon-c 時看得到、點得到；停在 opening、others 時看不到（不在視窗內，或被外框蓋住）', async ({ page }) => {
    await open(page);
    const kid = page.locator('[data-audience-option="kid"]');
    /** 按鈕中心點最上層的元素就是它（沒被別的東西蓋住、也在視窗內）。 */
    const reachable = () =>
      kid.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return top !== null && (top === el || el.contains(top));
      });
    for (const beat of ['fist', 'weapon-c'] as const) {
      await scrollToBeat(page, beat);
      await run(page, 100);
      await expect(kid, beat).toBeInViewport();
      expect(await reachable(), beat).toBe(true);
    }
    await scrollToBeat(page, 'others');
    await run(page, 100);
    await expect(kid, 'others').not.toBeInViewport({ ratio: 0 });
    // 頁首（scrollY = 0）時課程段的上緣正好落在視窗底端：切換鈕在幾何上與視窗相交，但整個被下緣的外框蓋住（點不到、看不到）。
    await scrollToBeat(page, 'opening');
    await run(page, 100);
    expect(await reachable(), 'opening').toBe(false);
  });

  test('教練卡片進入視窗中央：stage.pulse() 被呼叫（pulseCount 遞增）', async ({ page }) => {
    await open(page);
    const before = await pulses(page);
    await scrollToBeat(page, 'coaches');
    await run(page, 300);
    await expect.poll(() => pulses(page)).toBeGreaterThan(before);
  });
});

test.describe('視窗變動（RF1）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('高度縮 10%：不重建（tier 與 simGeneration 不變）、不重新取景（畫布緩衝尺寸不變）', async ({ page }) => {
    await open(page);
    const tier = await attr(page, 'data-qi-tier');
    const gen = await generation(page);
    const size = await canvasSize(page);

    await resizeTo(page, 1440, 810);
    await run(page, 100);
    expect(await attr(page, 'data-qi-tier')).toBe(tier);
    expect(await generation(page)).toBe(gen);
    expect(await canvasSize(page)).toEqual(size);
  });

  test('prev 是「上次取景時的尺寸」：9% → 17% 連續縮都不取景，累計超過 18% 才取景', async ({ page }) => {
    await open(page);
    const before = await canvasSize(page);
    const gen = await generation(page);

    for (const height of [820, 745]) {
      // 相對 900：−8.9%、−17.2%；若拿上一個 resize 事件當基準，每一步都只有 −9% 與 −9%
      await resizeTo(page, 1440, height);
      await run(page, 50);
      expect(await canvasSize(page), `高度 ${height}`).toEqual(before);
    }

    await resizeTo(page, 1440, 735); // −18.3%：超過門檻（相對上次取景的 900，不是相對 745）
    await run(page, 50);
    const after = await canvasSize(page);
    expect(after.height).toBe(735 - 72 - 56); // 100lvh − frame-top − frame-bottom
    expect(after.width).toBe(before.width);
    expect(await generation(page), '取景不重建模擬').toBe(gen);
  });

  test('寬度變動一律取景', async ({ page }) => {
    await open(page);
    const before = await canvasSize(page);
    await resizeTo(page, 1300, 900);
    await run(page, 50);
    expect((await canvasSize(page)).width).toBeLessThan(before.width);
  });

  test('轉向（390×844 → 844×390）：畫布尺寸更新、姿勢不變、不重建、frame 計數連續', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const portrait = await canvasSize(page);
    expect(portrait.width).toBe(390);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'land'); // 頁首
    const gen = await generation(page);
    const framesBefore = await frames(page);

    await resizeTo(page, 844, 390);
    await run(page, 200);
    const landscape = await canvasSize(page);
    expect(landscape.width).toBe(844);
    expect(landscape.height).not.toBe(portrait.height);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'land');
    expect(await generation(page)).toBe(gen);
    expect(await frames(page), 'frame 計數沒有歸零、仍在往前').toBeGreaterThan(framesBefore);

    // 帶著兵器姿勢轉向：寬窄翻轉，姿勢仍是 jian
    await resizeTo(page, 390, 844);
    await run(page, 100);
    await scrollToBeat(page, 'weapon-a');
    await run(page, 300);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'jian');
    await resizeTo(page, 844, 390);
    await run(page, 200);
    await scrollToBeat(page, 'weapon-a');
    await run(page, 300);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'jian');
    expect(await page.evaluate(() => (window as unknown as W).__qi.debug.pose())).toBe('jian');
    expect(await generation(page)).toBe(gen);
  });
});

test.describe('開場閘門（RF2、RF3）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('首次進站：開場演出 playing（略過鈕可見）→ 演完 done（略過鈕收起）；同一工作階段再載入為 skipped', async ({ page }) => {
    await open(page, { intro: 'fresh' });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await expect(page.locator('[data-skip-intro]')).toBeVisible();
    await run(page, 1000);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await run(page, 3500);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'done');
    await expect(page.locator('[data-skip-intro]')).toBeHidden();
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'land');
    expect(await page.evaluate(() => sessionStorage.getItem('liuyi:qi-intro'))).toBe('1');

    await page.reload();
    await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'skipped');
  });

  test('按「略過」：立刻 skipped、略過鈕收起、停在 land', async ({ page }) => {
    await open(page, { intro: 'fresh' });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await run(page, 800);
    await page.locator('[data-skip-intro]').click();
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'skipped');
    await expect(page.locator('[data-skip-intro]')).toBeHidden();
    await run(page, 300);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'land');
  });

  test('RF2：開場還在演就點段落跳轉「預約」：立刻收尾（done）、姿勢直接去 seal、不報錯', async ({ page }) => {
    await open(page, { intro: 'fresh' });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await run(page, 700);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');

    await page.locator('nav.home-rail').getByRole('link', { name: '預約' }).click();
    await run(page, 300);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'done');
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'seal');
    await expect(page.locator('[data-skip-intro]')).toBeHidden();
    await run(page, 2000);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'seal'); // 沒有被開場的 land 蓋回去
  });

  test('RF2：開場演到一半快速捲下去：同樣立刻收尾、姿勢直接去目標段落', async ({ page }) => {
    await open(page, { intro: 'fresh' });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await run(page, 1500); // 吸氣中
    await scrollToBeat(page, 'combat-a');
    await run(page, 300);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'done');
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'chengchui');
    await run(page, 2000);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'chengchui');
  });

  test('開場演到一半只往下捲一點（還在第一段）：開場一樣立刻收尾，引擎的開場計時歸零，姿勢仍是 land', async ({ page }) => {
    await open(page, { intro: 'fresh' });
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await run(page, 1500); // 吸氣中
    expect(await page.evaluate(() => (window as unknown as W).__qi.debug.uniforms().uIntroT!)).toBeGreaterThan(1);

    await scrollToY(page, Math.round(900 * 0.3)); // 超過「還停在頁首」的 0.25 個視窗高，但焦點仍在 opening
    await run(page, 100);
    await expect(html(page)).toHaveAttribute('data-qi-beat', 'opening');
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'done');
    expect(await page.evaluate(() => (window as unknown as W).__qi.debug.uniforms().uIntroT!), '引擎端的開場真的結束').toBe(-1);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'land');
  });

  test('RF3：localStorage／sessionStorage 讀寫都丟例外：頁面與引擎正常、切換可用、重新載入後開場仍演', async ({ page }) => {
    await open(page, {
      intro: 'fresh',
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
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'webgl');
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');

    await scrollToBeat(page, 'fist');
    await run(page, 300);
    await page.locator('[data-audience-option="kid"]').click();
    await expect(html(page)).toHaveAttribute('data-audience', 'kid');
    await expect(page.locator('[data-audience-option="kid"]')).toHaveAttribute('aria-pressed', 'true');
    await run(page, 300);
    await expect(html(page)).toHaveAttribute('data-qi-pose', 'kid-wushu');

    await scrollToY(page, 0);
    await run(page, 300);
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing'); // 沒有記憶：再演一次
    await expect(html(page)).toHaveAttribute('data-audience', 'adult'); // 也沒有記住對象
  });
});

test.describe('window.__qi（D27）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('正式頁（沒帶 qi-debug）：只有 ready、frames、tier、mode，沒有 debug、沒有 harness 的 __qiStage', async ({ page }) => {
    await open(page, { url: './?qi-tier=min' });
    const state = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown> & { __qi: Record<string, unknown> };
      return { keys: Object.keys(w.__qi).sort(), ready: w.__qi.ready, tier: w.__qi.tier, mode: w.__qi.mode, stage: typeof w.__qiStage };
    });
    expect(state).toEqual({ keys: ['frames', 'mode', 'ready', 'tier'], ready: true, tier: 'min', mode: 'webgl', stage: 'undefined' });
    await expect(html(page)).toHaveAttribute('data-qi-mode', 'webgl');
    await expect(html(page)).toHaveAttribute('data-qi-tier', 'min');

    const before = await frames(page);
    await run(page, 300);
    expect(await frames(page)).toBeGreaterThan(before);
  });

  test('?qi-debug=1 才多一個 debug', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => Object.keys((window as unknown as W).__qi).sort())).toEqual(['debug', 'frames', 'mode', 'ready', 'tier']);
  });
});

// ── 朱印預約（Task 21）─────────────────────────────────────────────
// 光點收進朱印：引擎量得到印的螢幕矩形（`sealRect`，聚合前是 null），`.seal-hit` 才定位到它並可點；
// 沒有引擎（減少動態、沒有 WebGL）時朱印是靜態圖，`.seal-hit` 對齊圖上的印。按鈕永遠是鍵盤與讀屏的入口。

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const SEAL_DEVICES = [
  { name: '桌機 1440×900', viewport: { width: 1440, height: 900 } },
  { name: '手機 390×844', viewport: { width: 390, height: 844 } },
] as const;
const LINE_DIALOG = '#line-dialog';
const BOOKING_BUTTON = '#booking a.button--solid';

const sealRect = (page: Page) => page.evaluate(() => (window as unknown as W).__qi.debug.sealRect());
const rectOf = (page: Page, selector: string): Promise<Rect> =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const device of SEAL_DEVICES) {
  test.describe(`朱印預約（引擎）：${device.name}`, () => {
    test.use({ viewport: device.viewport });

    test('聚合前沒有朱印矩形、.seal-hit 不可點；聚合後矩形在視窗內、框住朱紅的印、不壓到按鈕，.seal-hit 對齊它', async ({ page }) => {
      await open(page);
      expect(await sealRect(page), '開場段（不是 seal 姿勢）').toBeNull();
      await expect(page.locator('.seal-hit'), '開場段').toBeHidden();

      await scrollToBeat(page, 'booking');
      await run(page, 100);
      await expect(html(page)).toHaveAttribute('data-qi-pose', 'seal');
      expect(await sealRect(page), '剛換成 seal（光點還在飛）').toBeNull();
      await expect(page.locator('.seal-hit'), '光點還在飛').toBeHidden();

      // 矩形出現的那一刻，光點就該已經聚成印了（不是「時間到了」而光點還在飛）
      let waited = 100;
      while ((await sealRect(page)) === null && waited < 5000) {
        await run(page, 50);
        waited += 50;
      }
      expect(await sealRect(page), `聚合後（等了 ${waited} ms）`).not.toBeNull();
      expect(await page.evaluate(() => (window as unknown as W).__qi.debug.meanError()), '矩形出現的那一刻光點已聚合').toBeLessThan(0.06);
      await run(page, 1000);
      const rect = await sealRect(page);
      expect(rect, '再過 1 秒仍在').not.toBeNull();
      const { x, y, w, h } = rect!;
      const view = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
      expect(w).toBeGreaterThan(80);
      expect(h).toBeGreaterThan(80);
      expect(Math.abs(w / h - 1), '朱印是方的').toBeLessThan(0.1);
      expect(x, '在視窗內（左）').toBeGreaterThanOrEqual(0);
      expect(y, '在視窗內（上）').toBeGreaterThanOrEqual(0);
      expect(x + w, '在視窗內（右）').toBeLessThanOrEqual(view.w);
      expect(y + h, '在視窗內（下）').toBeLessThanOrEqual(view.h);
      expect(overlap(rect!, await rectOf(page, BOOKING_BUTTON)), '不壓到預約按鈕').toBe(false);

      // 光點真的聚成印了，而且印的紅都在這個矩形裡（量畫布像素）
      expect(await page.evaluate(() => (window as unknown as W).__qi.debug.meanError()), '光點聚合').toBeLessThan(0.03);
      const canvas = await rectOf(page, 'canvas[data-qi-canvas]');
      const reds = await page.evaluate(
        ([region, offset]) => {
          const debug = (window as unknown as W).__qi.debug;
          const inside = debug.snapshot({ x: region.x - offset.x, y: region.y - offset.y, w: region.w, h: region.h }).red;
          return { inside, all: debug.snapshot().red };
        },
        [rect!, canvas] as const,
      );
      expect(reds.all, '畫面上有朱紅').toBeGreaterThan(200);
      expect(reds.inside / reds.all, '朱紅都在矩形內').toBeGreaterThan(0.9);

      // .seal-hit 對齊矩形，且現在可見
      const hit = page.locator('.seal-hit');
      await expect(hit).toBeVisible();
      const placed = await rectOf(page, '.seal-hit');
      for (const key of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(placed[key] - rect![key]), `.seal-hit ${key}`).toBeLessThanOrEqual(2);
      expect(overlap(placed, await rectOf(page, BOOKING_BUTTON)), '.seal-hit 不壓到預約按鈕').toBe(false);

      // 捲離預約段：印散了又換姿勢，矩形回到 null、.seal-hit 不可點
      await scrollToBeat(page, 'pricing');
      await run(page, 300);
      expect(await sealRect(page), '回到收費段').toBeNull();
      await expect(hit, '回到收費段').toBeHidden();
    });

    test('點朱印（.seal-hit 的中心）開啟 LINE 視窗，Esc 關閉', async ({ page }) => {
      await open(page);
      await scrollToBeat(page, 'booking');
      await run(page, 3000);
      const rect = (await sealRect(page))!;
      expect(rect).not.toBeNull();
      await expect(page.locator(LINE_DIALOG)).toBeHidden();

      await page.mouse.click(rect.x + rect.w / 2, rect.y + rect.h / 2);
      await expect(page.locator(LINE_DIALOG)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator(LINE_DIALOG)).toBeHidden();

      await page.locator('.seal-hit').click(); // 透過元素點也一樣（Playwright 會檢查點擊位置沒被別的東西蓋住）
      await expect(page.locator(LINE_DIALOG)).toBeVisible();
    });

    test('鍵盤：Tab 到「預約體驗」按鈕（不會停在 .seal-hit）、Enter 開啟、Esc 關閉；.seal-hit 對讀屏與 Tab 隱藏', async ({ page }) => {
      await open(page);
      const hit = page.locator('.seal-hit');
      await expect(hit).toHaveAttribute('aria-hidden', 'true');
      await expect(hit).toHaveAttribute('tabindex', '-1');
      await expect(hit).toHaveAttribute('href', '#line');
      await expect(hit).toHaveAttribute('data-line-open', '');

      await page.locator('#pricing a').last().focus();
      await page.keyboard.press('Tab');
      await expect(page.locator(BOOKING_BUTTON)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator(LINE_DIALOG)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator(LINE_DIALOG)).toBeHidden();
      await expect(page.locator(BOOKING_BUTTON), '關閉後焦點回到按鈕').toBeFocused();

      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.classList.contains('seal-hit')), 'Tab 不會停在 .seal-hit').toBe(false);
    });
  });
}

for (const device of SEAL_DEVICES) {
  test.describe(`朱印預約（靜態圖：減少動態）：${device.name}`, () => {
    test.use({ viewport: device.viewport, reducedMotion: 'reduce' });

    test('朱印靜態圖可見；.seal-hit 對齊圖上的印（量圖上的紅色外框），點它與按鈕都開得了視窗', async ({ page }) => {
      await page.goto('./');
      await expect(html(page)).toHaveAttribute('data-qi-mode', 'static');
      const still = page.locator('#booking .beat__still');
      await still.scrollIntoViewIfNeeded();
      await expect(still).toBeVisible();
      await expect.poll(() => still.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);

      // 印在圖上的位置：紅色像素的外框，換算成頁面座標（object-fit: contain）
      const mark = await still.evaluate((img: HTMLImageElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let [x0, y0, x1, y1] = [canvas.width, canvas.height, -1, -1];
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            if (data[i]! > 110 && data[i + 1]! < 70 && data[i + 2]! < 70) {
              x0 = Math.min(x0, x);
              x1 = Math.max(x1, x);
              y0 = Math.min(y0, y);
              y1 = Math.max(y1, y);
            }
          }
        }
        const box = img.getBoundingClientRect();
        const scale = Math.min(box.width / canvas.width, box.height / canvas.height);
        const left = box.left + (box.width - canvas.width * scale) / 2;
        const top = box.top + (box.height - canvas.height * scale) / 2;
        return { x: left + x0 * scale, y: top + y0 * scale, w: (x1 - x0 + 1) * scale, h: (y1 - y0 + 1) * scale };
      });
      expect(mark.w, '圖上找得到朱紅的印').toBeGreaterThan(40);

      const hit = page.locator('.seal-hit');
      await expect(hit).toBeVisible();
      const placed = await rectOf(page, '.seal-hit');
      const slack = Math.max(4, mark.w * 0.04);
      for (const key of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(placed[key] - mark[key]), `.seal-hit ${key} 對齊靜態圖的印`).toBeLessThanOrEqual(slack);
      expect(overlap(placed, await rectOf(page, BOOKING_BUTTON)), '.seal-hit 不壓到預約按鈕').toBe(false);

      await hit.click();
      await expect(page.locator(LINE_DIALOG)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator(LINE_DIALOG)).toBeHidden();

      await page.locator(BOOKING_BUTTON).click();
      await expect(page.locator(LINE_DIALOG)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator(LINE_DIALOG)).toBeHidden();
    });
  });
}

test.describe('頁尾：LINE 區塊不變，加崇羲篆體的姓名標示（CC BY-ND 3.0 TW）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('#line 與 QR 不變；標示在頁尾、看得見、不壓到 QR、字型與版權行一致', async ({ page }) => {
    await page.goto('./');
    const line = page.locator('footer #line');
    await line.scrollIntoViewIfNeeded();
    await expect(line.getByRole('heading', { name: '預約體驗', level: 2 })).toBeVisible();
    await expect(line.getByRole('img', { name: /LINE 好友 QR code/ })).toBeVisible();
    await expect(line.getByRole('link', { name: '用 LINE 加入' })).toHaveAttribute('href', 'https://lin.ee/CIOGR8n');

    const credit = page.locator('footer').getByText('印文字形：崇羲篆體（中央研究院，CC BY-ND 3.0 TW）');
    await expect(credit).toHaveCount(1);
    await credit.scrollIntoViewIfNeeded();
    await expect(credit).toBeVisible();
    const box = await credit.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    expect(overlap(await rectOf(page, 'footer .site-footer__qr'), box), '不壓到 QR').toBe(false);
    const family = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily);
    expect(await credit.evaluate((el) => getComputedStyle(el).fontFamily), '字型與版權行一致（站上的 TW-Kai）').toBe(await family('footer .site-footer__copyright'));
  });
});
