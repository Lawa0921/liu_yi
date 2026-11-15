// 兵器台：捲動進度（0–1）→ 兵器姿勢。純函式，不碰 DOM 與 three（設計文件 §15.2-1）。
//
// 姿勢的座標是「畫面上的」而不是世界座標，由 src/scripts/three/viewer.ts 換算：
//   spin   繞兵器自身長軸轉（弧度）：0 是刃面正對鏡頭，轉身就是它在動。
//   tilt   長軸朝鏡頭前後傾（弧度）：正值是鋒尖朝向觀者。
//   lean   長軸與水平的夾角（弧度）：0 是橫放、鋒尖朝右；正值是鋒尖抬高。
//   x, y   相對於定位點的位移，單位是「舞台範圍的寬／高」：0 是就定位，絕對值超過 1 就在畫面外。
//          （劍與苗刀由 viewer 置中在舞台範圍裡，不吃這個位移；大槍用 x 由左外扎進來。）
//   sheath 出鞘程度：0 劍在鞘裡，1 鞘已完全退開（沒有鞘的兵器固定是 1）。
//   flare  亮刃的強度（0–1）：主光提亮、環境轉過一個角度，讓一道光帶沿刃掃過（不貼光斑）。

export type WeaponKind = 'jian' | 'miaodao' | 'spear';

export const STAGE_KINDS: readonly WeaponKind[] = ['jian', 'miaodao', 'spear'];

export interface StagePose {
  spin: number;
  tilt: number;
  lean: number;
  x: number;
  y: number;
  sheath: number;
  flare: number;
}

export function clamp01(value: number): number {
  if (!(value > 0)) return 0; // 也接住 NaN
  return value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** a→b 之間平滑地由 0 升到 1（兩端斜率為 0）。 */
export function smoothstep(a: number, b: number, value: number): number {
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** 亮刃：0.72 起、0.86 最亮、結尾收掉。 */
function flareAt(p: number): number {
  return smoothstep(0.72, 0.86, p) * (1 - smoothstep(0.9, 1, p) * 0.9);
}

const POSES: Record<WeaponKind, (p: number) => StagePose> = {
  // 劍：斜靠著在鞘裡 → 出鞘（鞘往鋒尖方向退開）→ 轉身一圈半 → 抬鋒亮刃。
  jian: (p) => ({
    spin: lerp(0.45, 0.45 + Math.PI, smoothstep(0.38, 0.76, p)) - smoothstep(0.76, 1, p) * 0.3,
    tilt: lerp(-0.1, 0.16, smoothstep(0.3, 0.9, p)),
    lean: lerp(0.2, 0.5, smoothstep(0, 0.9, p)),
    x: lerp(0.06, 0, smoothstep(0, 0.5, p)),
    y: lerp(-0.1, 0.04, smoothstep(0, 0.6, p)),
    sheath: smoothstep(0.02, 0.38, p),
    flare: flareAt(p),
  }),
  // 苗刀：刃口朝下斜持 → 翻腕轉身 → 立刀亮刃。
  miaodao: (p) => ({
    spin: lerp(-0.4, -0.4 + Math.PI, smoothstep(0.2, 0.72, p)) + smoothstep(0.72, 1, p) * 0.3,
    tilt: lerp(0.12, -0.08, smoothstep(0.1, 0.9, p)),
    lean: lerp(0.12, 0.62, smoothstep(0.05, 0.92, p)),
    x: lerp(0.1, 0, smoothstep(0, 0.5, p)),
    y: lerp(-0.06, 0.02, smoothstep(0, 0.7, p)),
    sheath: 1,
    flare: flareAt(p),
  }),
  // 大槍：從畫面左外一路扎進來橫貫全幅，槍頭轉半圈，最後停在畫面內。
  spear: (p) => ({
    spin: lerp(0, Math.PI, smoothstep(0.25, 0.8, p)),
    tilt: lerp(0.1, 0, smoothstep(0, 0.7, p)),
    lean: lerp(0.02, 0.07, smoothstep(0, 1, p)),
    x: lerp(-1.6, 0, smoothstep(0, 0.7, p)),
    y: lerp(0.04, 0, smoothstep(0, 1, p)),
    sheath: 1,
    flare: flareAt(p),
  }),
};

export function stagePose(kind: WeaponKind, progress: number): StagePose {
  return POSES[kind](clamp01(progress));
}

/**
 * 不釘選時，把「幕在視窗裡走到哪」（viewportProgress）換成兵器台的進度：
 * 幕從視窗下緣捲進來的那一段就把出鞘、轉身、亮刃演完，等兵器台到了視窗中段，兵器已經停在最後的姿勢。
 * （手機上一幕比視窗還高，兵器台在幕的上半部，所以要早一點演完。）
 */
export function scrollProgress(viewport: number): number {
  return clamp01((viewport - 0.1) / 0.32);
}

/**
 * 不釘選（手機、減少動態）時的進度：區塊頂端到達視窗底部是 0，區塊底端離開視窗頂端是 1。
 */
export function viewportProgress(rect: { top: number; height: number; viewportHeight: number }): number {
  const travel = rect.height + rect.viewportHeight;
  if (!(travel > 0)) return 0;
  return clamp01((rect.viewportHeight - rect.top) / travel);
}
