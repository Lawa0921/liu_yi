/**
 * 「氣聚成人」光點引擎的入口（動態 import 的 chunk）：把形體、模擬、舞台、掌風接成一個 `QiStage`。
 * 這個檔案唯一的執行時 export 是 `mountQiStage`；其餘都是型別。
 *
 *   - 姿勢：`setPose` 載入形體（`ShapeLoader`）、依 tier 展開成目標貼圖（`expandTargets`／`flowTargets`）、換目標並（預設）給一次衝量
 *     （`BURSTS`）。第一次擺姿勢（以及換 tier 重建後）光點直接落在目標上，沒有飛行過程：首頁要接續靜態圖的聚合態，不能先從遠處飛來。
 *   - 力場：每一格由 `forcesFor` 依散開量、捲動速度、距上次衝量的時間算出彈簧／旋渦／阻尼（散開量與捲動速度由呼叫端餵）。
 *   - `resize` 只動相機與 render target；`setTier` 才重建 GPGPU（`simGeneration` 遞增）。
 *   - 自動降級（Task 17）：每個 rAF 以 `performance.now()` 餵 `createGovernor`（D16）；它說該降級了就 `setTier` 到下一級（保留目前姿勢、
 *     光點直接落在目標上），給一次輕衝量遮住重建的跳動，並在 `window` 上發 `qi:tier`（`detail` 是新的 tier；手動 `setTier` 換了級也發）。
 *     首頁腳本聽這個事件更新 `html[data-qi-tier]` 與 `window.__qi.tier`；引擎本身不碰 DOM 屬性。減少動態沒有 rAF，也就沒有降級。
 *     （Task 22）開場正在演時調速器說「該降」只記下來，開場結束（演完、被略過、被別的姿勢打斷）的下一格才降——重建會把光點直接放回目標上，
 *     演到一半降會把散開與吸氣瞬移抹掉。分頁轉為可見（`visibilitychange`）時調速器重建、重新暖機：切走期間的計時與回來後頭幾格的慢幀不算。
 *     自動降級的重建若丟錯（記憶體不足、著色器編不出來），引擎已沒有 sim 可畫：停掉自己的迴圈、呼叫 `onFailure` 一次，由呼叫端 `dispose()` 並退回靜態圖
 *     （不讓畫面停在空白畫布）。手動 `setTier` 的錯照舊 reject 給呼叫端。
 *   - 減少動態（`reducedMotion`）：不跑模擬、不收指標、不排 rAF；光點直接畫在目標上，狀態改變時畫一格。
 *   - 武器的擺放依視窗寬窄（D13）：寬窄翻轉時重展開武器的目標，姿勢不變。
 *   - 補強（Task 16）：換招拖尾（`uStreak`，由衝量的包絡決定）、落地演出（`playLanding`：雙圈衝擊波、白閃、鏡頭震）、
 *     開場演出（`playIntro`：吸氣流線，時間軸見 `intro.ts`）。這些都只在有模擬時才動（減少動態沒有）。
 *   - 朱印（Task 21）：`getSealRect` 量印的螢幕矩形（光點聚合後才有），首頁把 `.seal-hit` 定位上去。
 * 注意：會被打進引擎 chunk，所以錯誤訊息只用英文。
 */

import { DataTexture, FloatType, RGBAFormat, Vector3, WebGLRenderer } from 'three';
import { BURSTS, type Burst, type PoseId } from '../config/poses';
import { SEAL_CENTER_Y, SEAL_WORLD_SIZE, SHAPES } from '../config/shapes';
import { ambientField, expandTargets, flowTargets, weaponLayout, type AmbientField } from '../shapes/expand';
import type { Shape } from '../shapes/format';
import type { ShapeLoader } from '../shapes/loader';
import { floatTargets } from './caps';
import { burstSpeed, EXHALE, inhaleDamp, inhaleStreak, SNAP_DAMP_GAIN, streakLength } from './effects';
import { forcesFor } from './forces';
import { weaponReachFor } from './framing';
import { introState, type IntroState } from './intro';
import { createPointer, type Pointer } from './pointer';
import { createSim, zeroTexture, type Sim } from './sim';
import { createStage, type Stage } from './stage';
import { createGovernor, TIERS, type Governor, type TierId } from './tiers';
import { isPortrait } from './viewport';

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
  /** 減少動態：不跑模擬、不排 rAF。預設 false（首頁在減少動態時根本不掛引擎，只有開發用的 harness 會傳）。 */
  reducedMotion?: boolean;
  /** 暴露 `stage.debug`（`?qi-debug=1`）。預設不暴露。 */
  debug?: boolean;
  /**
   * WebGL context 中途遺失時呼叫一次（RF5）。引擎不會自己復原：呼叫端應 `dispose()` 並退回靜態圖。
   * `dispose` 之後遺失的不呼叫。
   */
  onContextLost?: () => void;
  /**
   * 引擎中途出錯、無法繼續畫時呼叫一次：目前只有「依 fps 自動降級時重建 GPGPU 丟錯」。這時引擎已停掉自己的迴圈、不再降級，
   * 呼叫端應 `dispose()` 並退回靜態圖（首頁 `enterStatic`）。`dispose` 之後發生的不呼叫。
   */
  onFailure?: (error: unknown) => void;
  /**
   * 現在是直向嗎（取景與兵器擺位依它）。首頁傳 `() => isPortrait(innerWidth, innerHeight)`：版面的 CSS 用同一條寬高比
   * （`@media (max-aspect-ratio: 4/5)`）切換，引擎的畫布扣掉了外框，自己的寬高比與視窗的不同，所以由呼叫端告知。
   * 不給就依畫布本身的寬高比（沒有外框的 harness 頁，畫布就是視窗）。每次 `resize` 都會再問一次。
   */
  portrait?: () => boolean;
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
   * `onEnd`（Task 19，首頁用來收起「略過」鈕）：這一次開場結束時呼叫一次——演完、被略過、被別的姿勢打斷、或形體載不到而取消；
   * 沒有演出（減少動態、已在演）時不會呼叫；`dispose` 也不呼叫。
   */
  playIntro(opts?: { skip?: boolean; onEnd?: () => void }): void;
  /**
   * 朱印在螢幕上的矩形（CSS 像素，與滑鼠座標同一個空間；首頁用來把 `.seal-hit` 定位到印上）。
   * 光點還沒聚成印就回 `null`：姿勢不是 `seal`、散開量超過 `SEAL_SCATTER_MAX`、或聚合後還沒安定滿 `SEAL_SETTLE_S`
   * （模擬秒；換姿勢、又散開之後重新計時）。減少動態沒有模擬，光點直接畫在目標上，所以姿勢是 `seal` 就有。
   * 印隨視差與相機呼吸有一點點移動，所以每格重量；外框只含印本身（`SEAL_WORLD_SIZE` 見方），不含光暈。
   */
  getSealRect(): Box | null;
  /** 只動相機與 render target，不重建模擬、不動姿勢。 */
  resize(w: number, h: number): void;
  /**
   * 重建 GPGPU（同一個 tier 也會重建）；保留目前姿勢。換了級就在 `window` 發 `qi:tier`（`CustomEvent`，`detail` 是新的 tier；同一級不發），
   * 並讓調速器從新的級重新暖機（所以手動換級後不會又被「降」回舊的階梯）。依 fps 自動降級也走這條路，另外給一次輕衝量。
   */
  setTier(t: TierId): Promise<void>;
  /** 釋放資源並把 GL context 還給瀏覽器（這個 canvas 之後不能再掛引擎）；重複呼叫無妨。 */
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
  /**
   * 以內部虛擬時間餵調速器（不依賴 rAF，測試在單一 evaluate 迴圈裡餵幀即可）：累計虛擬時間（`uniforms().virtualTimeMs`），
   * 調速器說該降級就降級（同 rAF 路徑）。第一次呼叫起，調速器改由虛擬時間獨佔（從目前的 tier 重新暖機），真的 rAF 不再餵，
   * 兩種時間軸不會混在一起。減少動態沒有模擬、沒有幀成本，只累計時間、不降級。
   */
  feedFrameTime(ms: number): void;
  /** 人物本地座標的一點在螢幕上的位置（CSS 像素，與滑鼠座標同一個空間）；測試用來知道人形在哪裡。 */
  project(x: number, y: number, z: number): { x: number; y: number };
  /** 同 `QiStage.getSealRect`（正式頁在 `stage.getSealRect()`；`?qi-debug=1` 才多這一個，e2e 用）。 */
  sealRect(): Box | null;
  /**
   * 非環境煙的光點目前在螢幕上的外框（CSS 像素，與 `project` 同一個空間；沒有任何光點就是全 0）。
   * 測試用它量兵器有沒有壓到頁面上的東西（右緣的段落導覽）：聚合後（`meanError()` 夠小）量，才是姿勢的外框而不是飛行中的光點。
   */
  extent(): { left: number; right: number; top: number; bottom: number };
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
/**
 * 朱印算「聚合」的條件（`getSealRect`）：散開量不超過 `SEAL_SCATTER_MAX`，且姿勢是 `seal`，並且這樣持續了 `SEAL_SETTLE_S` 模擬秒。
 * 光點從別的姿勢（或散開）飛回印上要一點時間：實測（min tier，彈簧與 tier 無關）從 flow 換成 seal，1.2 秒時光點與目標的平均距離
 * 還有 0.2（印寬 1.6），2 秒時約 0.03、3 秒時 0.008。所以取 2 秒；e2e 在矩形出現的那一刻量 `meanError()` 把關。
 */
const SEAL_SCATTER_MAX = 0.1;
const SEAL_SETTLE_S = 2;
/** 人形的中心（讀回「往中心」用）。 */
const CENTER = new Vector3(0, 1, 0);
/** 手在畫面外（掌風碰不到任何光點）與靜止的速度。 */
const OFFSCREEN = new Vector3(99, 99, 0);
const STILL = new Vector3();

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const finiteOr = (x: number, fallback: number): number => (Number.isFinite(x) ? x : fallback);

/**
 * 把 GL context 還給瀏覽器：`renderer.dispose()` 只釋放 three 自己建的資源，不會放掉 context，
 * 而頁面（或這個 canvas）可能還活著，context 名額與 GPU 記憶體要馬上還。已經遺失的不能再叫 `loseContext`
 * （會多一則 console 警告），所以先看一眼。
 */
function releaseContext(renderer: WebGLRenderer): void {
  try {
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
  } catch {
    // context 已經不在了：沒有東西可放
  }
}

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
    releaseContext(renderer); // 掛載失敗：呼叫端退回靜態圖，這個 context 不會再用
    throw error;
  }
}

function createApi(o: QiStageOptions, renderer: WebGLRenderer, stage: Stage, pointer: Pointer | null): QiStage {
  const { canvas, loader, reducedMotion } = o;
  let tier = o.tier;
  let cssWidth = canvas.clientWidth || window.innerWidth;
  let cssHeight = canvas.clientHeight || window.innerHeight;
  /** 直向（取景與兵器擺位）：呼叫端告知（首頁依視窗），不給就依畫布本身的寬高比。 */
  const askPortrait = (): boolean => (o.portrait ? o.portrait() : isPortrait(cssWidth, cssHeight));
  let portrait = askPortrait();
  /**
   * 兵器擺位的條件：直向用窄版長度；橫向用寬版長度，並依畫布大小留出右緣（段落導覽與槍頭光暈）的位置，
   * 所以橫向時畫布一變，兵器的長度也跟著變（`weaponReachFor`）。字串鍵讓 `resize` 比較「擺位有沒有變」。
   */
  const weaponReach = (): number | undefined => (portrait ? undefined : weaponReachFor(cssWidth / cssHeight, cssWidth));
  const weaponKey = (): string => String(weaponReach()?.toFixed(4) ?? 'narrow');
  let weaponFit = weaponKey();

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
  let introOnEnd: (() => void) | null = null; // `playIntro` 的 `onEnd`：這一次開場結束時呼叫一次
  let sealCalm = 0; // 姿勢是 seal 且散開量夠低，已經持續幾模擬秒（`getSealRect` 的「聚合」條件）
  const impulse = { dir: new Vector3(), power: 0, mode: 0 };
  let pulses = 0;
  let virtualMs = 0;
  let governor: Governor = createGovernor({ start: tier });
  let virtualClock = false; // `feedFrameTime` 用過：調速器只吃虛擬時間
  let deferredTier: TierId | null = null; // 開場期間調速器說該降的 tier：開場結束後的下一格才降（調速器自己已往下走了一級）
  let failed = false; // 自動降級的重建丟錯：引擎沒有 sim 了，不再排幀、不再降級、已通知呼叫端
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
      data = expandTargets(shape, side, ambient, recipe?.kind === 'weapon' ? weaponLayout(recipe.name, !portrait, weaponReach()) : undefined);
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
    if (next !== pose) sealCalm = 0; // 換了姿勢：光點要重新飛一趟
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
    const wasActive = introT >= 0 || introPending;
    introToken++;
    introPending = false;
    if (introT >= 0) {
      introT = -1;
      if (pose === 'lift' && shapes.has('land')) apply('land', makeTarget('land'), false);
    }
    if (wasActive) notifyIntroEnd();
  };

  /** 這一次開場結束了：把 `onEnd` 交出去並清掉（只呼叫一次）。 */
  const notifyIntroEnd = (): void => {
    const done = introOnEnd;
    introOnEnd = null;
    done?.();
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
      notifyIntroEnd();
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

  // ── 換級與自動降級（Task 17）───────────────────────────────────────
  /**
   * 換成 `next`：重建 GPGPU、保留姿勢（光點直接落在目標上）、補畫一格，換了級才發 `qi:tier`。
   * `auto`（調速器要求的降級）另給一次輕衝量，遮住光點數突然變少的那一下；調速器自己已往下走了一級（含冷卻），所以不動它。
   * 手動換級則讓調速器從新的級重新暖機。
   */
  const changeTier = (next: TierId, auto: boolean): void => {
    const changed = next !== tier;
    tier = next;
    rebuild();
    if (pose) {
      apply(pose, makeTarget(pose), false);
      if (auto) fire(PULSE); // 不增加 pulseCount：那是「呼叫端要求的氣息」
    }
    if (!auto) {
      governor = createGovernor({ start: next });
      deferredTier = null; // 呼叫端明確指定了級：先前記下的降級作廢
    }
    redraw(); // 重建清掉了緩衝
    if (changed) window.dispatchEvent(new CustomEvent('qi:tier', { detail: next }));
  };

  /** 開場正在演（或在等開場要用的形體）：這時重建會把演出瞬移抹掉。 */
  const introActive = (): boolean => introT >= 0 || introPending;

  /**
   * 自動降級一級。重建丟錯時引擎已沒有 sim 可畫（`rebuild` 一開頭就放掉舊的）：停掉自己的迴圈、通知呼叫端一次，
   * 由它 `dispose()` 並退回靜態圖；不能把錯丟回 rAF（畫面會停在空白畫布），也不能再重試。
   */
  const downgrade = (next: TierId): void => {
    try {
      changeTier(next, true);
    } catch (error) {
      failed = true;
      deferredTier = null;
      cancelAnimationFrame(rafId);
      rafId = 0;
      // 呼叫端沒接 onFailure 時不能悄悄吞掉：畫面會停在空白畫布，至少留一筆錯誤給開發者與 console 監看
      if (o.onFailure) o.onFailure(error);
      else console.error('The qi engine failed while lowering its tier.', error);
    }
  };

  /** 記下來的降級，開場結束就補上（每格都問一次；沒有記下來的就什麼都不做）。 */
  const applyDeferredTier = (): void => {
    if (failed || disposed || !deferredTier || introActive()) return;
    const next = deferredTier;
    deferredTier = null;
    downgrade(next);
  };

  /**
   * 調速器吃一格（`nowMs` 與它之前收到的同一條時間軸）；它說該降級就降（開場期間先記下來）。
   * 已經記下一次降級（開場還在演）就不再餵：調速器自己已往下走了一級，再餵只會每過一個冷卻就再降一級並覆寫記下的那一級，
   * 一個慢的開場就讓開場結束時直接降到最低；只降記下的那一級，之後調速器照常吃幀、看新的一級撐不撐得住。
   */
  const governFrame = (nowMs: number): void => {
    if (failed || disposed) return;
    if (!deferredTier) {
      const lower = governor.frame(nowMs);
      if (lower) deferredTier = lower;
    }
    applyDeferredTier();
  };

  stage.setSize(cssWidth, cssHeight, portrait);
  rebuild();

  // ── 每一格 ─────────────────────────────────────────────────────
  let rafId = 0;
  let last = performance.now();
  const hand = pointer?.state;

  const advance = (dt: number, now: number): void => {
    if (!sim) return;
    time += dt;
    sealCalm = pose === 'seal' && scatter <= SEAL_SCATTER_MAX ? sealCalm + dt : 0;
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
    if (failed) return;
    rafId = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(Math.max((now - last) / 1000, 0), MAX_DT);
    last = now;
    if (!virtualClock) governFrame(now); // 降級（重建）在這一格的模擬之前：新的 sim 馬上接手
    else applyDeferredTier(); // 虛擬時間下調速器不吃 rAF，但開場結束後記下的降級仍要補上
    if (failed) return; // 降級的重建丟錯：沒有 sim 了，迴圈已停
    advance(dt, now);
  };
  if (!reducedMotion) rafId = requestAnimationFrame(frame);

  // 分頁回到可見：切走期間 rAF 停擺、回來時 GPU 與計時器要一下子才醒，頭幾格會又慢又亂。調速器若照單全收，
  // 會把「剛回來」誤判成「這台機器太慢」，所以重新暖機（從目前要降到的級起算：開場期間記下的降級還沒做）。
  const onVisibility = (): void => {
    if (document.visibilityState !== 'visible' || reducedMotion || failed || disposed) return;
    governor = createGovernor({ start: deferredTier ?? tier });
  };
  document.addEventListener('visibilitychange', onVisibility);

  // ── 除錯（?qi-debug=1）─────────────────────────────────────────
  /** 朱印的螢幕矩形；還沒聚合就 null（條件見 `QiStage.getSealRect`）。 */
  const getSealRect = (): Box | null => {
    if (disposed || pose !== 'seal' || !target || scatter > SEAL_SCATTER_MAX) return null;
    if (sim && sealCalm < SEAL_SETTLE_S) return null; // 減少動態沒有模擬：光點直接在目標上
    const half = SEAL_WORLD_SIZE / 2;
    return stage.projectRect(-half, SEAL_CENTER_Y - half, SEAL_WORLD_SIZE, SEAL_WORLD_SIZE);
  };

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
      if (reducedMotion || disposed) return;
      if (!virtualClock) {
        virtualClock = true;
        governor = createGovernor({ start: tier }); // 重新暖機：之前（真的 rAF）收過的時間不能和虛擬時間混在一起
      }
      governFrame(virtualMs);
    },
    project: (x, y, z) => stage.project(x, y, z),
    sealRect: getSealRect,
    extent() {
      if (!target) return { left: 0, right: 0, top: 0, bottom: 0 };
      const p = positions();
      const t = target.data;
      let left = Infinity;
      let right = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      for (let i = 0; i < t.length; i += 4) {
        if (t[i + 3]! < -0.5) continue; // 環境煙不算
        stage.project(p[i]!, p[i + 1]!, p[i + 2]!, screen);
        left = Math.min(left, screen.x);
        right = Math.max(right, screen.x);
        top = Math.min(top, screen.y);
        bottom = Math.max(bottom, screen.y);
      }
      return right < left ? { left: 0, right: 0, top: 0, bottom: 0 } : { left, right, top, bottom };
    },
  };

  // ── WebGL context 中途遺失（RF5）──────────────────────────────────
  // three 自己的監聽器先收到（preventDefault、之後不再畫）；這裡通知呼叫端，由它 `dispose()` 並退回靜態圖。
  const onContextLost = (): void => {
    if (!disposed) o.onContextLost?.();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);

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
      introOnEnd = opts?.onEnd ?? null;
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
          if (token !== introToken) return;
          introPending = false; // 形體載不到就不演（頁面照常、停在目前姿勢）
          notifyIntroEnd();
        },
      );
    },
    getSealRect,
    resize(w, h) {
      if (disposed) return;
      cssWidth = Math.max(1, w);
      cssHeight = Math.max(1, h);
      portrait = askPortrait();
      stage.setSize(cssWidth, cssHeight, portrait);
      const nowFit = weaponKey();
      if (nowFit !== weaponFit) {
        // 兵器的長度與傾角依直橫與畫布寬高比而不同：擺位變了就重展開，姿勢不變、不給衝量
        weaponFit = nowFit;
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
      changeTier(next, false); // 形體已載入過；光點直接落在目標上
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      pointer?.dispose();
      releaseGeneration();
      stage.dispose();
      renderer.dispose();
      releaseContext(renderer); // 把 GL context 還給瀏覽器（頁面可能還活著）
    },
    ...(o.debug ? { debug } : {}),
  };
}
