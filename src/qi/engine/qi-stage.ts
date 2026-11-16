/**
 * 「氣聚成人」光點引擎的入口（動態 import 的 chunk）：把形體、模擬、舞台、掌風接成一個 `QiStage`。
 * 這個檔案唯一的執行時 export 是 `mountQiStage`；其餘都是型別。
 *
 *   - 姿勢：`setPose` 載入形體（`ShapeLoader`）、依 tier 展開成目標貼圖（`expandTargets`／`flowTargets`）、換目標並（預設）給一次衝量
 *     （`BURSTS`）。第一次擺姿勢（以及換 tier 重建後）光點直接落在目標上，沒有飛行過程：首頁要接續靜態圖的聚合態，不能先從遠處飛來。
 *   - 力場：每一格由 `forcesFor` 依散開量、捲動速度、距上次衝量的時間算出彈簧／旋渦／阻尼（散開量與捲動速度由呼叫端餵）。
 *   - `resize` 只動相機與 render target；`setTier` 才重建 GPGPU（`simGeneration` 遞增）。
 *   - 減少動態（`reducedMotion`）：不跑模擬、不收指標、不排 rAF；光點直接畫在目標上，狀態改變時畫一格。
 *   - 武器的擺放依視窗寬窄（D13）：寬窄翻轉時重展開武器的目標，姿勢不變。
 *   - 補強（Task 16）：換招拖尾（`uStreak`，由衝量的包絡決定）、落地演出（`playLanding`：雙圈衝擊波、白閃、鏡頭震）、
 *     開場演出（`playIntro`：吸氣流線，時間軸見 `intro.ts`）。這些都只在有模擬時才動（減少動態沒有）。
 * 注意：會被打進引擎 chunk，所以錯誤訊息只用英文。
 */

import { DataTexture, FloatType, RGBAFormat, Vector3, WebGLRenderer } from 'three';
import { BURSTS, type Burst, type PoseId } from '../config/poses';
import { SHAPES } from '../config/shapes';
import { ambientField, expandTargets, flowTargets, weaponLayout, type AmbientField } from '../shapes/expand';
import type { Shape } from '../shapes/format';
import type { ShapeLoader } from '../shapes/loader';
import { floatTargets } from './caps';
import { burstSpeed, EXHALE, inhaleDamp, inhaleStreak, SNAP_DAMP_GAIN, streakLength } from './effects';
import { forcesFor } from './forces';
import { introState, type IntroState } from './intro';
import { createPointer, type Pointer } from './pointer';
import { createSim, zeroTexture, type Sim } from './sim';
import { createStage, type Stage } from './stage';
import { TIERS, type TierId } from './tiers';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface QiStageOptions {
  canvas: HTMLCanvasElement;
  tier: TierId;
  loader: ShapeLoader;
  reducedMotion: boolean;
  /** 暴露 `stage.debug`（`?qi-debug=1`）。預設不暴露。 */
  debug?: boolean;
}

export interface QiStage {
  /** 換姿勢；形體載入完成才 resolve。`burst` 預設 true（依 `BURSTS` 給一次衝量）。連續呼叫時以最後一次為準。 */
  setPose(pose: PoseId, opts?: { burst?: boolean }): Promise<void>;
  /** 散開量 0–1（捲動轉場帶中途鬆開）。 */
  setScatter(v: number): void;
  /** 捲動速度（視窗高／秒，呼叫端已平滑）。 */
  setScrollSpeed(v: number): void;
  /** 一下輕輕的氣息（教練卡片進入視窗中央等）。 */
  pulse(strength?: number): void;
  /**
   * 落地的演出（試作 `land()` 的參數，不是 `BURSTS.land`）：目標改回 `land`、一下往四周的輕衝量（力道 0.9、不鬆彈簧）、
   * 彈簧加倍 0.5 秒（「啪」一下定住）、雙圈衝擊波加腳下白閃、鏡頭震。形體還沒載入時先載入。減少動態沒有效果。
   */
  playLanding(): void;
  /**
   * 開場演出（D18，時間軸在 `intro.ts`）：接續 `land` 的聚合態 → 散開 → 吸氣聚成 `lift`（往中心的流線）→ 落地（`playLanding` 的演出）。
   * `land`、`lift` 形體載入完成才開始計時；演完（約 3.4 秒）自動結束。`{ skip: true }` ＝ 立刻收尾：不播任何特效，
   * 停在 `land`（正在演才有作用；也取消還在等形體載入的開場）。演出中（或等形體載入中）`setPose` 成別的姿勢也會立刻結束開場；
   * `setPose('land')` 則不打斷它（開場本來就停在 land）。減少動態沒有效果。
   */
  playIntro(opts?: { skip?: boolean }): void;
  /** 只動相機與 render target，不重建模擬、不動姿勢。 */
  resize(w: number, h: number): void;
  /** 重建 GPGPU（同一個 tier 也會重建）；保留目前姿勢。 */
  setTier(t: TierId): Promise<void>;
  dispose(): void;
  /** 只在 `debug: true`（`?qi-debug=1`）時存在。 */
  readonly debug?: QiDebug;
}

export interface QiDebug {
  /** 重畫一格並讀回像素（畫布不保留緩衝，不能事後從外面讀）。`region` 是 CSS 像素；`red` ＝ R>150、G<90、B<90 的像素數。 */
  snapshot(region?: Box): { width: number; height: number; covered: number; bright: number; red: number };
  /** GPU 讀回：非環境煙的點到目標的平均距離（世界單位）。 */
  meanError(): number;
  /** 螢幕座標（CSS 像素）半徑 r 內的平均速率。 */
  speedNear(x: number, y: number, r: number): number;
  /** 平均「往中心」的速度分量（正＝往內）。 */
  radialVelocity(): number;
  uniforms(): Record<string, number>;
  pulseCount(): number;
  simGeneration(): number;
  tier(): TierId;
  /** 目前的姿勢（還沒擺過是 null）。 */
  pose(): PoseId | null;
  /** 到目前為止畫過幾格（每個 rAF 一格，加上 resize／setTier／減少動態換姿勢時的補畫，以及 `snapshot` 自己的重畫）。 */
  draws(): number;
  /** three 的資源計數（`renderer.info`）：貼圖、幾何、著色器程式。重建 tier 後要回到基線，不能洩漏。 */
  resources(): { textures: number; geometries: number; programs: number };
  /** 以內部虛擬時間餵調速器（不依賴 rAF）。Task 17 在這裡接上 `createGovernor`；目前只累計虛擬時間（`uniforms().virtualTimeMs`）。 */
  feedFrameTime(ms: number): void;
  /** 人物本地座標的一點在螢幕上的位置（CSS 像素，與滑鼠座標同一個空間）；測試用來知道人形在哪裡。 */
  project(x: number, y: number, z: number): { x: number; y: number };
}

/** 一個姿勢展開後的目標：貼圖給 GPU，原始資料留給讀回比對。 */
interface Target {
  texture: DataTexture;
  data: Float32Array;
}

/** `covered`／`bright` 的亮度門檻（像素最大通道，0–255；底色約 11）。 */
const COVERED_MIN = 30;
const BRIGHT_MIN = 150;
/** 一格最多推進的時間（秒）：分頁切走再回來時不要一次跳太遠。 */
const MAX_DT = 1 / 30;
/** `pulse` 的衝量：與落地的濺出同一種（從腳下往四周），但很輕、不鬆彈簧。 */
const PULSE: Burst = { dir: [0, -1, 0], power: 0.9, mode: 2, hold: 0 };
/** 落地（試作 `land()`）：往四周的輕衝量、不鬆彈簧，彈簧加倍 `LANDING_SNAP` 秒。`BURSTS.land` 是捲動抵達那一式用的，兩者不同。 */
const LANDING_BURST: Burst = { dir: [0, -1, 0], power: 0.9, mode: 2, hold: 0 };
const LANDING_SNAP = 0.5;
/** 衝擊波只算到落地後這麼久（秒），之後地面回到平靜。 */
const SHOCK_SECONDS = 3;
/** 人形的中心（讀回「往中心」用）。 */
const CENTER = new Vector3(0, 1, 0);
/** 手在畫面外（掌風碰不到任何光點）與靜止的速度。 */
const OFFSCREEN = new Vector3(99, 99, 0);
const STILL = new Vector3();

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const finiteOr = (x: number, fallback: number): number => (Number.isFinite(x) ? x : fallback);

export async function mountQiStage(o: QiStageOptions): Promise<QiStage> {
  if (!Object.hasOwn(TIERS, o.tier)) throw new RangeError(`Unknown tier: ${String(o.tier)}`);
  const renderer = new WebGLRenderer({ canvas: o.canvas, antialias: false, powerPreference: 'high-performance' });
  let stage: Stage | null = null;
  let pointer: Pointer | null = null;
  try {
    stage = createStage(renderer, o.canvas);
    pointer = o.reducedMotion ? null : createPointer(o.canvas);
    return createApi(o, renderer, stage, pointer);
  } catch (error) {
    pointer?.dispose();
    stage?.dispose();
    renderer.dispose();
    throw error;
  }
}

function createApi(o: QiStageOptions, renderer: WebGLRenderer, stage: Stage, pointer: Pointer | null): QiStage {
  const { canvas, loader, reducedMotion } = o;
  let tier = o.tier;
  let cssWidth = canvas.clientWidth || window.innerWidth;
  let cssHeight = canvas.clientHeight || window.innerHeight;
  let wide = cssWidth >= cssHeight;

  // ── 一個 tier 的資源（setTier 時整組換掉）──────────────────────────
  let side = 0;
  let sim: Sim | null = null;
  let zero: DataTexture | null = null; // 減少動態時的速度貼圖
  let ambient: AmbientField = ambientField(0);
  const targets = new Map<PoseId, Target>();
  let placed = false;
  let generation = 0;

  const shapes = new Map<string, Shape>(); // 已載入的形體（跨 tier 保留）

  const releaseGeneration = (): void => {
    for (const t of targets.values()) t.texture.dispose();
    targets.clear();
    sim?.dispose();
    sim = null;
    zero?.dispose();
    zero = null;
    target = null; // 貼圖已釋放；姿勢（`pose`）保留，由呼叫端重新展開
  };

  const rebuild = (): void => {
    const spec = TIERS[tier];
    releaseGeneration();
    side = spec.side;
    stage.build({ tier, side, lite: !spec.glow, glow: spec.glow }); // 取景與 RT 尺寸沿用 stage 記住的大小
    ambient = ambientField(side * side);
    if (reducedMotion) zero = zeroTexture(side);
    else sim = createSim(renderer, side);
    placed = false;
    generation++;
  };

  // ── 姿勢與衝量 ─────────────────────────────────────────────────
  let pose: PoseId | null = null;
  let target: Target | null = null;
  let poseToken = 0;
  let time = 0;
  let scatter = 0;
  let scrollSpeed = 0;
  let burstAt = -10;
  let burstHold = 1;
  let burstPower = 0; // 最近一次衝量的力道（`impulse.power` 只在發生的那一格有值）：拖尾的包絡用
  let snapUntil = -1; // 落地的「啪」：這個時間之前彈簧加倍
  let shockAt = -1; // 落地的時間；< 0 ＝ 沒有衝擊波
  let introT = -1; // 開場從交接起算的秒數；< 0 ＝ 沒有在演
  let introPending = false; // 等形體載入、還沒開始計時
  let introToken = 0;
  let introExhaled = false;
  let introLanded = false;
  const impulse = { dir: new Vector3(), power: 0, mode: 0 };
  let pulses = 0;
  let virtualMs = 0;
  let disposed = false;

  const fire = (burst: Burst): void => {
    burstAt = time;
    burstHold = burst.hold ?? 1;
    burstPower = burst.power;
    impulse.dir.set(...burst.dir).normalize();
    impulse.power = burst.power;
    impulse.mode = burst.mode;
  };

  const makeTarget = (id: PoseId): Target => {
    const cached = targets.get(id);
    if (cached) return cached;
    let data: Float32Array;
    if (id === 'flow') {
      data = flowTargets(side, ambient);
    } else {
      const shape = shapes.get(id);
      if (!shape) throw new Error(`Shape ${id} is not loaded`);
      const recipe = SHAPES[id];
      data = expandTargets(shape, side, ambient, recipe?.kind === 'weapon' ? weaponLayout(recipe.name, wide) : undefined);
    }
    const texture = new DataTexture(data, side, side, RGBAFormat, FloatType);
    texture.needsUpdate = true;
    const made = { texture, data };
    targets.set(id, made);
    return made;
  };

  let draws = 0;
  /** 畫一格（綁上最新的位置與速度貼圖）。不推進模擬。 */
  const draw = (): void => {
    if (sim) stage.bind(sim.positionTexture(), sim.velocityTexture());
    else if (target && zero) stage.bind(target.texture, zero);
    stage.render();
    draws++;
  };

  /**
   * 狀態變了（改畫布大小、重建 tier、減少動態換姿勢）而緩衝被清掉：立刻補畫一格，不等下一個 rAF（手機網址列伸縮時不閃）。
   * 減少動態沒有 rAF，鏡頭也不動，所以先把鏡頭擺到定位。還沒有姿勢時沒有東西可畫。
   */
  const redraw = (): void => {
    if (!target) return;
    if (reducedMotion) stage.update(0, 0, { idle: true, nx: 0, ny: 0 }, false);
    draw();
  };

  const apply = (next: PoseId, made: Target, burst: boolean): void => {
    pose = next;
    target = made;
    if (sim) {
      sim.setTarget(made.texture);
      if (!placed) {
        sim.place(made.texture);
        placed = true;
      }
      if (burst) fire(BURSTS[next]);
    }
    stage.setVisible(true);
  };

  // ── 落地與開場（Task 16）──────────────────────────────────────────
  /** 落地的演出：目標改回 `land`（`land` 形體要已載入）、輕衝量、彈簧加倍一小段、衝擊波與鏡頭震。 */
  const land = (): void => {
    if (!sim) return;
    poseToken++; // 還在載入的 setPose 不要在落地之後又把姿勢蓋掉
    apply('land', makeTarget('land'), false);
    fire(LANDING_BURST);
    snapUntil = time + LANDING_SNAP;
    shockAt = time;
  };

  /** 開場結束（演完、被略過、或演出中換了姿勢）：取消還在等形體的開場；停在 `lift` 的話回到 `land`（不給衝量）。 */
  const endIntro = (): void => {
    introToken++;
    introPending = false;
    if (introT < 0) return;
    introT = -1;
    if (pose === 'lift' && shapes.has('land')) apply('land', makeTarget('land'), false);
  };

  const ensureShape = async (id: PoseId): Promise<void> => {
    if (shapes.has(id)) return;
    shapes.set(id, await loader.load(id));
  };

  /** 開場的一格：依 `introState` 換目標、在 exhale 開頭給一次往外的衝量、到 land 階段落地；回傳這一格的開場狀態（演完就是 undefined）。 */
  const stepIntro = (dt: number): IntroState | undefined => {
    if (introT < 0) return undefined;
    introT += dt;
    const state = introState(introT);
    if (state.phase === 'done') {
      introT = -1;
      return undefined;
    }
    if (!introExhaled && state.phase !== 'handoff') {
      introExhaled = true;
      fire({ ...BURSTS.lift, power: BURSTS.lift.power * EXHALE.gain }); // 散開：從腳下往四周吐出去（lift 的衝量，力道加大）
    }
    if (state.target === 'lift' && pose !== 'lift') apply('lift', makeTarget('lift'), false);
    if (state.phase === 'land' && !introLanded) {
      introLanded = true;
      land();
    }
    return state;
  };

  stage.setSize(cssWidth, cssHeight);
  rebuild();

  // ── 每一格 ─────────────────────────────────────────────────────
  let rafId = 0;
  let last = performance.now();
  const hand = pointer?.state;

  const advance = (dt: number, now: number): void => {
    if (!sim) return;
    time += dt;
    const intro = stepIntro(dt);
    const snap = time < snapUntil;
    const forces = forcesFor({
      scatter,
      scrollSpeed,
      sinceBurst: time - burstAt,
      burstHold,
      snap,
      ...(intro ? { intro: { springScale: intro.springScale } } : {}),
    });
    if (shockAt >= 0 && time - shockAt > SHOCK_SECONDS) shockAt = -1;
    stage.setEffects({
      shockT: shockAt >= 0 ? time - shockAt : -1,
      // 拖尾上限：換招衝量的包絡與吸氣的包絡取大者；平時 1（所有點都是圓的）
      streak: Math.max(streakLength(burstSpeed(burstPower, time - burstAt)), inhaleStreak(intro?.inhale ?? 0)),
    });
    stage.update(time, dt, pointer ? { idle: pointer.idle, nx: pointer.ndc.x, ny: pointer.ndc.y } : { idle: true, nx: 0, ny: 0 });
    pointer?.step(dt, now, stage.camera, stage.body.matrixWorld);
    sim.step({
      time,
      dt,
      spring: forces.spring,
      curl: forces.curl,
      damp: inhaleDamp(forces.damp, intro?.inhale ?? 0) * (snap ? SNAP_DAMP_GAIN : 1),
      hand: hand?.hand ?? OFFSCREEN,
      handA: hand?.handA ?? OFFSCREEN,
      handVel: hand?.vel ?? STILL,
      impulse,
      inhale: intro?.inhale ?? 0,
    });
    impulse.power = 0; // 衝量只在發生的那一格有值
    draw();
  };

  const frame = (): void => {
    rafId = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(Math.max((now - last) / 1000, 0), MAX_DT);
    last = now;
    advance(dt, now);
  };
  if (!reducedMotion) rafId = requestAnimationFrame(frame);

  // ── 除錯（?qi-debug=1）─────────────────────────────────────────
  const positions = (): Float32Array => (sim ? sim.readPositions() : (target?.data ?? new Float32Array(0)));
  const velocities = (): Float32Array => (sim ? sim.readVelocities() : new Float32Array(positions().length));
  const screen = { x: 0, y: 0 };

  const debug: QiDebug = {
    snapshot(region) {
      draw(); // 畫布不保留緩衝：先重畫一格，才讀得到
      const gl = renderer.getContext();
      const { width: bw, height: bh, pixelRatio } = stage.bufferSize();
      const box = region ?? { x: 0, y: 0, w: cssWidth, h: cssHeight };
      const x0 = clamp(Math.floor(box.x * pixelRatio), 0, bw);
      const y0 = clamp(Math.floor(box.y * pixelRatio), 0, bh);
      const x1 = clamp(Math.ceil((box.x + box.w) * pixelRatio), 0, bw);
      const y1 = clamp(Math.ceil((box.y + box.h) * pixelRatio), 0, bh);
      const w = x1 - x0;
      const h = y1 - y0;
      if (w <= 0 || h <= 0) return { width: 0, height: 0, covered: 0, bright: 0, red: 0 };
      const pixels = new Uint8Array(w * h * 4);
      renderer.setRenderTarget(null);
      gl.readPixels(x0, bh - y1, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels); // GL 的原點在左下
      let covered = 0;
      let bright = 0;
      let red = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i]!;
        const g = pixels[i + 1]!;
        const b = pixels[i + 2]!;
        const peak = Math.max(r, g, b);
        if (peak > COVERED_MIN) covered++;
        if (peak > BRIGHT_MIN) bright++;
        if (r > 150 && g < 90 && b < 90) red++;
      }
      const total = w * h;
      return { width: w, height: h, covered: covered / total, bright: bright / total, red };
    },
    meanError() {
      if (!target) return 0;
      const p = positions();
      const t = target.data;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < t.length; i += 4) {
        if (t[i + 3]! < -0.5) continue; // 環境煙不算
        sum += Math.hypot(p[i]! - t[i]!, p[i + 1]! - t[i + 1]!, p[i + 2]! - t[i + 2]!);
        n++;
      }
      return n > 0 ? sum / n : 0;
    },
    speedNear(x, y, r) {
      const p = positions();
      const v = velocities();
      let sum = 0;
      let n = 0;
      for (let i = 0; i < p.length; i += 4) {
        stage.project(p[i]!, p[i + 1]!, p[i + 2]!, screen);
        if (Math.hypot(screen.x - x, screen.y - y) > r) continue;
        sum += Math.hypot(v[i]!, v[i + 1]!, v[i + 2]!);
        n++;
      }
      return n > 0 ? sum / n : 0;
    },
    radialVelocity() {
      const p = positions();
      const v = velocities();
      let sum = 0;
      let n = 0;
      for (let i = 0; i < p.length; i += 4) {
        const rx = p[i]! - CENTER.x;
        const ry = p[i + 1]! - CENTER.y;
        const rz = p[i + 2]! - CENTER.z;
        const len = Math.hypot(rx, ry, rz);
        if (len < 1e-3) continue;
        sum -= (v[i]! * rx + v[i + 1]! * ry + v[i + 2]! * rz) / len; // 往外的分量取負號：往內為正
        n++;
      }
      return n > 0 ? sum / n : 0;
    },
    uniforms: () => ({
      ...stage.uniforms(),
      ...(sim?.uniforms() ?? {}),
      uScatter: scatter,
      uScrollSpeed: scrollSpeed,
      uTime: time,
      uIntroT: introT, // 開場從交接起算的秒數；-1 ＝ 沒有在演
      floatTargets: floatTargets(renderer) ? 1 : 0, // 0 ＝ 模擬退回半精度的 render target
      virtualTimeMs: virtualMs,
    }),
    pulseCount: () => pulses,
    simGeneration: () => generation,
    tier: () => tier,
    pose: () => pose,
    draws: () => draws,
    resources: () => ({
      textures: renderer.info.memory.textures,
      geometries: renderer.info.memory.geometries,
      programs: renderer.info.programs?.length ?? 0,
    }),
    feedFrameTime(ms) {
      virtualMs += ms;
    },
    project: (x, y, z) => stage.project(x, y, z),
  };

  // ── 公開 API ───────────────────────────────────────────────────
  return {
    async setPose(next, opts) {
      if (next !== 'flow' && !Object.hasOwn(SHAPES, next)) throw new RangeError(`Unknown pose: ${String(next)}`);
      if (!Object.hasOwn(BURSTS, next)) throw new RangeError(`No burst defined for pose: ${String(next)}`);
      if (next === 'land' && (introT >= 0 || introPending)) {
        // 開場最後就停在 land：演出中（或等形體中）再要 land 不必打斷它，也不重複給衝量
        await ensureShape('land');
        return;
      }
      endIntro(); // 演出中換成別的姿勢：開場立刻收尾，以這一次為準
      const token = ++poseToken;
      if (next !== 'flow' && !shapes.has(next)) shapes.set(next, await loader.load(next));
      if (disposed || token !== poseToken) return; // 載入途中被新的呼叫取代：以最後一次為準
      apply(next, makeTarget(next), opts?.burst ?? true);
      if (reducedMotion) redraw(); // 沒有 rAF：換了姿勢就畫一格（有 rAF 時下一格自然會畫）
    },
    setScatter(v) {
      scatter = clamp(finiteOr(v, 0), 0, 1);
    },
    setScrollSpeed(v) {
      scrollSpeed = Math.max(0, finiteOr(v, 0));
    },
    pulse(strength = 1) {
      pulses++;
      if (sim) fire({ ...PULSE, power: PULSE.power * Math.max(0, finiteOr(strength, 1)) });
    },
    playLanding() {
      if (disposed || !sim) return;
      endIntro();
      if (shapes.has('land')) {
        land();
        return;
      }
      const token = ++poseToken;
      ensureShape('land').then(
        () => {
          if (!disposed && token === poseToken) land();
        },
        () => undefined, // the load error is surfaced by setPose, which is the call that must succeed; the landing effect is optional
      );
    },
    playIntro(opts) {
      if (disposed) return;
      if (opts?.skip) {
        endIntro();
        return;
      }
      if (!sim || introT >= 0 || introPending) return; // 減少動態沒有演出；演出中再呼叫不重來
      introPending = true;
      const token = ++introToken;
      Promise.all([ensureShape('land'), ensureShape('lift')]).then(
        () => {
          if (disposed || token !== introToken) return;
          introPending = false;
          if (pose !== 'land') apply('land', makeTarget('land'), false); // 交接：從 land 的聚合態開始
          introT = 0;
          introExhaled = false;
          introLanded = false;
        },
        () => {
          if (token === introToken) introPending = false; // 形體載不到就不演（頁面照常、停在目前姿勢）
        },
      );
    },
    resize(w, h) {
      if (disposed) return;
      cssWidth = Math.max(1, w);
      cssHeight = Math.max(1, h);
      stage.setSize(cssWidth, cssHeight);
      const nowWide = cssWidth >= cssHeight;
      if (nowWide !== wide) {
        // 兵器的長度與傾角依視窗寬窄而不同：翻轉時重展開，姿勢不變、不給衝量
        wide = nowWide;
        for (const [id, t] of [...targets]) {
          if (SHAPES[id]?.kind !== 'weapon') continue;
          t.texture.dispose();
          targets.delete(id);
        }
        if (pose && SHAPES[pose]?.kind === 'weapon') apply(pose, makeTarget(pose), false);
      }
      redraw(); // 改了畫布大小，緩衝被清掉
    },
    async setTier(next) {
      if (!Object.hasOwn(TIERS, next)) throw new RangeError(`Unknown tier: ${String(next)}`);
      if (disposed) return;
      tier = next;
      rebuild();
      if (pose) apply(pose, makeTarget(pose), false); // 形體已載入過；光點直接落在目標上
      redraw(); // 重建清掉了緩衝
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      pointer?.dispose();
      releaseGeneration();
      stage.dispose();
      renderer.dispose();
    },
    ...(o.debug ? { debug } : {}),
  };
}
