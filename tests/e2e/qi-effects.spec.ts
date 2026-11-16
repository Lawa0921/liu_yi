import { expect, test, type Page } from '@playwright/test';
import { shockwave } from '../../src/qi/engine/effects';
import type { QiStage } from '../../src/qi/engine/qi-stage';

// 試作四項補強與開場演出（Task 16）：換招拖尾、落地衝擊波、開場吸氣流線、大槍桿與紅纓，跑在開發用的 harness 頁。
// 與 qi-engine.spec 同一套規矩：headless 的 WebGL 是軟體繪製，一律 ?qi-tier=min&qi-debug=1，時間用停住的假時鐘、
// 只有 runFor 會推進；不碰 OS 層級的滑鼠鍵盤。
test.describe.configure({ mode: 'default', timeout: 120_000 });

const HARNESS = './lab/qi-harness/?qi-tier=min&qi-debug=1';
const T0 = new Date('2026-01-01T08:00:00');
const T1 = new Date('2026-01-01T09:00:00');
const READY = { timeout: 30_000 };
/** 落地 0.4 s 時兩個環帶的亮點比例（有環時的實測值）。 */
const RING_BRIGHT = 0.0043;

type Debug = NonNullable<QiStage['debug']>;
type W = { __qiStage: QiStage & { debug: Debug } };
declare function stageOf(): QiStage & { debug: Debug };

const errorsOf = new WeakMap<Page, { errors: string[]; warnings: string[] }>();

async function open(page: Page, url = HARNESS): Promise<void> {
  const seen = { errors: [] as string[], warnings: [] as string[] };
  errorsOf.set(page, seen);
  page.on('pageerror', (error) => seen.errors.push(`pageerror: ${error}`));
  page.on('console', (message) => {
    if (message.type() === 'error') seen.errors.push(`console.error: ${message.text()}`);
    if (message.type() === 'warning') seen.warnings.push(`console.warning: ${message.text()}`);
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
  const seen = errorsOf.get(page) ?? { errors: [], warnings: [] };
  expect(seen.errors, '頁面全程不得有 pageerror 或 console.error').toEqual([]);
  expect(seen.warnings.filter((w) => !/GPU stall due to ReadPixels/.test(w)), '頁面全程不得有 console.warning（debug 讀回的效能提示除外）').toEqual([]);
});

const run = (page: Page, ms: number) => page.clock.runFor(ms);
const setPose = (page: Page, pose: Parameters<QiStage['setPose']>[0], burst?: boolean) =>
  page.evaluate(([p, b]) => stageOf().setPose(p, b === undefined ? undefined : { burst: b }), [pose, burst] as const);
const uniforms = (page: Page) => page.evaluate(() => stageOf().debug.uniforms());
const meanError = (page: Page) => page.evaluate(() => stageOf().debug.meanError());
const radial = (page: Page) => page.evaluate(() => stageOf().debug.radialVelocity());
const poseOf = (page: Page) => page.evaluate(() => stageOf().debug.pose());

/** 把 `land`、`lift` 載好、停在 `land`（開場演出需要兩個形體；沒載好時計時會等它們）。 */
async function settleLand(page: Page): Promise<void> {
  await setPose(page, 'land', false);
  await setPose(page, 'lift', false);
  await setPose(page, 'land', false);
  await run(page, 2500);
}

test.describe('開場吸氣流線（桌機，tier=min）', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('playIntro 從 land 的聚合態開始計時；1.2–1.8 s 光點平均往中心流（徑向速度 > 0.5）', async ({ page }) => {
    await open(page);
    await settleLand(page);
    expect(await meanError(page)).toBeLessThan(0.05);
    expect((await uniforms(page)).uIntroT).toBe(-1);

    await page.evaluate(() => stageOf().playIntro());
    expect((await uniforms(page)).uIntroT).toBe(0); // 形體都載好了，立刻開始計時

    await run(page, 800); // 0.8 s：exhale，還沒吸氣
    let u = await uniforms(page);
    expect(u.uInhale).toBe(0);
    expect(await poseOf(page)).toBe('land'); // 吸氣開始（1.0 s）前目標還是 land

    await run(page, 400); // 1.2 s
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      samples.push(await radial(page)); // 1.2、1.35、1.5、1.65、1.8 s
      if (i === 2) {
        u = await uniforms(page);
        expect(u.uInhale, '吸氣進度在 (0, 1]').toBeGreaterThan(0);
        expect(u.uInhale).toBeLessThanOrEqual(1);
        expect(u.uStreak, '吸氣中點沿流向拉長').toBeGreaterThan(1.5);
        expect(await poseOf(page)).toBe('lift'); // 目標換成抬腳
      }
      await run(page, 150);
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean, `徑向速度（往中心為正）：${samples.map((s) => s.toFixed(2)).join(', ')}`).toBeGreaterThan(0.5);
    // 吸氣的加速度（不是只靠彈簧）一開始就把光點往中心帶：拿掉 inhaleAcc，1.2 s 的徑向速度約 0.02；有它約 0.65
    expect(samples[0], '1.2 s（吸氣開始 0.2 s）就已經往中心流').toBeGreaterThan(0.4);

    await run(page, 400); // 2.1 s：吸氣結束
    expect((await uniforms(page)).uInhale).toBe(0);
  });

  test('開場全程約 3.4 s：2.7 s 才落地（衝擊波與鏡頭震），演完自動結束，最後聚回 land', async ({ page }) => {
    await open(page);
    await settleLand(page);
    await page.evaluate(() => stageOf().playIntro());

    await run(page, 2500); // 2.5 s：抬腳停一拍
    let u = await uniforms(page);
    expect(await poseOf(page)).toBe('lift');
    expect(u.uShockT, '還沒落地').toBe(-1);
    expect(u.uShake).toBe(0);

    await run(page, 400); // 2.9 s：落地之後約 0.2 s
    u = await uniforms(page);
    expect(await poseOf(page)).toBe('land');
    expect(u.uShockT).toBeGreaterThan(0.1);
    expect(u.uShockT).toBeLessThan(0.3);
    expect(u.uShake).toBeGreaterThan(0.01);
    expect(u.uIntroT).toBeGreaterThan(2.7);

    await run(page, 700); // 3.6 s：開場演完
    u = await uniforms(page);
    expect(u.uIntroT, '演完自動結束').toBe(-1);
    expect(u.uInhale).toBe(0);
    await run(page, 2000);
    expect(await meanError(page)).toBeLessThan(0.05);
    expect(await poseOf(page)).toBe('land');
  });

  test('演出中再呼叫 playIntro 不重來；skip 立刻收尾（不播特效、停在 land、不報錯）；沒在演時 skip 無事', async ({ page }) => {
    await open(page);
    await settleLand(page);
    await page.evaluate(() => stageOf().playIntro({ skip: true })); // 沒在演：無事
    expect((await uniforms(page)).uIntroT).toBe(-1);

    await page.evaluate(() => stageOf().playIntro());
    await run(page, 1500);
    const before = (await uniforms(page)).uIntroT!;
    expect(before).toBeGreaterThan(1.4);
    await page.evaluate(() => stageOf().playIntro()); // 不重來
    expect((await uniforms(page)).uIntroT).toBeCloseTo(before, 5);

    expect(await poseOf(page)).toBe('lift');
    await page.evaluate(() => stageOf().playIntro({ skip: true }));
    let u = await uniforms(page);
    expect(u.uIntroT, '立刻收尾').toBe(-1);
    expect(await poseOf(page), '停在 land').toBe('land');
    await run(page, 100);
    u = await uniforms(page);
    expect(u.uInhale).toBe(0);
    expect(u.uShockT, 'skip 不播落地特效').toBe(-1);
    await run(page, 2500);
    expect(await meanError(page)).toBeLessThan(0.05);
    expect((await uniforms(page)).uShockT).toBe(-1);
  });

  test('演出中 setPose("land") 不打斷開場（它本來就停在 land）', async ({ page }) => {
    await open(page);
    await settleLand(page);
    await page.evaluate(() => stageOf().playIntro());
    await run(page, 1500);
    await setPose(page, 'land'); // 重申 land：開場照演
    expect((await uniforms(page)).uIntroT, '沒被打斷').toBeGreaterThan(1.4);
    expect(await poseOf(page), '目標仍是吸氣的 lift').toBe('lift');
    await run(page, 2100);
    expect((await uniforms(page)).uIntroT).toBe(-1);
    expect(await poseOf(page)).toBe('land');
    expect(await meanError(page)).toBeLessThan(0.05);
  });

  test('開場還在等形體載入（introPending）時 setPose 別的姿勢：開場被取消、不丟錯，之後 lift 載好也不會補演', async ({ page }) => {
    await open(page);
    await setPose(page, 'land', false); // lift 還沒載過：playIntro 要等它
    const outcome = await page.evaluate(async () => {
      const stage = stageOf();
      stage.playIntro(); // introPending（lift 的請求在路上）
      try {
        await stage.setPose('dingzhou'); // 同一刻換成別的姿勢
        return 'ok';
      } catch (error) {
        return `${(error as Error).name}: ${(error as Error).message}`;
      }
    });
    expect(outcome).toBe('ok');
    await run(page, 3500);
    const u = await uniforms(page);
    expect(u.uIntroT, '開場沒有補演（取消的 token 不會在 lift 載好後開始計時）').toBe(-1);
    expect(u.uShockT, '沒有落地').toBe(-1);
    expect(await poseOf(page)).toBe('dingzhou');
    expect(await meanError(page)).toBeLessThan(0.05);
  });

  test('對照：沒有人取消時，同樣的 pending 會在形體載好後開始計時（上一個測試取消的是真的）', async ({ page }) => {
    await open(page);
    await setPose(page, 'land', false);
    await page.evaluate(() => stageOf().playIntro());
    await page.waitForFunction(() => stageOf().debug.uniforms().uIntroT! >= 0); // lift 是真的網路請求，不受假時鐘控制
    expect((await uniforms(page)).uIntroT).toBeGreaterThanOrEqual(0);
  });

  test('演出中換姿勢（setPose）：開場到此為止，姿勢以最後一次為準', async ({ page }) => {
    await open(page);
    await settleLand(page);
    await page.evaluate(() => stageOf().playIntro());
    await run(page, 1500);
    await setPose(page, 'dingzhou');
    expect((await uniforms(page)).uIntroT).toBe(-1);
    await run(page, 3500); // 就算舊的時間軸還在，2.7 s 也不會把姿勢拉回 land、也不會落地
    expect(await poseOf(page)).toBe('dingzhou');
    expect((await uniforms(page)).uShockT).toBe(-1);
    expect(await meanError(page)).toBeLessThan(0.05);
  });
});

test.describe('開場結束通知 onEnd（桌機，tier=min）', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  /** 開場結束時把標籤記進 window.__ends（回呼不能跨 evaluate 帶出來，所以記在頁面裡）。 */
  const playWith = (page: Page, tag: string, skip = false) =>
    page.evaluate(
      ([name, skipIt]) => {
        const w = window as unknown as { __ends?: string[] };
        w.__ends ??= [];
        stageOf().playIntro({ skip: skipIt, onEnd: () => w.__ends!.push(name) });
      },
      [tag, skip] as const,
    );
  const ends = (page: Page) => page.evaluate(() => (window as unknown as { __ends?: string[] }).__ends ?? []);

  test('演完、skip、被別的姿勢打斷：各呼叫一次；沒在演時的 skip、演出中重複的 playIntro 不會多呼叫', async ({ page }) => {
    await open(page);
    await settleLand(page);

    await playWith(page, 'idle-skip', true); // 沒在演：skip 無事，也不呼叫
    expect(await ends(page)).toEqual([]);

    await playWith(page, 'done');
    await run(page, 3000);
    expect(await ends(page), '還沒演完').toEqual([]);
    await run(page, 800);
    expect(await ends(page), '演完呼叫一次').toEqual(['done']);
    await run(page, 1000);
    expect(await ends(page), '演完之後不再呼叫').toEqual(['done']);

    await playWith(page, 'skipped');
    await run(page, 1500);
    await playWith(page, 'again'); // 演出中再呼叫：不重來、新的 onEnd 也不會被登記
    await page.evaluate(() => stageOf().playIntro({ skip: true }));
    expect(await ends(page), 'skip 呼叫一次').toEqual(['done', 'skipped']);
    await run(page, 4000);
    expect(await ends(page)).toEqual(['done', 'skipped']);

    await playWith(page, 'interrupted');
    await run(page, 1500);
    await setPose(page, 'dingzhou'); // 演出中換姿勢
    expect(await ends(page), '被打斷呼叫一次').toEqual(['done', 'skipped', 'interrupted']);
    await run(page, 4000);
    expect(await ends(page)).toEqual(['done', 'skipped', 'interrupted']);
  });

  test('開場還在等形體載入時被別的姿勢取消：呼叫一次，之後 lift 載好也不會再呼叫', async ({ page }) => {
    await open(page);
    await setPose(page, 'land', false); // lift 還沒載過：playIntro 要等它
    await page.evaluate(async () => {
      const w = window as unknown as { __ends?: string[] };
      w.__ends = [];
      const stage = stageOf();
      stage.playIntro({ onEnd: () => w.__ends!.push('canceled') });
      await stage.setPose('dingzhou');
    });
    expect(await ends(page)).toEqual(['canceled']);
    await run(page, 3500);
    expect(await ends(page)).toEqual(['canceled']);
  });
});

test.describe('落地衝擊波（桌機，tier=min）', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  /** 兩個地面環帶的螢幕區域：人形左右兩側（人形腳寬只有約 ±0.7，環在 0.4 s 時半徑約 1.6）。 */
  async function bands(page: Page, radius: number) {
    return page.evaluate((r) => {
      const d = stageOf().debug;
      const box = (xs: [number, number]) => {
        const corners = [
          d.project(xs[0], 0, -0.9),
          d.project(xs[1], 0, -0.9),
          d.project(xs[0], 0, 0.9),
          d.project(xs[1], 0, 0.9),
        ];
        const x0 = Math.min(...corners.map((c) => c.x));
        const x1 = Math.max(...corners.map((c) => c.x));
        const y0 = Math.min(...corners.map((c) => c.y)) - 6;
        const y1 = Math.max(...corners.map((c) => c.y)) + 6;
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      };
      return [box([-(r + 0.3), -(r - 0.3)]), box([r - 0.3, r + 0.3])];
    }, radius);
  }
  const brightIn = async (page: Page, boxes: { x: number; y: number; w: number; h: number }[]) => {
    let sum = 0;
    for (const box of boxes) {
      const shot = await page.evaluate((b) => stageOf().debug.snapshot(b), box);
      sum += shot.bright;
    }
    return sum / boxes.length;
  };

  test('playLanding：t = 0.4 s 時環帶的亮點是落地前的 2.5 倍以上；鏡頭震幅 > 0.05、0.8 s 內回到 0', async ({ page }) => {
    await open(page);
    await setPose(page, 'land', false);
    await run(page, 2500);
    const boxes = await bands(page, shockwave(0.4).radius);
    const baseline = await brightIn(page, boxes);
    const u0 = await uniforms(page);
    expect(u0.uShockT).toBe(-1);
    expect(u0.uShake).toBe(0);

    await page.evaluate(() => stageOf().playLanding());
    await run(page, 16);
    const first = await uniforms(page);
    expect(first.uShake, '落地的鏡頭震比試作的 0.05 強').toBeGreaterThan(0.05);
    expect(first.uShake).toBeLessThanOrEqual(0.08);
    expect(first.uFlash, '腳下有白閃').toBeGreaterThan(0.3);
    expect(first.uRingAmp).toBeGreaterThan(3);
    expect(first.uImpulsePower, '用試作 land() 的力道 0.9，不是 BURSTS.land 的 2.2').toBeCloseTo(0.9, 5);
    expect(first.uSpring, '「啪」一下就定住：彈簧加倍（×2.2）').toBeCloseTo(26 * 2.2, 3);
    expect(first.uDamp, '阻尼同步 ×√2.2（阻尼比不變，不會彈一下）').toBeCloseTo(5.5 * Math.sqrt(2.2), 3);

    await run(page, 384); // 0.4 s
    const mid = await uniforms(page);
    expect(mid.uShockT).toBeCloseTo(0.4, 1);
    expect(mid.uRingRadius).toBeCloseTo(shockwave(mid.uShockT!).radius, 5);
    expect(mid.uRing2Amp, '第二圈（晚 0.12 s）也已出發').toBeGreaterThan(0.5);
    const ring = await brightIn(page, boxes);
    expect(ring, `環帶亮點 ${ring} 應 ≥ 落地前基線 ${baseline} 的 2.5 倍`).toBeGreaterThanOrEqual(Math.max(baseline, 1e-4) * 2.5);
    // 相對於「有環時」的實測值（1280×720、tier=min、這兩個環帶：0.0043）設下限：環變淡（亮度 ×0.8 就掉到 0.0023）也會紅燈，
    // 不只是「比沒有環時亮」。
    expect(ring, `環帶亮點 ${ring} 不得低於實測值 ${RING_BRIGHT} 的 70%`).toBeGreaterThanOrEqual(RING_BRIGHT * 0.7);

    await run(page, 200); // 0.6 s：彈簧回到 26
    expect((await uniforms(page)).uSpring).toBeCloseTo(26, 3);
    expect((await uniforms(page)).uDamp).toBeCloseTo(5.5, 3);

    await run(page, 250); // 0.85 s：震動結束
    const after = await uniforms(page);
    expect(after.uShake, '鏡頭震幅在 0.8 s 內回到 0').toBe(0);
    expect(after.uFlash).toBeLessThan(0.01);
    await run(page, 2500);
    expect(await meanError(page)).toBeLessThan(0.05);
    expect((await uniforms(page)).uShockT, '衝擊波 3 s 後收掉').toBe(-1);
  });

  test('鏡頭真的在震：落地後前幾格人形的螢幕位置抖動 > 1 px，1 秒後只剩呼吸般的慢漂移', async ({ page }) => {
    await open(page);
    await setPose(page, 'land', false);
    await run(page, 2500);
    await page.evaluate(() => stageOf().playLanding());
    const xs: number[] = [];
    for (let i = 0; i < 10; i++) {
      await run(page, 16);
      xs.push((await page.evaluate(() => stageOf().debug.project(0, 1, 0))).x);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1);

    await run(page, 1000);
    const later: number[] = [];
    for (let i = 0; i < 10; i++) {
      await run(page, 16);
      later.push((await page.evaluate(() => stageOf().debug.project(0, 1, 0))).x);
    }
    expect(Math.max(...later) - Math.min(...later)).toBeLessThan(0.5);
  });

  test('playLanding 時形體還沒載入也行（先載入再落地）；不在 land 時會把姿勢拉回 land', async ({ page }) => {
    await open(page);
    await setPose(page, 'dingzhou', false);
    await run(page, 2000);
    await page.evaluate(() => stageOf().playLanding());
    await page.waitForFunction(() => stageOf().debug.pose() === 'land'); // land 還沒載過：載入是真的網路請求，不受假時鐘控制
    await run(page, 16);
    expect((await uniforms(page)).uShockT).toBeGreaterThanOrEqual(0);
    await run(page, 2500);
    expect(await meanError(page)).toBeLessThan(0.05);
  });
});

test.describe('換招拖尾（桌機，tier=min）', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('平時 uStreak = 1（點是圓的）；換招爆開峰值 > 1.5；1 秒之後收回', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    await run(page, 2500);
    expect((await uniforms(page)).uStreak).toBeCloseTo(1, 2); // 上一個衝量的包絡已衰減殆盡

    await setPose(page, 'dingzhou'); // 預設 burst
    await run(page, 100);
    const peak = (await uniforms(page)).uStreak!;
    expect(peak, '爆開峰值時沿速度方向拉長').toBeGreaterThan(1.5);
    expect(peak).toBeLessThanOrEqual(3.6);
    await run(page, 2500);
    expect((await uniforms(page)).uStreak).toBeLessThan(1.05);
  });

  test('burst: false 不給衝量也就不拉長', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    await run(page, 2500);
    await setPose(page, 'dingzhou', false);
    await run(page, 100);
    expect((await uniforms(page)).uStreak).toBeCloseTo(1, 2);
  });
});

test.describe('大槍桿與紅纓（1440×900，tier=min）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('setPose("spear") 聚合後：紅纓是紅色（red ≥ 150 px）、槍桿中段縱向亮寬 ≥ 5 px', async ({ page }) => {
    await open(page);
    await setPose(page, 'spear');
    await run(page, 3000);
    expect(await meanError(page)).toBeLessThan(0.05);
    const shot = await page.evaluate(() => stageOf().debug.snapshot());
    expect(shot.red, '紅纓的紅色像素').toBeGreaterThanOrEqual(150);

    // 槍桿中段（寬版：長 3.8、傾角 0.05、中點 (0, 1.05)；取離中點 −0.1 個槍長的那一點）：取一欄 1 px 寬的像素，數它有幾格亮
    const column = await page.evaluate(() => {
      const mid = stageOf().debug.project(-0.1 * 3.8 * Math.cos(0.05), 1.05 - 0.1 * 3.8 * Math.sin(0.05), 0);
      const h = 120;
      return { x: Math.round(mid.x), y: Math.round(mid.y - h / 2), w: 1, h };
    });
    const strip = await page.evaluate((b) => stageOf().debug.snapshot(b), column);
    expect(strip.height).toBe(column.h);
    const litRows = Math.round(strip.covered * strip.height);
    expect(litRows, `桿身縱向有 ${litRows} px 亮（取 1 px 寬的一欄）`).toBeGreaterThanOrEqual(5);
  });
});

test.describe('減少動態', () => {
  test.use({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });

  test('playIntro 的 onEnd 不會被呼叫（沒有演出）', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    await page.evaluate(() => {
      const w = window as unknown as { __ends?: string[] };
      w.__ends = [];
      stageOf().playIntro({ onEnd: () => w.__ends!.push('called') });
    });
    await run(page, 1000);
    expect(await page.evaluate(() => (window as unknown as { __ends?: string[] }).__ends)).toEqual([]);
  });

  test('playLanding／playIntro 沒有效果也不報錯（沒有模擬、沒有 rAF）', async ({ page }) => {
    await open(page);
    await setPose(page, 'land');
    const drawn = await page.evaluate(() => stageOf().debug.draws());
    await page.evaluate(() => {
      stageOf().playLanding();
      stageOf().playIntro();
      stageOf().playIntro({ skip: true });
    });
    await run(page, 1000);
    const u = await uniforms(page);
    expect(u.uIntroT).toBe(-1);
    expect(u.uShockT).toBe(-1);
    expect(u.uStreak).toBe(1);
    expect(await page.evaluate(() => stageOf().debug.draws())).toBe(drawn);
    expect(await poseOf(page)).toBe('land');
  });
});
