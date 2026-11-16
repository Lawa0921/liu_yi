// 淬火成形：兵器台切換時，舊兵器沿噪聲邊界燃盡、新兵器從尖端往柄燒出來。
// 這裡把切換狀態換成著色器用的溶解進度；門檻的算式和 src/scripts/three/forge.ts 裡的 GLSL 一致。純函式。

import type { SwitchState } from './switcher';

export interface ForgeState {
  /** 溶解進度：0 完全不見，1 完全成形。門檻低於進度的地方才畫。 */
  progress: number;
  /** 門檻裡「沿長軸位置」佔的比重：高＝從尖端一路燒到柄；低＝沿噪聲邊界到處燒。 */
  axisWeight: number;
  /** 正在燒（要畫邊緣的火光、要噴火星）。 */
  active: boolean;
}

const LEAVE_AXIS = 0.25;
const ENTER_AXIS = 0.85;

export function forgeFromSwitch(state: SwitchState): ForgeState {
  if (state.phase === 'leaving') return { progress: 1 - state.t, axisWeight: LEAVE_AXIS, active: true };
  if (state.phase === 'entering') {
    // 先快後慢：尖端一下就亮出來，燒到柄慢慢收。
    const eased = 1 - Math.pow(1 - state.t, 2);
    return { progress: eased, axisWeight: ENTER_AXIS, active: true };
  }
  return { progress: 1, axisWeight: ENTER_AXIS, active: false };
}

/**
 * 某一點的門檻（0–1 之間，不含兩端）：axis 是沿長軸的位置（0 尖端、1 柄尾），noise 是該點的噪聲（0–1）。
 * 進度 0 時沒有任何一點低於門檻（全部不見），進度 1 時全部低於（全部成形）。
 */
export function forgeThreshold(axis: number, noise: number, axisWeight: number): number {
  return 0.02 + 0.96 * (axis * axisWeight + noise * (1 - axisWeight));
}

/**
 * 正在燒的那一段落在長軸的哪裡（0 尖端 – 1 柄尾）：門檻剛好等於進度的地方。火星就從這一段噴出來。
 * 成形時（沿長軸）是很窄的一段；燃盡時（沿噪聲）幾乎整件都在燒。
 */
export function forgeBand(progress: number, axisWeight: number): { from: number; to: number } {
  const level = (Math.max(0, Math.min(1, progress)) - 0.02) / 0.96;
  const weight = Math.max(0.05, axisWeight);
  const from = Math.max(0, Math.min(1, (level - (1 - weight)) / weight));
  const to = Math.max(0, Math.min(1, level / weight));
  return to > from ? { from, to } : { from: Math.max(0, to - 0.02), to: Math.min(1, Math.max(to, 0.02)) };
}

/** 淬火時兵器放大到多少（往鏡頭湊近，當主角）。 */
export const FORGE_PEAK = 1.2;

const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

/**
 * 淬火時兵器的放大倍率：舊兵器開始燒就慢慢湊近、新兵器燒出來的大半段維持放大，最後一段收回原本大小。
 * 平常（idle）是 1。過程連續，不會跳。
 */
export function forgeMagnify(state: SwitchState): number {
  if (state.phase === 'leaving') return 1 + (FORGE_PEAK - 1) * smooth(state.t / 0.5);
  if (state.phase === 'entering') return 1 + (FORGE_PEAK - 1) * (1 - smooth((state.t - 0.6) / 0.4));
  return 1;
}
