// 3D 兵器檢視器。只由 src/scripts/weapons3d.ts 在「接近 3D 區塊」時動態載入，three 也只在這裡進來。
//
// 一個宿主元素（[data-weapon3d]）一個檢視器，三種模式：
//   stage   首頁「兵器」那一幕的兵器台：一次一件，捲動進度驅動出鞘／轉身／亮刃，可拖曳轉動、可切換。
//   single  課程頁的子項：一件兵器斜陳在自己的畫布裡，刃面來回擺動，可拖曳。
//   card    課程卡片：劍與苗刀交叉，指標移過時跟著微轉；不可拖（卡片本身是連結）。
//
// 構圖：兵器要完整裝進「舞台範圍」——畫布裡不壓到標題與課程牌的那一塊（量 DOM 得來），
// 大小與斜度由 src/lib/arsenal/stage.ts 算。拖曳轉動時可以短暫越界，回正後不壓字。
//
// 規矩（設計文件 §15.3）：離開畫面或分頁在背景就停止繪製；「減少動態」時不自轉、不播入場，
// 以靜態姿勢呈現，但拖曳仍可用；手機降規格（像素比上限、關陰影）由 RenderPlan 決定。

import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Group,
  Mesh,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import type { RenderPlan } from '../../lib/arsenal/capability';
import { createSpin, dragSpin, grabSpin, releaseSpin, stepSpin, type SpinState } from '../../lib/arsenal/inertia';
import { clamp01, scrollProgress, smoothstep, stagePose, viewportProgress, type StagePose, type WeaponKind } from '../../lib/arsenal/pose';
import { forgeBand, forgeFromSwitch, forgeMagnify } from '../../lib/arsenal/forge';
import { restingLean, rotatedExtent } from '../../lib/arsenal/stage';
import { advanceSwitch, createSwitch, requestSwitch, switchPresence, type SwitchState } from '../../lib/arsenal/switcher';
import { createMaterials, readPalette, type Materials } from './materials';
import { Sparks } from './forge';
import { createStudioEnvironment } from './studio';
import { buildWeapon, type Weapon } from './weapons';

export type ViewerMode = 'stage' | 'single' | 'card';

const KIND_LABEL: Record<WeaponKind, string> = { jian: '中國劍', miaodao: '苗刀', spear: '大槍' };
const KINDS: WeaponKind[] = ['jian', 'miaodao', 'spear'];
const isKind = (value: string | undefined): value is WeaponKind => KINDS.includes(value as WeaponKind);

const CAMERA_DISTANCE = 6;
/** 主光的強度。太強的話，平的刃面一對上角度就整面過曝成死白。 */
const KEY_INTENSITY = 1.1;
/** 鏡頭在原點處看得到的高度上限（公尺）：直的或接近方形的畫布用它（垂直視角約 26°）。 */
const MAX_VIEW_HEIGHT = 2.77;
/** 看得到的寬度上限：很扁的畫布（課程頁的一整列）改以寬為準，水平視角才不會大到像魚眼。 */
const MAX_VIEW_WIDTH = 5.2;
/** 「減少動態」時兵器台的固定姿勢：演完之後停住的那個姿勢（已出鞘、刃面朝外）。 */
const STILL_PROGRESS = 1;
/** single 模式自己擺動的幅度（弧度）與快慢：刃面始終朝著鏡頭，只是來回擺，光帶就在刃上來回流。 */
const SWAY = 0.5;
const SWAY_RATE = 0.0008;
/** 兵器只用到舞台範圍的這個比例（留邊，也吃掉透視造成的放大）。 */
const FIT = 0.88;
/** 劍在鞘裡時比出鞘後長一點（鞘尾），鞘退開時還會先沿刃滑出一小段：算大小時要算進去。 */
const SHEATH_EXTRA = 0.035;
const SHEATH_SLIDE = 0.12;
/** 大槍在畫面裡露出的長度（公尺）：槍頭往後這麼長，其餘的桿子從左邊伸出畫面。 */
const SPEAR_SHOWN = 1.05;

const SCRATCH = new Vector3();
const SWING = new Quaternion();
const Z_AXIS = new Vector3(0, 0, 1);
const BOX = new Box3();

/** 一件兵器加上擺姿勢用的幾層節點（由外到內：位置與轉台 → 傾斜 → 前後傾 → 橫放 → 繞長軸轉）。 */
class Rig {
  readonly outer = new Group();
  private readonly lean = new Group();
  private readonly tilt = new Group();
  private readonly lay = new Group();
  private readonly spin = new Group();
  private readonly inverse = new Quaternion();
  private readonly swings = new Map<Group, { angle: number; velocity: number; lastX: number | null }>();
  /** 長軸上對準畫面定位點的那一點（Y）。 */
  focus: number;

  constructor(readonly weapon: Weapon) {
    this.outer.add(this.lean);
    this.lean.add(this.tilt);
    this.tilt.add(this.lay);
    this.lay.add(this.spin);
    this.spin.add(weapon.root);
    // 模型的長軸是 +Y；躺下來變成鋒尖朝右，之後的 lean 才是「與水平的夾角」。
    this.lay.rotation.z = -Math.PI / 2;
    this.focus = this.centre;
  }

  get length(): number {
    return this.weapon.tip - this.weapon.butt;
  }

  get centre(): number {
    return (this.weapon.tip + this.weapon.butt) / 2;
  }

  pose(values: { x: number; y: number; z?: number; scale: number; yaw: number; lean: number; tilt: number; spin: number }): void {
    this.outer.position.set(values.x, values.y, values.z ?? 0);
    this.outer.scale.setScalar(values.scale);
    this.outer.rotation.y = values.yaw;
    this.lean.rotation.z = values.lean;
    this.tilt.rotation.y = -values.tilt;
    this.spin.rotation.y = values.spin;
    this.weapon.root.position.y = -this.focus;
  }

  /**
   * 出鞘程度：0 在鞘裡、1 鞘已退開。鞘先沿著刃滑出一小段，然後往下落出畫面（fall 是要落多遠，世界座標）。
   * 不讓它沿著刃一路退到底：那樣會橫過標題與課程牌。
   */
  setSheath(amount: number, fall: number): void {
    const sheath = this.weapon.sheath;
    if (!sheath) return;
    sheath.visible = amount < 0.999;
    if (!sheath.visible) return;
    const root = this.weapon.root;
    root.updateWorldMatrix(true, false);
    root.getWorldQuaternion(this.inverse).invert();
    const scale = this.outer.scale.x || 1;
    // 世界座標的「往下」換到兵器自己的座標。
    sheath.position
      .set(0, -fall * Math.pow(amount, 1.7), 0)
      .applyQuaternion(this.inverse)
      .divideScalar(scale);
    sheath.position.y += SHEATH_SLIDE * smoothstep(0, 0.35, amount);
  }

  /** 讓纓穗永遠朝下垂（不跟著兵器轉），並依掛點的橫向移動擺一下。 */
  hang(dtMs: number, lively: boolean): void {
    for (const pendulum of this.weapon.pendulums) {
      if (!pendulum.parent) continue;
      let state = this.swings.get(pendulum);
      if (!state) {
        state = { angle: 0, velocity: 0, lastX: null };
        this.swings.set(pendulum, state);
      }
      pendulum.parent.updateWorldMatrix(true, false);
      pendulum.parent.getWorldQuaternion(this.inverse).invert();
      if (lively && dtMs > 0) {
        const pivotX = pendulum.getWorldPosition(SCRATCH).x;
        const moved = state.lastX === null ? 0 : pivotX - state.lastX;
        state.lastX = pivotX;
        const dt = Math.min(dtMs, 48);
        // 掛點往右走，穗往左甩；阻尼彈簧拉回來。
        state.velocity += -moved * 0.9 - state.angle * 0.00009 * dt - state.velocity * 0.006 * dt;
        state.angle = Math.max(-0.9, Math.min(0.9, state.angle + state.velocity * dt * 0.06));
      } else {
        state.angle = 0;
        state.velocity = 0;
      }
      pendulum.quaternion.copy(this.inverse).multiply(SWING.setFromAxisAngle(Z_AXIS, state.angle));
    }
  }

  dispose(): void {
    this.weapon.dispose();
  }
}

/** 節點和它所有的上層都看得見。 */
function shown(node: Object3D | null): boolean {
  for (let current = node; current; current = current.parent) if (!current.visible) return false;
  return true;
}

export interface ViewerHandle {
  dispose(): void;
}

export interface ViewerDebug {
  /** 立刻畫一格並讀回像素：有畫到東西的比例、偏亮像素的比例。 */
  snapshot(): { width: number; height: number; covered: number; bright: number };
  /** 目前畫面上的兵器（含鞘與纓穗）在視窗裡佔的範圍（CSS px）。 */
  bounds(): { left: number; top: number; right: number; bottom: number };
  /** 固定兵器台的捲動進度（null 還原成跟著捲動）。 */
  setProgress(progress: number | null): void;
  /** 兵器台直接換成指定的兵器（沒有過場）。 */
  setKind(kind: string): void;
  /** 設定拖曳的角度。 */
  setAngle(angle: number): void;
  /** 固定 single 模式繞長軸的角度（null 還原成自己擺動）。 */
  setSpin(spin: number | null): void;
  /** 推進指定的毫秒數並畫一格（不靠 requestAnimationFrame）。 */
  advance(ms: number): void;
  /** 截圖特寫用：放大倍率與沿長軸的位移（公尺）。 */
  setView(zoom: number, shift: number): void;
}

export function mountViewer(host: HTMLElement, plan: RenderPlan): ViewerHandle {
  const mode: ViewerMode = host.dataset.weapon3d === 'stage' ? 'stage' : host.dataset.weapon3d === 'card' ? 'card' : 'single';
  const initialKind: WeaponKind = isKind(host.dataset.weaponKind) ? host.dataset.weaponKind : 'jian';
  const scope = host.closest<HTMLElement>('[data-weapon3d-scope]');
  const act = host.closest<HTMLElement>('[data-act]');

  const canvas = document.createElement('canvas');
  canvas.className = 'weapon3d__canvas';
  if (mode === 'card') {
    canvas.setAttribute('aria-hidden', 'true');
  } else {
    canvas.setAttribute('role', 'img');
    canvas.tabIndex = 0;
  }

  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(plan.pixelRatio);
  renderer.setClearColor(0x000000, 0);
  // Khronos PBR Neutral：亮部壓得住，又不像 ACES 會把朱紅洗成粉橘、把古金洗白。
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  // 課程卡是點綴：不開陰影，建立與每格都省一點。
  const shadows = plan.shadows && mode !== 'card';
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  const environment = createStudioEnvironment(renderer, 256);
  scene.environment = environment;

  const camera = new PerspectiveCamera(26, 1, 0.5, 30);
  camera.position.set(0, 0, CAMERA_DISTANCE);

  // 主光：跟著指標移動的一盞方向光，刃上的高光隨之流動。
  const key = new DirectionalLight(0xffffff, KEY_INTENSITY);
  key.position.set(-1.5, 2.5, 4);
  key.castShadow = shadows;
  if (shadows) {
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -2.2;
    key.shadow.camera.right = 2.2;
    key.shadow.camera.top = 2.2;
    key.shadow.camera.bottom = -2.2;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 14;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.004;
  }
  scene.add(key);
  // 攝影棚很暗（那是給鋼反射用的），木、繩、纓這些漫射面另外補一點環境光；金屬不吃這盞。
  scene.add(new AmbientLight(0xffffff, 0.75));

  const palette = readPalette();
  const materials: Materials = createMaterials(palette);
  // 淬火的火星（只有兵器台用得到）。
  const sparks = mode === 'stage' ? new Sparks(palette.tassel, palette.brass, plan.pixelRatio) : null;
  if (sparks) scene.add(sparks.points);

  const rigs = new Map<WeaponKind, Rig>();
  const rigOf = (kind: WeaponKind): Rig => {
    let rig = rigs.get(kind);
    if (!rig) {
      rig = new Rig(buildWeapon(kind, materials));
      rig.outer.visible = false;
      scene.add(rig.outer);
      rigs.set(kind, rig);
    }
    return rig;
  };

  // ── 狀態 ────────────────────────────────────────────────────────
  let width = 1;
  let height = 1;
  /** 鏡頭在原點處看得到的高度（公尺），隨畫布的長寬比調整。 */
  let VIEW_HEIGHT = MAX_VIEW_HEIGHT;
  /** 舞台範圍（世界座標，原點在畫布中心）：兵器要裝在這裡面。 */
  let region = { cx: 0, cy: 0, w: MAX_VIEW_HEIGHT, h: MAX_VIEW_HEIGHT };
  let spinState: SpinState = createSpin(0);
  // 兵器台第一次進場：兵器從尖端往柄「淬火成形」（和切換進場同一套）。減少動態時直接就在。
  let switchState: SwitchState =
    mode === 'stage' && plan.autoMotion ? { current: initialKind, next: null, phase: 'entering', t: 0 } : createSwitch(initialKind);
  let progress = plan.autoMotion ? 0 : STILL_PROGRESS;
  let forcedProgress: number | null = null;
  // 指標還沒動過之前，主光停在左上方的預設位置。
  let pointerX = -0.35;
  let pointerY = 0.4;
  let lightX = pointerX;
  let lightY = pointerY;
  let clock = 0;
  let frames = 0;
  let dirty = true;
  let visible = false;
  let raf = 0;
  let lastTime: number | null = null;
  let disposed = false;
  let debugZoom = 1;
  let debugShift = 0;
  let debugSpin: number | null = null;
  let glowUntil = 0;
  let glowDrawn = false;
  // 發光疊加的畫布放在宿主「旁邊」（宿主裡只有 3D 那一張畫布）。手機不開。
  const bloomOn = mode === 'stage' && plan.shadows && plan.autoMotion;
  const bloom = bloomOn ? document.createElement('canvas') : null;
  const bloomCtx = bloom?.getContext('2d') ?? null;
  if (bloom) {
    bloom.className = 'weapon3d__bloom';
    bloom.setAttribute('aria-hidden', 'true');
  }
  if (mode === 'stage') host.dataset.bloom = bloom && bloomCtx ? 'on' : 'off';

  const label = () => {
    if (mode === 'card') return;
    const kind = switchPresence(switchState).kind;
    canvas.setAttribute('aria-label', `${KIND_LABEL[kind]}的立體模型，可拖曳或用左右方向鍵轉動`);
  };

  // ── 捲動進度 ────────────────────────────────────────────────────
  const targetProgress = (): number => {
    if (forcedProgress !== null) return forcedProgress;
    if (!plan.autoMotion) return STILL_PROGRESS;
    if (!act) return STILL_PROGRESS;
    const pinned = act.dataset.pinProgress;
    if (pinned !== undefined && document.documentElement.dataset.acts === 'pinned') return clamp01(Number(pinned));
    const rect = act.getBoundingClientRect();
    return scrollProgress(viewportProgress({ top: rect.top, height: rect.height, viewportHeight: window.innerHeight }));
  };

  // ── 舞台範圍 ────────────────────────────────────────────────────
  const viewWidth = () => VIEW_HEIGHT * (width / height);

  /**
   * 量出畫布裡不壓到字的那一塊。兵器台：標題（.act__head）與課程牌（.act__courses）若和畫布上下有重疊，
   * 兵器只用它們左邊的空間；切換列若壓在畫布下半，兵器只用它上面的空間。其他模式用整張畫布。
   */
  const measureRegion = (): boolean => {
    const frame = host.getBoundingClientRect();
    if (frame.width < 1 || frame.height < 1) return false;
    let right = frame.width;
    let bottom = frame.height;
    if (mode === 'stage' && act) {
      const gap = Math.max(10, frame.width * 0.015);
      for (const selector of ['.act__head', '.act__courses']) {
        const rect = act.querySelector(selector)?.getBoundingClientRect();
        if (!rect || rect.width === 0) continue;
        if (rect.bottom <= frame.top + 1 || rect.top >= frame.bottom - 1) continue;
        if (rect.left - frame.left > frame.width * 0.3) right = Math.min(right, rect.left - frame.left - gap);
      }
      const bar = act.querySelector('[data-weapon3d-controls]')?.getBoundingClientRect();
      if (bar && bar.height > 0 && bar.top < frame.bottom - 1 && bar.top - frame.top > frame.height * 0.5) {
        bottom = Math.min(bottom, bar.top - frame.top - gap);
      }
    }
    const unit = VIEW_HEIGHT / frame.height;
    const next = {
      cx: (right / 2 - frame.width / 2) * unit,
      cy: (frame.height / 2 - bottom / 2) * unit,
      w: right * unit,
      h: bottom * unit,
    };
    const changed =
      Math.abs(next.cx - region.cx) + Math.abs(next.cy - region.cy) + Math.abs(next.w - region.w) + Math.abs(next.h - region.h) > 1e-4;
    region = next;
    return changed;
  };

  /** 一件有長度的兵器斜放在範圍裡：回傳倍率與中心位置。extra 是算大小時額外加的長度（鞘）。 */
  const fitInto = (rig: Rig, lean: number, extra = 0) => {
    const extent = rotatedExtent({ length: rig.length + extra, clearance: rig.weapon.clearance, lean });
    const drop = rig.weapon.drop;
    const scale = FIT * Math.min(region.w / extent.width, region.h / (extent.height + drop));
    // 穗垂在下面：整件往上讓半個穗長，上下才置中。
    return { scale, x: region.cx, y: region.cy + (drop * scale) / 2 };
  };

  // ── 擺姿勢 ──────────────────────────────────────────────────────
  const layoutStage = (dtMs: number) => {
    const { kind, presence } = switchPresence(switchState);
    const rig = rigOf(kind);
    for (const [other, otherRig] of rigs) otherRig.outer.visible = other === kind;

    const pose: StagePose = stagePose(kind, progress);
    const sheath = plan.autoMotion ? pose.sheath : 1;
    let scale: number;
    let x: number;
    let y: number;
    let lean: number;

    if (kind === 'spear') {
      // 大槍：槍尖停在範圍的右緣內側，桿子往左一路伸出畫面（橫貫）。捲動時由左外扎進來。
      rig.focus = rig.weapon.tip;
      lean = 0.1 + pose.lean;
      scale = Math.min(region.w / SPEAR_SHOWN, region.h / 0.75);
      x = region.cx + (region.w / 2) * FIT + pose.x * region.w;
      y = region.cy + region.h * 0.1;
    } else {
      // 劍、苗刀：沿著範圍的對角線斜放，隨捲動略略抬鋒。
      rig.focus = rig.centre;
      lean = restingLean(region.w, region.h) + (pose.lean - 0.4) * 0.35;
      const sheathed = rig.weapon.sheath ? (SHEATH_EXTRA + SHEATH_SLIDE) * (1 - smoothstep(0.82, 1, sheath)) : 0;
      ({ scale, x, y } = fitInto(rig, lean, sheathed));
    }

    // 切換：兵器留在原位。舊的沿噪聲邊界燃盡，新的從尖端往柄燒出來（淬火成形）。
    // 燒的時候兵器往鏡頭湊近一點（放大），當畫面的主角；燒完收回原本的大小。
    const forge = forgeFromSwitch(switchState);
    if (plan.autoMotion) scale *= forgeMagnify(switchState);
    void presence;

    const idle = plan.autoMotion ? Math.sin(clock * 0.0007) * 0.04 : 0;
    rig.pose({
      x,
      y,
      scale,
      yaw: spinState.angle + idle,
      lean,
      tilt: pose.tilt * 0.6,
      // 轉台轉的時候也帶一點自轉，光帶才會跟著流動。
      spin: pose.spin + spinState.angle * 0.6,
    });

    const uniforms = materials.forge;
    uniforms.uForge.value = forge.progress;
    uniforms.uForgeAxis.value = forge.axisWeight;
    uniforms.uForgeSpan.value.set(rig.weapon.tip, rig.weapon.butt);
    rig.weapon.root.updateWorldMatrix(true, false);
    uniforms.uForgeInverse.value.copy(rig.weapon.root.matrixWorld).invert();
    if (sparks) {
      if (forge.active && dtMs > 0 && forge.progress > 0.02 && forge.progress < 0.98) {
        // 火星從燃燒的邊界噴出來：進場時邊界沿長軸由尖端往柄走；燃盡時到處都在燒。
        const band = forgeBand(forge.progress, forge.axisWeight);
        const amount = plan.shadows ? 10 : 4;
        for (let n = 0; n < amount; n++) {
          const axis = band.from + ((clock * 0.6131 + n * 0.377) % 1) * (band.to - band.from);
          sparks.emit(rig.weapon.root, rig.weapon.tip - axis * (rig.weapon.tip - rig.weapon.butt), 1, scale);
        }
      }
      sparks.step(dtMs);
    }
    // 發光疊加：正在燒、或亮刃的那一段才開（之後多留一下讓光暈收掉）。
    if (forge.active || (plan.autoMotion && pose.flare > 0.05)) glowUntil = clock + 350;
    host.dataset.forge = forge.progress.toFixed(2);
    if (scope) scope.dataset.chapter = kind;
    rig.setSheath(sheath, VIEW_HEIGHT * 1.5);
    rig.hang(dtMs, plan.autoMotion);

    // 亮刃：不貼光斑，而是主光提亮、環境轉過一個角度（見 update）——一道光帶沿著刃掃過去。
    key.intensity = KEY_INTENSITY + (plan.autoMotion ? pose.flare : 0) * 0.6;

    host.dataset.weaponKind = kind;
    host.dataset.poseSpin = (pose.spin + spinState.angle * 0.6).toFixed(3);
    host.dataset.poseSheath = pose.sheath.toFixed(3);
  };

  const layoutSingle = (dtMs: number) => {
    const kind = initialKind;
    const rig = rigOf(kind);
    rig.outer.visible = true;
    const sway = plan.autoMotion ? Math.sin(clock * SWAY_RATE) * SWAY : 0;
    const spin = debugSpin ?? 0.25 + sway + spinState.angle;
    let scale: number;
    let x: number;
    let y: number;
    let lean: number;

    if (debugZoom !== 1) {
      // 截圖特寫：對準長軸上指定的位置放大。
      rig.focus = (kind === 'spear' ? rig.weapon.tip - 0.25 : rig.centre) + debugShift;
      lean = 0.12;
      scale = (region.w / (kind === 'spear' ? 1 : rig.length)) * debugZoom;
      x = 0;
      y = 0;
    } else if (kind === 'spear') {
      // 大槍：槍尖在右緣內側，桿子從左緣出去。扁的一列幾乎平放（桿才不會從下緣穿出去）。
      rig.focus = rig.weapon.tip;
      const flat = region.w / region.h > 2.5;
      lean = flat ? 0.012 : 0.34;
      scale = Math.min(region.w / (SPEAR_SHOWN + 0.1), region.h / (flat ? 0.5 : 0.95));
      x = (region.w / 2) * FIT;
      // 纓垂在下面：槍身往上讓，槍頭到纓尾上下置中。
      y = flat ? rig.weapon.drop * scale * 0.42 : region.h * 0.3;
    } else {
      rig.focus = rig.centre;
      // 很扁的一列（桌機）：幾乎平放，不然光是斜度就把高度吃光了。近方形的（手機）：沿對角線斜放。
      const flat = region.w / region.h > 2.5;
      lean = flat ? 0.05 : Math.min(0.85, restingLean(region.w, region.h));
      ({ scale, x, y } = fitInto(rig, lean));
    }

    rig.pose({ x, y, scale, yaw: 0, lean, tilt: 0.03, spin });
    rig.setSheath(1, 0);
    rig.hang(dtMs, plan.autoMotion);
    host.dataset.poseSpin = spin.toFixed(3);
  };

  const layoutCard = (dtMs: number) => {
    const jian = rigOf('jian');
    const miaodao = rigOf('miaodao');
    jian.outer.visible = true;
    miaodao.outer.visible = true;
    jian.focus = jian.centre;
    miaodao.focus = miaodao.centre;
    const viewW = viewWidth();
    const scale = (Math.hypot(viewW, VIEW_HEIGHT) * 0.9) / miaodao.length;
    const sway = plan.autoMotion ? Math.sin(clock * 0.0006) : 0;
    const turn = pointerX * 0.5;
    jian.pose({ x: viewW * 0.04, y: VIEW_HEIGHT * 0.05, z: 0.12, scale, yaw: turn * 0.5, lean: 0.5, tilt: 0.05, spin: 0.3 + sway * 0.4 + turn });
    miaodao.pose({
      x: -viewW * 0.02,
      y: VIEW_HEIGHT * 0.02,
      z: -0.12,
      scale,
      yaw: turn * 0.5,
      lean: Math.PI - 0.46,
      tilt: -0.05,
      spin: Math.PI - 0.3 - sway * 0.4 + turn,
    });
    jian.setSheath(1, 0);
    jian.hang(dtMs, plan.autoMotion);
    host.dataset.poseSpin = (0.3 + sway * 0.4 + turn).toFixed(3);
  };

  /** 目前看得見的兵器（含鞘與纓穗）投影到畫面上的範圍（CSS px，相對於視窗）。 */
  const screenBounds = () => {
    const frame = canvas.getBoundingClientRect();
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    scene.traverse((node) => {
      if (!(node instanceof Mesh) || !shown(node)) return;
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      BOX.copy(node.geometry.boundingBox!);
      for (let corner = 0; corner < 8; corner++) {
        SCRATCH.set(
          corner & 1 ? BOX.max.x : BOX.min.x,
          corner & 2 ? BOX.max.y : BOX.min.y,
          corner & 4 ? BOX.max.z : BOX.min.z,
        )
          .applyMatrix4(node.matrixWorld)
          .project(camera);
        const px = frame.left + ((SCRATCH.x + 1) / 2) * frame.width;
        const py = frame.top + ((1 - SCRATCH.y) / 2) * frame.height;
        left = Math.min(left, px);
        right = Math.max(right, px);
        top = Math.min(top, py);
        bottom = Math.max(bottom, py);
      }
    });
    return { left, top, right, bottom };
  };

  // ── 一格 ────────────────────────────────────────────────────────
  const update = (dtMs: number): boolean => {
    let changed = dirty;
    clock += dtMs;

    // 主光與環境慢慢跟上指標。
    // 「減少動態」時光直接到位，不拖著走。
    const follow = plan.autoMotion ? 1 - Math.exp(-dtMs / 140) : 1;
    if (Math.abs(pointerX - lightX) > 0.001 || Math.abs(pointerY - lightY) > 0.001) {
      lightX += (pointerX - lightX) * follow;
      lightY += (pointerY - lightY) * follow;
      changed = true;
    }
    if (mode === 'stage') {
      // 版面可能在動（字型載入、釘選的補白）：每隔一陣子重量一次舞台範圍。
      if (frames % 20 === 0 && measureRegion()) changed = true;
      const target = targetProgress();
      if (Math.abs(target - progress) > 0.0005) {
        progress = plan.autoMotion && forcedProgress === null ? progress + (target - progress) * (1 - Math.exp(-dtMs / 110)) : target;
        changed = true;
      }
      const nextSwitch = advanceSwitch(switchState, dtMs);
      if (nextSwitch !== switchState) {
        switchState = nextSwitch;
        changed = true;
        label();
      }
    }

    key.position.set(lightX * 4, 1.6 + lightY * 2.6, 4.2);
    // 環境跟著指標轉；兵器台演到亮刃那一段時再多轉一個角度，光帶就沿著刃掃過去。
    // （掃過去再回來：演完停住時，環境回到原位，刃大半是暗的、只留一道光帶。）
    const sweep = mode === 'stage' && plan.autoMotion ? smoothstep(0.68, 0.86, progress) * (1 - smoothstep(0.86, 1, progress)) : 0;
    scene.environmentRotation.set(lightY * 0.3, lightX * 0.7 + sweep * 0.5, sweep * 0.7);

    // 兵器台放手後緩緩回正；課程頁的單件停在使用者轉到的角度（只有慣性，不回正）。
    const spinOptions = plan.autoMotion && mode === 'stage' ? { home: 0 } : {};
    const nextSpin = stepSpin(spinState, dtMs, spinOptions);
    if (nextSpin !== spinState) {
      if (nextSpin.angle !== spinState.angle) changed = true;
      spinState = nextSpin;
    }

    if (sparks && sparks.alive > 0) changed = true;
    // 有自動動態（閒置的微晃、自轉）時每一格都要畫。
    if (plan.autoMotion) changed = true;
    if (!changed) return false;

    if (mode === 'stage') layoutStage(dtMs);
    else if (mode === 'single') layoutSingle(dtMs);
    else layoutCard(dtMs);
    return true;
  };

  // 發光疊加（選擇性 bloom 的替代做法）：把剛畫好的 3D 畫布縮小畫到一張 2D 畫布上，只留亮的部分
  //（壓暗再拉對比），CSS 再把它糊開、用濾色疊回去。不用 three 的後製（EffectComposer 的 bloom 會吃掉透明背景，
  // 也會讓 three 的 chunk 變大）。只在桌機的兵器台、而且正在淬火或亮刃時才畫。
  const drawGlow = () => {
    if (!bloom || !bloomCtx) return;
    const lit = clock < glowUntil;
    if (!lit && !glowDrawn) return;
    const w = Math.max(1, Math.round(width / 3));
    const h = Math.max(1, Math.round(height / 3));
    if (bloom.width !== w || bloom.height !== h) {
      bloom.width = w;
      bloom.height = h;
    }
    bloomCtx.clearRect(0, 0, w, h);
    glowDrawn = lit;
    if (!lit) return;
    bloomCtx.filter = 'brightness(0.8) contrast(2.6)';
    bloomCtx.drawImage(canvas, 0, 0, w, h);
    bloomCtx.filter = 'none';
  };

  const draw = () => {
    renderer.render(scene, camera);
    drawGlow();
    dirty = false;
    frames += 1;
    host.dataset.frames = String(frames);
    host.dataset.poseAngle = spinState.angle.toFixed(3);
  };

  const tick = (time: number) => {
    raf = 0;
    if (disposed || !visible) return;
    const dt = lastTime === null ? 16 : Math.min(100, Math.max(0, time - lastTime));
    lastTime = time;
    if (update(dt)) draw();
    raf = requestAnimationFrame(tick);
  };

  const start = () => {
    if (raf || disposed || !visible) return;
    lastTime = null;
    raf = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  // ── 尺寸 ────────────────────────────────────────────────────────
  const resize = () => {
    const rect = host.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));
    if (nextWidth === width && nextHeight === height) return;
    width = nextWidth;
    height = nextHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    VIEW_HEIGHT = Math.min(MAX_VIEW_HEIGHT, MAX_VIEW_WIDTH / camera.aspect);
    camera.fov = (Math.atan(VIEW_HEIGHT / 2 / CAMERA_DISTANCE) * 360) / Math.PI;
    camera.updateProjectionMatrix();
    measureRegion();
    dirty = true;
  };

  // ── 可見性：離開畫面或分頁在背景就停 ────────────────────────────
  let onScreen = false;
  const refreshVisibility = () => {
    const next = onScreen && document.visibilityState === 'visible';
    if (next === visible) return;
    visible = next;
    host.dataset.weapon3dActive = String(visible);
    if (visible) start();
    else stop();
  };
  const intersection = new IntersectionObserver(
    (entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      refreshVisibility();
    },
    { rootMargin: '60px 0px' },
  );
  intersection.observe(host);
  const onVisibilityChange = () => refreshVisibility();
  document.addEventListener('visibilitychange', onVisibilityChange);

  const resizeObserver = new ResizeObserver(() => {
    resize();
    if (visible && !raf) start();
  });
  resizeObserver.observe(host);

  // ── 指標：光跟著走 ──────────────────────────────────────────────
  const onPointerMove = (event: PointerEvent) => {
    if (!visible) return;
    const rect = host.getBoundingClientRect();
    pointerX = Math.max(-1.4, Math.min(1.4, ((event.clientX - rect.left) / rect.width) * 2 - 1));
    pointerY = Math.max(-1.4, Math.min(1.4, 1 - ((event.clientY - rect.top) / rect.height) * 2));
    dirty = true;
    if (!raf) start();
  };
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  // ── 拖曳 ────────────────────────────────────────────────────────
  let dragPointer: number | null = null;
  let dragX = 0;
  let dragTime = 0;
  const onPointerDown = (event: PointerEvent) => {
    if (mode === 'card' || (event.pointerType === 'mouse' && event.button !== 0)) return;
    dragPointer = event.pointerId;
    dragX = event.clientX;
    dragTime = performance.now();
    spinState = grabSpin(spinState);
    canvas.setPointerCapture?.(event.pointerId);
    host.dataset.dragging = 'true';
  };
  const onDragMove = (event: PointerEvent) => {
    if (event.pointerId !== dragPointer) return;
    const now = performance.now();
    spinState = dragSpin(spinState, event.clientX - dragX, now - dragTime);
    dragX = event.clientX;
    dragTime = now;
    dirty = true;
    if (!raf) start();
  };
  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== dragPointer) return;
    dragPointer = null;
    // 放手前停了一下（最後一次移動已是很久以前）就不帶慣性。
    const paused = performance.now() - dragTime > 90;
    spinState = releaseSpin(spinState, { keepMomentum: plan.autoMotion && !paused });
    delete host.dataset.dragging;
    dirty = true;
    if (!raf) start();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    spinState = { ...spinState, angle: spinState.angle + (event.key === 'ArrowRight' ? 0.3 : -0.3), velocity: 0 };
    dirty = true;
    if (!raf) start();
  };
  if (mode !== 'card') {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onDragMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('keydown', onKeyDown);
  }

  // ── 切換（兵器台） ──────────────────────────────────────────────
  const picks = scope ? Array.from(scope.querySelectorAll<HTMLButtonElement>('[data-weapon-pick]')) : [];
  const markPicked = (kind: WeaponKind) => {
    for (const pick of picks) pick.setAttribute('aria-pressed', String(pick.dataset.weaponPick === kind));
  };
  const onPick = (event: Event) => {
    const kind = (event.currentTarget as HTMLElement).dataset.weaponPick;
    if (!isKind(kind)) return;
    rigOf(kind);
    switchState = requestSwitch(switchState, kind, { instant: !plan.autoMotion });
    markPicked(kind);
    label();
    dirty = true;
    if (!raf) start();
  };
  if (mode === 'stage') {
    for (const pick of picks) pick.addEventListener('click', onPick);
    markPicked(initialKind);
  }

  // ── WebGL context 掉了：退回線稿 ────────────────────────────────
  const setState = (state: 'ready' | 'fallback') => {
    host.dataset.weapon3dState = state;
    scope?.setAttribute('data-weapon3d-state', state);
  };
  const onContextLost = (event: Event) => {
    event.preventDefault();
    stop();
    canvas.remove();
    setState('fallback');
  };
  canvas.addEventListener('webglcontextlost', onContextLost);

  // ── 上場 ────────────────────────────────────────────────────────
  host.append(canvas);
  if (bloom) host.after(bloom);
  resize();
  label();
  if (mode === 'stage') {
    progress = targetProgress();
  }
  update(0);
  draw();
  setState('ready');

  const debug: ViewerDebug = {
    snapshot() {
      // 量的是成形之後的樣子：還在淬火就先走完。
      if (switchState.phase !== 'idle') switchState = advanceSwitch(switchState, 60_000);
      update(0);
      if (mode === 'stage') layoutStage(0);
      else if (mode === 'single') layoutSingle(0);
      else layoutCard(0);
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let covered = 0;
      let bright = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3]! > 24) {
          covered += 1;
          if (Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > 150) bright += 1;
        }
      }
      const total = w * h;
      return { width: w, height: h, covered: covered / total, bright: bright / total };
    },
    bounds() {
      if (switchState.phase !== 'idle') switchState = advanceSwitch(switchState, 60_000);
      update(0);
      if (mode === 'stage') layoutStage(0);
      else if (mode === 'single') layoutSingle(0);
      else layoutCard(0);
      return screenBounds();
    },
    setKind(kind) {
      if (!isKind(kind)) return;
      rigOf(kind);
      switchState = createSwitch(kind);
      markPicked(kind);
      label();
      dirty = true;
      update(0);
      draw();
    },
    setSpin(value) {
      debugSpin = value;
      dirty = true;
      update(0);
      draw();
    },
    setProgress(value) {
      measureRegion();
      forcedProgress = value;
      if (value !== null) progress = clamp01(value);
      dirty = true;
      update(0);
      draw();
    },
    setAngle(angle) {
      spinState = { angle, velocity: 0, dragging: false };
      dirty = true;
      const auto = plan.autoMotion;
      // 除錯時不要回正。
      if (auto) spinState = grabSpin(spinState);
      update(0);
      draw();
    },
    advance(ms) {
      dirty = true;
      update(ms);
      draw();
    },
    setView(zoom, shift) {
      debugZoom = zoom;
      debugShift = shift;
      dirty = true;
      update(0);
      draw();
    },
  };
  // 除錯介面只在開發模式、或測試明確要求時（window.__LIUYI_TEST__）才掛到宿主元素上；正式站不掛。
  if (import.meta.env.DEV || (window as Window & { __LIUYI_TEST__?: boolean }).__LIUYI_TEST__ === true) {
    (host as HTMLElement & { weaponDebug?: ViewerDebug }).weaponDebug = debug;
  }

  return {
    dispose() {
      disposed = true;
      stop();
      intersection.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pointermove', onPointerMove);
      for (const pick of picks) pick.removeEventListener('click', onPick);
      for (const rig of rigs.values()) rig.dispose();
      materials.dispose();
      sparks?.dispose();
      bloom?.remove();
      environment.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
