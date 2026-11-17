/**
 * 開場時間軸（D18，純函式）。時間 `t` 是從「靜態圖交接完成」起算的秒數。
 *
 *   handoff 0–0.6   接續靜態圖的聚合態（`land`），彈簧全開
 *   exhale  0.6–1.0 散開（彈簧 0.1）
 *   inhale  1.0–2.0 往中心吸氣，聚成 `lift`（彈簧 0.1 → 1）
 *   hold    2.0–2.7 抬腳停一拍（目標仍是 `lift`）
 *   land    2.7–3.4 落地於 2.7 觸發（目標改回 `land`），衝擊波
 *   done    ≥ 3.4
 *
 * 地面光點（`groundLevel`）恆為 1：交接的靜態圖終態已經有地面，不重播地面浮現。
 */

export type IntroPhase = 'handoff' | 'exhale' | 'inhale' | 'hold' | 'land' | 'done';

export interface IntroState {
  phase: IntroPhase;
  /** 彈簧倍率：乘在 `SPRING` 上（見 `forcesFor` 的 `intro.springScale`）。 */
  springScale: number;
  groundLevel: number;
  /** 這一刻的目標姿勢。 */
  target: 'land' | 'lift';
  /** 吸氣流線的強度：僅在 inhale 階段由 0 升到 1，其餘為 0。 */
  inhale: number;
}

const EXHALE_AT = 0.6;
/** 吸氣開始的時間（秒）。從氣流（入館閘門的背景）起演時直接從這裡起算：不接續 land、不散開（`playIntro({ fromAmbient })`）。 */
export const INHALE_AT = 1.0;
const HOLD_AT = 2.0;
const LAND_AT = 2.7;
const DONE_AT = 3.4;

const smoothstep = (a: number, b: number, x: number): number => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

export function introState(t: number): IntroState {
  const target = t >= INHALE_AT && t < LAND_AT ? 'lift' : 'land';
  if (t < EXHALE_AT) return { phase: 'handoff', springScale: 1, groundLevel: 1, target, inhale: 0 };
  if (t < INHALE_AT) return { phase: 'exhale', springScale: 0.1, groundLevel: 1, target, inhale: 0 };
  if (t < HOLD_AT) {
    return {
      phase: 'inhale',
      springScale: 0.1 + 0.9 * smoothstep(INHALE_AT, HOLD_AT, t),
      groundLevel: 1,
      target,
      inhale: (t - INHALE_AT) / (HOLD_AT - INHALE_AT),
    };
  }
  const phase: IntroPhase = t < LAND_AT ? 'hold' : t < DONE_AT ? 'land' : 'done';
  return { phase, springScale: 1, groundLevel: 1, target, inhale: 0 };
}

/**
 * 「還停在頁首」的尺：捲動量不超過這個比例的視窗高。`shouldPlayIntro` 用它決定要不要演；
 * 首頁腳本在開場播放中捲過它就立刻收尾（RF2），兩邊必須是同一把尺，所以匯出共用。
 */
export const INTRO_MAX_SCROLL = 0.25;

/**
 * 要不要演開場：每個工作階段第一次進站、沒有偏好減少動態、而且還停在頁首附近
 * （帶 `#hash` 進站或重新整理後還原了捲動位置，就不演）。
 */
export function shouldPlayIntro(env: {
  reducedMotion: boolean;
  seen: boolean;
  scrollY: number;
  viewportH: number;
}): boolean {
  return !env.reducedMotion && !env.seen && env.scrollY <= INTRO_MAX_SCROLL * env.viewportH;
}
