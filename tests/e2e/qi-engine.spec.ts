import { expect, test, type Page } from '@playwright/test';
import type { QiStage } from '../../src/qi/engine/qi-stage';

// 「氣」光點引擎核心（Task 15）：GPGPU 模擬、掌風、換招衝量、光暈，跑在開發用的 harness 頁。
// headless 的 WebGL 是軟體繪製（SwiftShader）：一律 ?qi-tier=min&qi-debug=1（光暈那一個測試除外），
// 時間用停住的假時鐘，只有 runFor 會推進；不碰 OS 層級的滑鼠鍵盤（page.mouse 是 CDP 在頁面內送事件）。
test.describe.configure({ mode: 'default', timeout: 120_000 });

const HARNESS = './lab/qi-harness/?qi-tier=min&qi-debug=1';
const T0 = new Date('2026-01-01T08:00:00');
const T1 = new Date('2026-01-01T09:00:00');
const READY = { timeout: 30_000 };

type Debug = NonNullable<QiStage['debug']>;
type W = { __qiStage: QiStage & { debug: Debug } };

/**
 * 頁面內的 stage（debug 一定在，因為網址帶了 qi-debug=1）。`open` 用 init script 把它裝到 window 上，
 * 所以 `page.evaluate` 的回呼可以直接呼叫（回呼是序列化到頁面裡跑的，帶不進測試檔的函式）。
 */
declare function stageOf(): QiStage & { debug: Debug };

const errors = new WeakMap<Page, string[]>();

async function open(page: Page, url = HARNESS): Promise<void> {
  const seen: string[] = [];
  errors.set(page, seen);
  page.on('pageerror', (error) => seen.push(`pageerror: ${error}`));
  page.on('console', (message) => {
    if (message.type() === 'error') seen.push(`console.error: ${message.text()}`);
  });
  await page.addInitScript(() => {
    (window as unknown as { stageOf: () => unknown }).stageOf = () => (window as unknown as W).__qiStage;
  });
  await page.clock.install({ time: T0 });
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-harness', 'ready', READY);
  await page.clock.pauseAt(T1);
}

test.afterEach(async ({ page }) => {
  expect(errors.get(page) ?? [], '頁面全程不得有 pageerror 或 console.error').toEqual([]);
});

const run = (page: Page, ms: number) => page.clock.runFor(ms);
const meanError = (page: Page) => page.evaluate(() => stageOf().debug.meanError());
const setPose = (page: Page, pose: Parameters<QiStage['setPose']>[0], burst?: boolean) =>
  page.evaluate(([p, b]) => stageOf().setPose(p, b === undefined ? undefined : { burst: b }), [pose, burst] as const);
const generation = (page: Page) => page.evaluate(() => stageOf().debug.simGeneration());
const uniforms = (page: Page) => page.evaluate(() => stageOf().debug.uniforms());
const snapshot = (page: Page) => page.evaluate(() => stageOf().debug.snapshot());

test.describe('光點引擎核心（桌機，tier=min）', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('setPose("land") 推進 3 秒：畫面有東西、有亮部，光點聚回目標', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    await run(page, 3000);
    const shot = await snapshot(page);
    expect(shot.width).toBeGreaterThan(1000);
    expect(shot.covered).toBeGreaterThanOrEqual(0.01);
    expect(shot.bright).toBeGreaterThanOrEqual(0.0005);
    expect(await meanError(page)).toBeLessThan(0.05);
  });

  test('換招（burst）：300 ms 時炸開，再 3 秒後聚合', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    await run(page, 2000);
    expect(await meanError(page)).toBeLessThan(0.05);

    await setPose(page, 'dingzhou'); // 預設 burst: true
    await run(page, 300);
    expect(await meanError(page)).toBeGreaterThan(0.3);
    await run(page, 3000);
    expect(await meanError(page)).toBeLessThan(0.05);
  });

  test('burst: false 不炸開：同一組換招，300 ms 時的誤差明顯小於 burst', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    await run(page, 2500);

    await setPose(page, 'dingzhou', false);
    await run(page, 300);
    const calm = await meanError(page);
    await run(page, 3000);
    await setPose(page, 'land', false);
    await run(page, 3000);

    await setPose(page, 'dingzhou', true);
    await run(page, 300);
    const burst = await meanError(page);
    expect(burst).toBeGreaterThan(calm * 1.5);
  });

  test('掌風：快速劃過人形，周圍的光點速度遠高於劃過前', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    await run(page, 2500);

    const center = await page.evaluate(() => stageOf().debug.project(0, 1, 0));
    const baseline = await page.evaluate(([x, y]) => stageOf().debug.speedNear(x, y, 80), [center.x, center.y] as const);

    await page.mouse.move(center.x - 260, center.y);
    await run(page, 16);
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(center.x - 260 + i * 65, center.y);
      await run(page, 16);
    }
    const swept = await page.evaluate(([x, y]) => stageOf().debug.speedNear(x, y, 80), [center.x, center.y] as const);
    expect(swept).toBeGreaterThan(Math.max(baseline, 1e-3) * 3);
  });

  test('resize 只動相機與 RT，不重建模擬；setTier 才重建（同一級也重建）', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    await run(page, 500);

    const before = await generation(page);
    for (const [w, h] of [
      [1000, 700],
      [1280, 720],
      [900, 900],
      [700, 1000],
      [1280, 720],
    ] as const) {
      await page.evaluate(([a, b]) => stageOf().resize(a, b), [w, h] as const);
    }
    expect(await generation(page)).toBe(before);

    await page.evaluate(() => stageOf().setTier('min'));
    expect(await generation(page)).toBe(before + 1);
    await page.evaluate(() => stageOf().setTier('min'));
    expect(await generation(page)).toBe(before + 2);
    expect(await page.evaluate(() => stageOf().debug.tier())).toBe('min');
  });

  test('setTier 保留姿勢：重建後光點直接落在目標上（不從遠處飛來），再給它時間也維持聚合', async ({ page }) => {
    await open(page);
    await setPose(page, 'kao');
    await run(page, 1500);

    await page.evaluate(() => stageOf().setTier('low')); // 112² → 144²
    expect(await page.evaluate(() => stageOf().debug.tier())).toBe('low');
    expect(await page.evaluate(() => stageOf().debug.pose())).toBe('kao');
    expect(await meanError(page)).toBeLessThan(0.01); // 還沒推進任何一格，就已經在目標上
    const shot = await snapshot(page); // 重建完立刻補畫，不是黑畫面
    expect(shot.covered).toBeGreaterThanOrEqual(0.01);
    await run(page, 1500);
    expect(await meanError(page)).toBeLessThan(0.05);
  });

  test('resize 不閃：改畫布大小後立刻有畫面，姿勢不變', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    await run(page, 2000);
    await page.evaluate(() => stageOf().resize(1100, 640));
    const shot = await snapshot(page); // 沒有推進時間：看的是 resize 當下補畫的那一格
    expect(shot.width).toBe(1100);
    expect(shot.covered).toBeGreaterThanOrEqual(0.01);
    expect(await page.evaluate(() => stageOf().debug.pose())).toBe('land');
  });

  test('兵器擺放依視窗寬窄：寬轉窄時重展開目標（不重建模擬、不給衝量），再聚回新的位置', async ({ page }) => {
    await open(page);
    await setPose(page, 'spear');
    await run(page, 2000);
    expect(await meanError(page)).toBeLessThan(0.05);
    const before = await generation(page);

    await page.evaluate(() => stageOf().resize(700, 1000)); // 寬 → 窄：長槍變短、傾角變大
    expect(await meanError(page)).toBeGreaterThan(0.2); // 目標換了，光點還在舊位置
    expect(await generation(page)).toBe(before);
    expect((await uniforms(page)).uImpulsePower).toBe(0);
    await run(page, 2500);
    expect(await meanError(page)).toBeLessThan(0.05);
    expect((await snapshot(page)).covered).toBeGreaterThanOrEqual(0.004);

    await page.evaluate(() => stageOf().resize(1280, 720)); // 窄 → 寬：換回去
    expect(await meanError(page)).toBeGreaterThan(0.2);
    await run(page, 2500);
    expect(await meanError(page)).toBeLessThan(0.05);
  });

  test('每個姿勢都畫得出來並聚得回目標（含朱印的向內收衝量、收費段的氣流）', async ({ page }) => {
    await open(page);
    const poses = [
      'lift', 'land', 'dingzhou', 'chengchui', 'kao', 'jian', 'miaodao', 'spear', 'others', 'salute', 'flow', 'seal',
      'kid-wushu', 'kid-defense-a', 'kid-defense-b', 'kid-weapon',
    ] as const;
    for (const pose of poses) {
      await setPose(page, pose);
      await run(page, 2500);
      expect(await meanError(page), `${pose} 沒有聚回目標`).toBeLessThan(0.05);
      expect((await snapshot(page)).covered, `${pose} 畫面是空的`).toBeGreaterThanOrEqual(0.01);
    }
    // 朱印是朱紅色
    await setPose(page, 'seal');
    await run(page, 2500);
    expect((await snapshot(page)).red).toBeGreaterThan(1000);
  });

  test('朱印的衝量是向內收：衝量那一格過後，平均速度的徑向分量為正（往中心）；震腳（模式 2）則是往外', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    await run(page, 2500);
    await setPose(page, 'seal'); // mode 3：往中心收
    await run(page, 16); // 只推進衝量發生的那一格：此時彈簧與旋渦的影響還小，量到的幾乎就是衝量
    expect(await page.evaluate(() => stageOf().debug.radialVelocity())).toBeGreaterThan(0.5);

    await run(page, 3000);
    await setPose(page, 'seal', false);
    await setPose(page, 'land'); // mode 2：從腳下往四周
    await run(page, 16);
    expect(await page.evaluate(() => stageOf().debug.radialVelocity())).toBeLessThan(0);
  });

  test('setScatter／setScrollSpeed 接上力場：散開時彈簧鬆、旋渦強，放開後聚回', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    await run(page, 2500);
    const calm = await uniforms(page);
    expect(calm.uSpring).toBeCloseTo(26, 5); // SPRING
    expect(calm.uCurl).toBeCloseTo(0.32, 5);

    await page.evaluate(() => {
      stageOf().setScatter(1);
      stageOf().setScrollSpeed(3);
    });
    await run(page, 1500);
    const loose = await uniforms(page);
    expect(loose.uScatter).toBe(1);
    expect(loose.uSpring).toBeCloseTo(26 * 0.18, 5);
    expect(loose.uCurl).toBeCloseTo(0.32 + 1.3 + 3 * 0.35, 5);
    expect(await meanError(page)).toBeGreaterThan(0.15); // 光點被放開，人形散了

    await page.evaluate(() => {
      stageOf().setScatter(0);
      stageOf().setScrollSpeed(0);
    });
    await run(page, 3000);
    expect(await meanError(page)).toBeLessThan(0.05);
  });

  test('輸入不合法也不壞：NaN／負值／超出範圍會被夾住，未知姿勢與未知 tier 會 reject', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    await page.evaluate(() => {
      stageOf().setScatter(Number.NaN);
      stageOf().setScrollSpeed(-5);
    });
    await run(page, 100);
    let u = await uniforms(page);
    expect(u.uScatter).toBe(0);
    expect(u.uScrollSpeed).toBe(0);
    await page.evaluate(() => stageOf().setScatter(7));
    u = await uniforms(page);
    expect(u.uScatter).toBe(1);

    const unknownPose = await page.evaluate(() => stageOf().setPose('nope' as never).then(() => 'ok', (e: Error) => `${e.name}: ${e.message}`));
    expect(unknownPose).toMatch(/RangeError: Unknown pose/);
    const unknownTier = await page.evaluate(() => stageOf().setTier('ultra' as never).then(() => 'ok', (e: Error) => `${e.name}: ${e.message}`));
    expect(unknownTier).toMatch(/RangeError: Unknown tier/);
    expect(await page.evaluate(() => stageOf().debug.tier())).toBe('min');
  });

  test('連續 setPose：以最後一次為準（先到的載入不會蓋掉後來的）', async ({ page }) => {
    await open(page);
    await page.evaluate(() => Promise.all([stageOf().setPose('jian'), stageOf().setPose('miaodao'), stageOf().setPose('kao')]));
    expect(await page.evaluate(() => stageOf().debug.pose())).toBe('kao');
    await run(page, 2500);
    expect(await meanError(page)).toBeLessThan(0.05);
  });

  test('pulse：計數遞增、給一次輕衝量但不拆散人形；feedFrameTime 累計虛擬時間', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    await run(page, 2500);
    expect(await page.evaluate(() => stageOf().debug.pulseCount())).toBe(0);
    await page.evaluate(() => {
      stageOf().pulse();
      stageOf().pulse(2);
    });
    expect(await page.evaluate(() => stageOf().debug.pulseCount())).toBe(2);
    await run(page, 200);
    expect(await meanError(page)).toBeLessThan(0.3); // hold: 0，彈簧不鬆
    await run(page, 2000);
    expect(await meanError(page)).toBeLessThan(0.05);

    await page.evaluate(() => {
      stageOf().debug.feedFrameTime(16);
      stageOf().debug.feedFrameTime(40);
    });
    expect((await uniforms(page)).virtualTimeMs).toBe(56);
  });

  test('dispose 之後不再畫、不報錯，重複呼叫與之後的 setPose 也無妨', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    await run(page, 500);
    await page.evaluate(() => stageOf().dispose());
    const t = (await uniforms(page)).uTime;
    await run(page, 1000);
    expect((await uniforms(page)).uTime).toBe(t);
    await page.evaluate(() => stageOf().dispose()); // 重複呼叫無妨
    await page.evaluate(() => stageOf().setPose('kao')); // dispose 之後呼叫也不報錯
  });

  test('沒有 ?qi-debug=1：stage.debug 不存在', async ({ page }) => {
    await open(page, './lab/qi-harness/?qi-tier=min');
    expect(await page.evaluate(() => 'debug' in (window as unknown as W).__qiStage)).toBe(false);
    await page.evaluate(() => (window as unknown as W).__qiStage.setPose('land'));
    await run(page, 500);
  });
});

test.describe('光暈（桌機級 tier=high）', () => {
  test.use({ viewport: { width: 960, height: 600 } });

  test('開光暈時走 RT 與合成：畫面有東西、點的像素比例是半解析度，光暈讓涵蓋面積比 min 大', async ({ page }) => {
    await open(page, './lab/qi-harness/?qi-tier=high&qi-debug=1');
    expect(await page.evaluate(() => stageOf().debug.tier())).toBe('high');
    await setPose(page, 'land');
    await run(page, 1500);
    expect((await uniforms(page)).uPixelRatio).toBe(0.5); // DPR 1 × 場景 RT 的 1/2
    const shot = await snapshot(page);
    expect(shot.covered).toBeGreaterThan(0.06);
    expect(shot.bright).toBeGreaterThan(0.01);
    expect(await meanError(page)).toBeLessThan(0.05);

    // 降到 min（沒有光暈）：點的像素比例回到 1，而且仍有畫面
    await page.evaluate(() => stageOf().setTier('min'));
    expect((await uniforms(page)).uPixelRatio).toBe(1);
    expect((await snapshot(page)).covered).toBeGreaterThanOrEqual(0.01);
  });
});

test.describe('減少動態（reducedMotion）', () => {
  test.use({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });

  test('不跑模擬、不排 rAF：姿勢直接畫在目標上，時間推進也不動', async ({ page }) => {
    await open(page);
    await setPose(page, 'dingzhou');
    const shot = await snapshot(page); // 沒有推進任何時間
    expect(shot.covered).toBeGreaterThanOrEqual(0.01);
    expect(shot.bright).toBeGreaterThanOrEqual(0.0005);
    expect(await meanError(page)).toBe(0);
    await run(page, 1000);
    expect((await uniforms(page)).uTime).toBe(0);

    await setPose(page, 'kao'); // 換招直接換，沒有炸開
    expect(await meanError(page)).toBe(0);
    await page.evaluate(() => stageOf().resize(900, 600));
    expect((await snapshot(page)).covered).toBeGreaterThanOrEqual(0.01);
    await page.evaluate(() => stageOf().setTier('low'));
    expect((await snapshot(page)).covered).toBeGreaterThanOrEqual(0.01);
  });
});
