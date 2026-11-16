import { expect, test, type Page } from '@playwright/test';
import type { QiStage } from '../../src/qi/engine/qi-stage';

// 「氣」光點引擎核心（Task 15）：GPGPU 模擬、掌風、換招衝量、光暈，跑在測試專用的 harness 頁（/__test/qi-harness/，只在 npm run build:harness 的 dist-harness 裡，由 playwright 的 engine project 服務）。
// headless 的 WebGL 是軟體繪製（SwiftShader）：一律 ?qi-tier=min&qi-debug=1（光暈那一個測試除外），
// 時間用停住的假時鐘，只有 runFor 會推進；不碰 OS 層級的滑鼠鍵盤（page.mouse 是 CDP 在頁面內送事件）。
test.describe.configure({ mode: 'default', timeout: 120_000 });

const HARNESS = './__test/qi-harness/?qi-tier=min&qi-debug=1';
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

interface Seen {
  errors: string[];
  warnings: string[];
  /** 預期會出現的 warning（模擬沒有某個擴充的裝置時，three 會自己印「extension not supported」）。 */
  expected: RegExp[];
}
const seenBy = new WeakMap<Page, Seen>();

interface OpenOptions {
  /** 讓 `getContext('webgl2').getExtension(name)` 回 null 的擴充（模擬沒有這些擴充的裝置）。 */
  blockExtensions?: string[];
  /** 預期 harness 掛上 stage（ready）還是掛不上（error）。 */
  expect?: 'ready' | 'error';
}

async function open(page: Page, url = HARNESS, options: OpenOptions = {}): Promise<void> {
  const seen: Seen = { errors: [], warnings: [], expected: (options.blockExtensions ?? []).map((name) => new RegExp(`${name} extension not supported`)) };
  seenBy.set(page, seen);
  page.on('pageerror', (error) => seen.errors.push(`pageerror: ${error}`));
  page.on('console', (message) => {
    if (message.type() === 'error') seen.errors.push(`console.error: ${message.text()}`);
    if (message.type() === 'warning') seen.warnings.push(`console.warning: ${message.text()}`);
  });
  await page.addInitScript(() => {
    (window as unknown as { stageOf: () => unknown }).stageOf = () => (window as unknown as W).__qiStage;
  });
  if (options.blockExtensions?.length) {
    await page.addInitScript((blocked) => {
      const proto = WebGL2RenderingContext.prototype as unknown as { getExtension(name: string): unknown };
      const original = proto.getExtension;
      proto.getExtension = function (this: WebGL2RenderingContext, name: string) {
        return blocked.includes(name) ? null : original.call(this, name);
      };
    }, options.blockExtensions);
  }
  await page.clock.install({ time: T0 });
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-harness', options.expect ?? 'ready', READY);
  await page.clock.pauseAt(T1);
}

/** Chromium 在 debug 讀回像素時印的效能提示（warning）；已知的雜訊，其餘 warning 一律不允許。 */
const KNOWN_WARNING = /GPU stall due to ReadPixels/;

test.afterEach(async ({ page }) => {
  const seen = seenBy.get(page) ?? { errors: [], warnings: [], expected: [] };
  expect(seen.errors, '頁面全程不得有 pageerror 或 console.error').toEqual([]);
  expect(
    seen.warnings.filter((w) => !KNOWN_WARNING.test(w) && !seen.expected.some((re) => re.test(w))),
    '頁面全程不得有 console.warning（已知的 ReadPixels 效能提示、與刻意封鎖的擴充相對應的 three 提示除外）',
  ).toEqual([]);
});

const run = (page: Page, ms: number) => page.clock.runFor(ms);
const meanError = (page: Page) => page.evaluate(() => stageOf().debug.meanError());
const setPose = (page: Page, pose: Parameters<QiStage['setPose']>[0], burst?: boolean) =>
  page.evaluate(([p, b]) => stageOf().setPose(p, b === undefined ? undefined : { burst: b }), [pose, burst] as const);
const generation = (page: Page) => page.evaluate(() => stageOf().debug.simGeneration());
const uniforms = (page: Page) => page.evaluate(() => stageOf().debug.uniforms());
const snapshot = (page: Page) => page.evaluate(() => stageOf().debug.snapshot());
const draws = (page: Page) => page.evaluate(() => stageOf().debug.draws());
const resources = (page: Page) => page.evaluate(() => stageOf().debug.resources());

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
    const drawn = await draws(page);
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
    expect(await draws(page), '每次 resize 補畫一格（時鐘停住，沒有 rAF 的格）').toBe(drawn + 5);

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

    const drawn = await draws(page);
    await page.evaluate(() => stageOf().setTier('low')); // 112² → 144²
    expect(await draws(page), 'setTier 重建清掉了緩衝，要立刻補畫一格（snapshot 自己會重畫，所以看計數）').toBe(drawn + 1);
    expect(await page.evaluate(() => stageOf().debug.tier())).toBe('low');
    expect(await page.evaluate(() => stageOf().debug.pose())).toBe('kao');
    expect(await meanError(page)).toBeLessThan(0.01); // 還沒推進任何一格，就已經在目標上
    expect((await snapshot(page)).covered).toBeGreaterThanOrEqual(0.01);
    await run(page, 1500);
    expect(await meanError(page)).toBeLessThan(0.05);
  });

  test('resize 不閃：改畫布大小後立刻有畫面，姿勢不變', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    await run(page, 2000);
    const drawn = await draws(page);
    await page.evaluate(() => stageOf().resize(1100, 640));
    expect(await draws(page), 'resize 立刻補畫一格，不等下一個 rAF').toBe(drawn + 1);
    const shot = await snapshot(page);
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
    const drawn = await draws(page);

    await page.evaluate(() => stageOf().resize(700, 1000)); // 寬 → 窄：長槍變短、傾角變大
    expect(await draws(page), '翻轉重展開目標也只補畫一格').toBe(drawn + 1);
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
    await open(page, './__test/qi-harness/?qi-tier=min');
    expect(await page.evaluate(() => 'debug' in (window as unknown as W).__qiStage)).toBe(false);
    await page.evaluate(() => (window as unknown as W).__qiStage.setPose('land'));
    await run(page, 500);
  });
});

test.describe('光暈（桌機級 tier=high）', () => {
  test.use({ viewport: { width: 960, height: 600 } });

  test('開光暈時走 RT 與合成：畫面有東西、場景 RT 是全解析度（點大小不縮），光暈讓涵蓋面積比 min 大', async ({ page }) => {
    await open(page, './__test/qi-harness/?qi-tier=high&qi-debug=1');
    expect(await page.evaluate(() => stageOf().debug.tier())).toBe('high');
    await setPose(page, 'land');
    await run(page, 1500);
    expect((await uniforms(page)).uPixelRatio).toBe(1); // DPR 1 × 場景 RT 的比例 1（Task 16：半解析度會把顆粒糊成塊）
    expect((await uniforms(page)).sceneScale).toBe(1); // high 在 DPR 1：全解析度
    expect((await uniforms(page)).glow).toBe(1);
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

test.describe('光暈場景 RT 的比例（降級要有減載台階，Task 16 審查）', () => {
  test.use({ viewport: { width: 640, height: 400 } });

  test('mid 在 DPR 1：0.75（點大小同步縮到 0.75）；mid → high 回到 1；降到 min（沒有光暈）是 1', async ({ page }) => {
    await open(page, './__test/qi-harness/?qi-tier=mid&qi-debug=1');
    await setPose(page, 'land');
    let u = await uniforms(page);
    expect(u.glow).toBe(1);
    expect(u.sceneScale).toBe(0.75);
    expect(u.uPixelRatio).toBe(0.75);
    await page.evaluate(() => stageOf().setTier('high'));
    u = await uniforms(page);
    expect(u.sceneScale).toBe(1);
    expect(u.uPixelRatio).toBe(1);
    await page.evaluate(() => stageOf().setTier('mid')); // 降級：場景 RT 的像素數變少，不是只少了點
    expect((await uniforms(page)).sceneScale).toBe(0.75);
    await page.evaluate(() => stageOf().setTier('min'));
    u = await uniforms(page);
    expect(u.glow).toBe(0);
    expect(u.sceneScale).toBe(1);
    expect((await snapshot(page)).covered).toBeGreaterThanOrEqual(0.01);
  });
});

test.describe('光暈場景 RT 的比例（高 DPR）', () => {
  test.use({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });

  test('high 在 DPR 2：0.75（renderer 的 pixel ratio 上限 1.75，點大小 = 1.75 × 0.75）；mid 同樣 0.75', async ({ page }) => {
    await open(page, './__test/qi-harness/?qi-tier=high&qi-debug=1');
    await setPose(page, 'land');
    let u = await uniforms(page);
    expect(u.glow).toBe(1);
    expect(u.sceneScale).toBe(0.75);
    expect(u.uPixelRatio).toBeCloseTo(1.75 * 0.75, 10);
    expect((await snapshot(page)).covered).toBeGreaterThanOrEqual(0.01); // 縮小的場景 RT 仍有畫面
    await page.evaluate(() => stageOf().setTier('mid'));
    u = await uniforms(page);
    expect(u.sceneScale).toBe(0.75);
    expect(u.uPixelRatio).toBeCloseTo(1.75 * 0.75, 10);
  });
});

test.describe('減少動態（reducedMotion）', () => {
  test.use({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });

  test('不跑模擬、不排 rAF：姿勢直接畫在目標上，狀態一變才補畫一格，時間推進也不動', async ({ page }) => {
    await open(page);
    expect(await draws(page)).toBe(0); // 還沒有姿勢，沒有東西可畫
    await setPose(page, 'dingzhou');
    expect(await draws(page), '換姿勢畫一格（沒有 rAF）').toBe(1);
    const shot = await snapshot(page); // snapshot 自己會重畫一格
    expect(shot.covered).toBeGreaterThanOrEqual(0.01);
    expect(shot.bright).toBeGreaterThanOrEqual(0.0005);
    expect(await meanError(page)).toBe(0);
    await run(page, 1000);
    expect(await draws(page), '時間推進不會有任何一格（沒有 rAF）').toBe(2);
    expect((await uniforms(page)).uTime).toBe(0);

    await setPose(page, 'kao'); // 換招直接換，沒有炸開
    expect(await draws(page)).toBe(3);
    expect(await meanError(page)).toBe(0);
    await page.evaluate(() => stageOf().resize(900, 600));
    expect(await draws(page), 'resize 補畫一格').toBe(4);
    await page.evaluate(() => stageOf().setTier('low'));
    expect(await draws(page), 'setTier 補畫一格').toBe(5);
    expect((await snapshot(page)).covered).toBeGreaterThanOrEqual(0.01);
  });

  test('光暈退路：連半精度的 render target 都沒有（兩個浮點擴充都不在）→ 退成不開光暈，不是黑畫面', async ({ page }) => {
    await open(page, './__test/qi-harness/?qi-tier=high&qi-debug=1', { blockExtensions: ['EXT_color_buffer_float', 'EXT_color_buffer_half_float'] });
    await setPose(page, 'land');
    const u = await uniforms(page);
    expect(u.glow).toBe(0);
    expect(u.uPixelRatio).toBe(1); // 直接畫到螢幕，沒有場景 RT
    const shot = await snapshot(page);
    expect(shot.covered).toBeGreaterThanOrEqual(0.01);
    expect(shot.bright).toBeGreaterThanOrEqual(0.0005);
  });

  test('對照組：擴充都在時，同樣的設定會開光暈', async ({ page }) => {
    await open(page, './__test/qi-harness/?qi-tier=high&qi-debug=1');
    await setPose(page, 'land');
    const u = await uniforms(page);
    expect(u.glow).toBe(1);
    expect(u.uPixelRatio).toBe(1); // 場景 RT 是全解析度
    expect((await snapshot(page)).covered).toBeGreaterThan(0.06);
  });
});

test.describe('半精度退路（沒有 EXT_color_buffer_float 的裝置，例如部分 iOS）', () => {
  test.use({ viewport: { width: 960, height: 600 } });
  const NO_FLOAT = { blockExtensions: ['EXT_color_buffer_float'] };

  test('tier=min（直接畫）：模擬跑在半精度 render target 上，仍聚成人形', async ({ page }) => {
    await open(page, HARNESS, NO_FLOAT);
    await setPose(page, 'land');
    await run(page, 3000);
    const u = await uniforms(page);
    expect(u.floatTargets).toBe(0); // 真的走到半精度
    expect(u.glow).toBe(0);
    const shot = await snapshot(page);
    expect(shot.covered).toBeGreaterThanOrEqual(0.01);
    expect(shot.bright).toBeGreaterThanOrEqual(0.0005);
    expect(await meanError(page)).toBeLessThan(0.05); // 半精度讀回（16 位元轉 float）也量得到聚合
  });

  test('tier=mid（光暈）：半精度的模擬加半精度的光暈 RT 一起跑，不黑畫面', async ({ page }) => {
    await open(page, './__test/qi-harness/?qi-tier=mid&qi-debug=1', NO_FLOAT);
    await setPose(page, 'land');
    await run(page, 3000);
    const u = await uniforms(page);
    expect(u.floatTargets).toBe(0);
    expect(u.glow).toBe(1); // 半精度的 RT 仍可渲染（EXT_color_buffer_half_float），光暈照開
    const shot = await snapshot(page);
    expect(shot.covered).toBeGreaterThanOrEqual(0.01);
  });

  test('模擬需要浮點 render target：兩個擴充都沒有 → 掛載 reject（英文訊息），不留半個畫面', async ({ page }) => {
    await open(page, HARNESS, { blockExtensions: ['EXT_color_buffer_float', 'EXT_color_buffer_half_float'], expect: 'error' });
    const seen = seenBy.get(page)!;
    expect(seen.errors).toHaveLength(1);
    expect(seen.errors[0]).toMatch(/EXT_color_buffer_float or EXT_color_buffer_half_float/);
    seen.errors.length = 0; // 這是預期中的錯誤
    expect(await page.evaluate(() => (window as unknown as { __qiStage?: unknown }).__qiStage)).toBeUndefined();
  });
});

test.describe('資源不洩漏', () => {
  test.use({ viewport: { width: 960, height: 600 } });

  test('setTier 循環 10 次（min → low → min …）：貼圖、幾何、著色器程式的計數回到基線', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    // 暖機：兩種尺寸各走一遍並畫一格。著色器程式是第一次用到才編譯；而且 three 的 `GPUComputationRenderer.dispose()`
    // 不會 dispose 它內部的 passThru 材質（`FullScreenQuad.dispose` 只丟幾何），所以每一種貼圖尺寸會留著一個小程式——
    // 上限是 tier 的數量，不是隨重建次數增長。基線取在這之後。
    for (const tier of ['low', 'min'] as const) {
      await page.evaluate((t) => stageOf().setTier(t), tier);
      await run(page, 100);
    }
    const base = await resources(page);
    expect(base.textures).toBeGreaterThan(0);
    const generationBefore = await generation(page);

    for (let i = 0; i < 10; i++) {
      await page.evaluate((tier) => stageOf().setTier(tier), (i % 2 === 0 ? 'low' : 'min') as 'low' | 'min');
    }
    expect(await generation(page)).toBe(generationBefore + 10);
    expect(await page.evaluate(() => stageOf().debug.tier())).toBe('min');
    await run(page, 100);
    expect(await resources(page)).toEqual(base);
    await run(page, 1500); // 重建後仍正常運轉
    expect(await meanError(page)).toBeLessThan(0.05);
  });

  test('開關光暈的循環（min → mid → min）：光暈的 RT 也有釋放', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    for (const tier of ['mid', 'min'] as const) await page.evaluate((t) => stageOf().setTier(t), tier); // 暖機：第一次會編出光暈的著色器
    const base = await resources(page);

    for (let i = 0; i < 3; i++) {
      for (const tier of ['mid', 'min'] as const) await page.evaluate((t) => stageOf().setTier(t), tier);
    }
    expect(await resources(page)).toEqual(base);
  });
});

// ── 依 fps 自動降級（Task 17）──────────────────────────────────────────
// 調速器（`createGovernor`）接在引擎裡：每個 rAF 以 performance.now() 餵入；`debug.feedFrameTime(ms)` 則以內部的虛擬時間餵，
// 所以測試可以在單一 page.evaluate 迴圈裡餵幀，不必讓軟體 GL 真的跑 65 536 點的幀。降級＝`setTier` 到下一級（重建 GPGPU、保留姿勢），
// 並發出 `window` 的 `qi:tier` 事件（detail 是新的 tier）。harness 把它鏡射到 `html[data-qi-tier]`（正式首頁的接線見 home-engine.spec）。
test.describe('依 fps 自動降級', () => {
  test.use({ viewport: { width: 640, height: 400 } });
  const HIGH = './__test/qi-harness/?qi-tier=high&qi-debug=1';
  const LOW = './__test/qi-harness/?qi-tier=low&qi-debug=1';

  interface TierEvent {
    tier: string;
    /** 這個事件發生時，餵進去的虛擬時間累計（ms）。 */
    at: number;
    generation: number;
    textures: number;
    geometries: number;
    programs: number;
  }
  interface Fed {
    events: TierEvent[];
    /** `html[data-qi-tier]` 的值，依序（只記變化）。 */
    attrs: (string | undefined)[];
    tier: string;
    virtualMs: number;
    generation: number;
  }

  /** 在頁面裡以固定的幀時間餵調速器，直到累計虛擬時間 ≥ `totalMs`；記下每個 `qi:tier` 事件與 `html[data-qi-tier]` 的變化。 */
  const feed = (page: Page, frameMs: number, totalMs: number): Promise<Fed> =>
    page.evaluate(
      ([ms, total]) => {
        const stage = stageOf();
        const root = document.documentElement;
        const events: TierEvent[] = [];
        const attrs: (string | undefined)[] = [root.dataset.qiTier];
        let at = 0;
        const onTier = (event: Event): void => {
          events.push({
            tier: (event as CustomEvent<string>).detail,
            at,
            generation: stage.debug.simGeneration(),
            ...stage.debug.resources(),
          });
        };
        window.addEventListener('qi:tier', onTier);
        while (at < total) {
          at += ms;
          stage.debug.feedFrameTime(ms);
          if (root.dataset.qiTier !== attrs[attrs.length - 1]) attrs.push(root.dataset.qiTier);
        }
        window.removeEventListener('qi:tier', onTier);
        return {
          events,
          attrs,
          tier: stage.debug.tier(),
          virtualMs: stage.debug.uniforms().virtualTimeMs!,
          generation: stage.debug.simGeneration(),
        };
      },
      [frameMs, totalMs] as const,
    );

  test('連續 40 ms 的幀：依序 high → mid → low → min，相鄰降級 ≥ 3 s，到 min 後不再變；每次重建一次、姿勢保留、舊資源釋放', async ({ page }) => {
    await open(page, HIGH);
    await setPose(page, 'land');
    const before = await generation(page);
    expect(await page.evaluate(() => document.documentElement.dataset.qiTier)).toBe('high');

    const fed = await feed(page, 40, 20_000);
    expect(fed.virtualMs).toBe(20_000);
    expect(fed.events.map((e) => e.tier)).toEqual(['mid', 'low', 'min']);
    expect(fed.attrs).toEqual(['high', 'mid', 'low', 'min']);
    expect(fed.tier).toBe('min');
    const gaps = fed.events.slice(1).map((e, i) => e.at - fed.events[i]!.at);
    for (const gap of gaps) expect(gap, '相鄰兩次降級的虛擬時間差').toBeGreaterThanOrEqual(3000);
    expect(fed.events.map((e) => e.generation), '每次降級重建一次').toEqual([before + 1, before + 2, before + 3]);
    expect(fed.generation, '到 min 後不再重建').toBe(before + 3);
    // 資源不洩漏：以第一次降級後（mid）為基線。降到 min 少了光暈的 RT，貼圖與幾何只會少、不會多（舊的 sim 與 render target 有 dispose）；
    // 著色器程式則多一點點是正常的：three 的 GPUComputationRenderer.dispose() 不放它內部的 pass-through 程式（每種貼圖尺寸留一個：144²、112²），
    // 加上 lite 路徑的點與地面各一個變體，上限 +4，之後不隨重建次數增長（setTier 循環的基線測試守住這一點）。
    const [mid, , min] = fed.events;
    expect(min!.textures, '貼圖相較第一次降級後的增量 ≤ 2').toBeLessThanOrEqual(mid!.textures + 2);
    expect(min!.geometries).toBeLessThanOrEqual(mid!.geometries);
    expect(min!.programs).toBeLessThanOrEqual(mid!.programs + 4);

    // 姿勢保留；降級給了一次輕衝量（下一格才生效），之後光點仍聚在目標上
    expect(await page.evaluate(() => stageOf().debug.pose())).toBe('land');
    await run(page, 16);
    expect((await uniforms(page)).uImpulsePower, '自動降級給一次輕衝量（PULSE 的 0.9，不是 land 換招的 2.2）').toBeCloseTo(0.9, 5);
    await run(page, 2500);
    expect(await meanError(page)).toBeLessThan(0.05);
    expect((await snapshot(page)).covered).toBeGreaterThanOrEqual(0.01);
    const settled = await resources(page); // 畫過幾格之後（lite 路徑的程式此時都編好了）還在上限內
    expect(settled.textures).toBeLessThanOrEqual(mid!.textures + 2);
    expect(settled.geometries).toBeLessThanOrEqual(mid!.geometries);
    expect(settled.programs).toBeLessThanOrEqual(mid!.programs + 4);
  });

  test('連續 16 ms 的幀 20 秒（62 fps）：不降級，不重建', async ({ page }) => {
    await open(page, HIGH);
    await setPose(page, 'land');
    const before = await generation(page);
    const fed = await feed(page, 16, 20_000);
    expect(fed.events).toEqual([]);
    expect(fed.attrs).toEqual(['high']);
    expect(fed.tier).toBe('high');
    expect(fed.generation).toBe(before);
  });

  test('?qi-tier=bogus 退回 initialTier 的結果（640 寬、非觸控 → low），調速器從實際的 tier 起算（low → min）', async ({ page }) => {
    await open(page, './__test/qi-harness/?qi-tier=bogus&qi-debug=1');
    expect(await page.evaluate(() => stageOf().debug.tier())).toBe('low');
    const fed = await feed(page, 40, 20_000);
    expect(fed.events.map((e) => e.tier)).toEqual(['min']);
    expect(fed.attrs).toEqual(['low', 'min']);
  });

  test('手動 setTier 與調速器同步：換了級就發 qi:tier（同一級不發）；之後真的 rAF 的慢幀只會從新的級往下降，不會「升級」回 mid', async ({ page }) => {
    await open(page, HIGH);
    await setPose(page, 'land');
    await run(page, 16); // 讓 setPose 的換招衝量先被這一格用掉（還沒用掉的衝量會跟著進重建後的 sim，與換級無關）
    await page.evaluate(() => {
      const tiers: string[] = [];
      (window as unknown as { __tiers: string[] }).__tiers = tiers;
      window.addEventListener('qi:tier', (event) => tiers.push((event as CustomEvent<string>).detail));
    });
    const seen = () => page.evaluate(() => (window as unknown as { __tiers: string[] }).__tiers);

    await page.evaluate(async () => {
      await stageOf().setTier('low');
      await stageOf().setTier('low'); // 同一級：不發
    });
    expect(await seen()).toEqual(['low']);
    expect(await page.evaluate(() => document.documentElement.dataset.qiTier)).toBe('low');
    await run(page, 16);
    expect((await uniforms(page)).uImpulsePower, '手動 setTier 不給衝量').toBe(0);

    // 調速器已從 low 重新起算：25 fps 的真 rAF 只剩 min 一級可降（沒同步的話會從 high 的階梯吐出 mid）
    for (let i = 0; i < 130; i++) await page.clock.fastForward(40);
    expect(await seen()).toEqual(['low', 'min']);
    expect(await page.evaluate(() => stageOf().debug.tier())).toBe('min');
  });

  test('第一次 feedFrameTime 起調速器改吃虛擬時間，從目前的 tier 重新暖機（之前真的 rAF 收過的時間不會混進來）', async ({ page }) => {
    await open(page, HIGH);
    await setPose(page, 'land');
    await run(page, 200); // 真的 rAF 已經餵過調速器（時間軸是假時鐘的 performance.now，與虛擬時間無關）
    const fed = await feed(page, 40, 20_000);
    expect(fed.events.map((e) => e.tier)).toEqual(['mid', 'low', 'min']);
    // 第一格在虛擬時間 40 ms：暖機到 2040、再兩個 1 秒視窗，第一次降級在 4040；若暖機還記著真的 rAF 的起點，會晚很多
    expect(fed.events[0]!.at, '從虛擬時間 0 重新暖機').toBeGreaterThanOrEqual(4000);
    expect(fed.events[0]!.at, '從虛擬時間 0 重新暖機').toBeLessThanOrEqual(4100);
  });

  test('已在 min：怎麼餵都不動', async ({ page }) => {
    await open(page);
    const before = await generation(page);
    const fed = await feed(page, 100, 30_000);
    expect(fed.events).toEqual([]);
    expect(fed.tier).toBe('min');
    expect(fed.generation).toBe(before);
  });

  test('真的 rAF 也會餵調速器：每個 rAF 相隔 40 ms（fastForward 一次只觸發一格）→ 約 4 秒後 low → min；相隔 16 ms 則不降', async ({ page }) => {
    await open(page, LOW);
    await setPose(page, 'land');
    await run(page, 5000); // 62 fps：超過暖機 2 秒＋兩個 1 秒視窗，還是沒降
    expect(await page.evaluate(() => stageOf().debug.tier())).toBe('low');

    for (let i = 0; i < 130; i++) await page.clock.fastForward(40); // 25 fps
    expect(await page.evaluate(() => stageOf().debug.tier())).toBe('min');
    expect(await page.evaluate(() => document.documentElement.dataset.qiTier)).toBe('min');
    expect(await page.evaluate(() => stageOf().debug.pose())).toBe('land');
  });

  // ── 開場期間延後降級（Task 22，Task 17 審查轉來）──────────────────────────
  // 降級＝重建 GPGPU、光點直接落在目標上。開場正在演（散開、吸氣流線）時重建，會把整段演出瞬移抹掉；
  // 所以開場期間調速器說「該降」只記下來，等開場結束（演完、被略過、被別的姿勢打斷）的下一格才真的降。
  /** 等開場真的開始計時（形體是真的 fetch，不受假時鐘控制；`uIntroT` ≥ 0 才算開始）。 */
  const waitIntroStarted = (page: Page) =>
    expect
      .poll(async () => {
        await run(page, 50);
        return (await uniforms(page)).uIntroT;
      }, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(0);

  test('開場正在演：慢幀只記下來、不重建（開場不被瞬移抹掉）；演完的下一格才降一次，姿勢停在 land', async ({ page }) => {
    await open(page, LOW);
    await setPose(page, 'land');
    await run(page, 16);
    const before = await generation(page);
    await page.evaluate(() => stageOf().playIntro());
    await waitIntroStarted(page);
    const introT = (await uniforms(page)).uIntroT!;

    const fed = await feed(page, 40, 20_000); // 單一 evaluate 迴圈：模擬沒有前進，開場時間軸原地不動
    expect(fed.events, '開場期間不降級').toEqual([]);
    expect(fed.tier).toBe('low');
    expect(fed.generation, '沒有重建（重建會把光點直接放回目標上，抹掉散開與吸氣）').toBe(before);
    expect((await uniforms(page)).uIntroT, '開場時間軸沒有被歸零').toBe(introT);

    await run(page, 5000); // 開場約 3.4 s：演完
    expect((await uniforms(page)).uIntroT).toBe(-1);
    expect(await page.evaluate(() => stageOf().debug.tier()), '演完之後才降').toBe('min');
    expect(await generation(page)).toBe(before + 1);
    expect(await page.evaluate(() => document.documentElement.dataset.qiTier)).toBe('min');
    expect(await page.evaluate(() => stageOf().debug.pose())).toBe('land');
    await run(page, 2500);
    expect(await meanError(page)).toBeLessThan(0.05);
  });

  test('開場期間記下的降級，在開場被略過時同樣照做（只降一次）', async ({ page }) => {
    await open(page, LOW);
    await setPose(page, 'land');
    await run(page, 16);
    const before = await generation(page);
    await page.evaluate(() => {
      (window as unknown as { __tiers: string[] }).__tiers = [];
      window.addEventListener('qi:tier', (event) => (window as unknown as { __tiers: string[] }).__tiers.push((event as CustomEvent<string>).detail));
      stageOf().playIntro();
    });
    await waitIntroStarted(page);
    await feed(page, 40, 20_000);
    expect(await generation(page)).toBe(before);

    await page.evaluate(() => stageOf().playIntro({ skip: true }));
    await run(page, 100);
    expect(await page.evaluate(() => stageOf().debug.tier())).toBe('min');
    expect(await generation(page)).toBe(before + 1);
    expect(await page.evaluate(() => (window as unknown as { __tiers: string[] }).__tiers)).toEqual(['min']);
    await run(page, 3000);
    expect(await generation(page), '之後不再重建').toBe(before + 1);
  });

  test('沒有開場時降級照舊立刻發生（對照組：延後只針對開場）', async ({ page }) => {
    await open(page, LOW);
    await setPose(page, 'land');
    const before = await generation(page);
    const fed = await feed(page, 40, 20_000);
    expect(fed.events.map((e) => e.tier)).toEqual(['min']);
    expect(fed.generation).toBe(before + 1);
  });

  // ── 分頁回到可見（Task 22，Task 17 審查轉來）───────────────────────────────
  // 分頁切走期間 rAF 停擺、回來時 GPU 與計時器要一下子才醒，頭幾格會又慢又亂；調速器若照單全收，會把「剛回來」誤判成「這台機器太慢」。
  // 轉為可見時重建調速器（從目前的 tier 重新暖機 2 s、再兩個差視窗），那一段不計。
  test('分頁轉為可見：調速器重新暖機（切走前累積的差視窗與回來後頭幾格的慢幀都不算）', async ({ page }) => {
    const step = (ms: number) => feed(page, 40, ms);
    const tierNow = () => page.evaluate(() => stageOf().debug.tier());
    const visible = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

    await open(page, LOW);
    await setPose(page, 'land');
    await step(3500); // 暖機 2 s 之後的第一個差視窗已記一次，第二個還沒結束
    expect(await tierNow(), '前置條件：還沒降').toBe('low');
    await visible();
    await step(3000); // 沒重新暖機的話，第二個差視窗在這裡結束就降了
    expect(await tierNow(), '重新暖機：回來後 3 s 內不降').toBe('low');
    await step(3000);
    expect(await tierNow(), '調速器仍然運作：重新暖機之後照常降').toBe('min');
  });

  test('對照組：同一組幀序列沒有 visibilitychange 就會降', async ({ page }) => {
    await open(page, LOW);
    await setPose(page, 'land');
    await feed(page, 40, 3500);
    await feed(page, 40, 3000);
    expect(await page.evaluate(() => stageOf().debug.tier())).toBe('min');
  });

  test('visibilitychange 但文件不是可見（切走）：不重建調速器', async ({ page }) => {
    await open(page, LOW);
    await setPose(page, 'land');
    await feed(page, 40, 3500);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await feed(page, 40, 3000);
    expect(await page.evaluate(() => stageOf().debug.tier()), '切走不是「回來」：差視窗照算').toBe('min');
  });

  test('dispose 之後 visibilitychange 不再動作（監聽器已移除）、也不報錯', async ({ page }) => {
    await open(page, LOW);
    await setPose(page, 'land');
    await page.evaluate(() => stageOf().dispose());
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await run(page, 100);
  });

  // ── 自動降級時重建丟錯（Task 22，Task 17 審查轉來）─────────────────────────
  // 重建一開始就把舊的 sim 與貼圖放掉；中途丟錯（顯示卡記憶體不足、著色器編不出來）會留下一個沒有 sim 的引擎，畫面停在空白。
  // 引擎不自己決定怎麼收場：停掉自己的迴圈、呼叫 `onFailure` 一次，由呼叫端 dispose 並退回靜態圖（首頁會 enterStatic）。
  test('降級時重建丟錯：onFailure 恰好一次、不丟未捕捉的錯、不再排幀、不再重試；dispose 無妨', async ({ page }) => {
    await page.addInitScript(() => {
      const proto = WebGL2RenderingContext.prototype;
      const original = proto.createFramebuffer;
      proto.createFramebuffer = function (this: WebGL2RenderingContext) {
        if ((window as unknown as { __failFramebuffers?: boolean }).__failFramebuffers) throw new Error('forced framebuffer failure');
        return original.call(this);
      };
    });
    await open(page, LOW);
    await setPose(page, 'land');
    await run(page, 100);
    const failures = () => page.evaluate(() => (window as unknown as { __qiFailures: string[] }).__qiFailures);
    expect(await failures()).toEqual([]);
    const before = await generation(page);

    await page.evaluate(() => ((window as unknown as { __failFramebuffers: boolean }).__failFramebuffers = true));
    const fed = await feed(page, 40, 20_000); // 說「該降」的那一格重建就會丟錯；feedFrameTime 不能把錯丟回呼叫端
    expect(fed.events, '沒有成功換級，不發 qi:tier').toEqual([]);
    const reported = await failures();
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatch(/forced framebuffer failure/);

    const drawn = await draws(page);
    await run(page, 1000);
    expect(await draws(page), '失敗後不再排 rAF、不再畫').toBe(drawn);
    expect(await generation(page), '不再重試重建').toBe(before);
    expect((await feed(page, 40, 20_000)).events).toEqual([]);
    expect(await failures(), '只通知一次').toHaveLength(1);

    await page.evaluate(() => ((window as unknown as { __failFramebuffers: boolean }).__failFramebuffers = false));
    await page.evaluate(() => stageOf().dispose());
    await page.evaluate(() => stageOf().dispose()); // 重複呼叫無妨
  });

  test('手動 setTier 重建失敗：照舊 reject 給呼叫端（不走 onFailure，呼叫端自己知道）', async ({ page }) => {
    await page.addInitScript(() => {
      const proto = WebGL2RenderingContext.prototype;
      const original = proto.createFramebuffer;
      proto.createFramebuffer = function (this: WebGL2RenderingContext) {
        if ((window as unknown as { __failFramebuffers?: boolean }).__failFramebuffers) throw new Error('forced framebuffer failure');
        return original.call(this);
      };
    });
    await open(page, LOW);
    await setPose(page, 'land');
    await page.evaluate(() => ((window as unknown as { __failFramebuffers: boolean }).__failFramebuffers = true));
    const result = await page.evaluate(() => stageOf().setTier('min').then(() => 'ok', (e: Error) => e.message));
    expect(result).toMatch(/forced framebuffer failure/);
    expect(await page.evaluate(() => (window as unknown as { __qiFailures: string[] }).__qiFailures)).toEqual([]);
    await page.evaluate(() => ((window as unknown as { __failFramebuffers: boolean }).__failFramebuffers = false));
    await page.evaluate(() => stageOf().dispose());
  });

  test.describe('減少動態', () => {
    test.use({ reducedMotion: 'reduce' });

    test('沒有模擬就沒有幀成本：餵再慢的幀也不降級', async ({ page }) => {
      await open(page, HIGH);
      await setPose(page, 'land');
      const fed = await feed(page, 100, 30_000);
      expect(fed.events).toEqual([]);
      expect(fed.tier).toBe('high');
      expect(fed.virtualMs, '虛擬時間照常累計').toBe(30_000);
    });
  });
});
