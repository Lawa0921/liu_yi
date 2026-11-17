/**
 * 光點從飄散聚成形體的程序（Task 26，純函式，不碰 three／DOM）：404 與場地的院門「慢慢聚成」。
 *
 *   - 引擎的散開量（`setScatter`，0–1）決定彈簧鬆多少（`forces.ts`）。這裡算每一格該餵多少：
 *     `time`＝載入後依經過的時間慢慢降；`scroll`＝依捲動位置降（往下捲才聚齊）；`none`＝一開始就聚好。
 *   - 不從全散開（1）開始降：彈簧太弱，形體一時聚不起來；起點 `GATHER_START_SCATTER`。
 */

import type { PageKind } from '../config/pages';

/** 404 與場地（窄螢幕）的光點從飄散聚成形體要多久（秒）。 */
export const GATHER_SECONDS = 5;
/** 聚合開始時的散開量（0–1），慢慢降到 0。 */
export const GATHER_START_SCATTER = 0.85;
/** 場地（寬螢幕）：往下捲多少個視窗高，院門聚齊。 */
export const GATHER_SCROLL_VIEWPORTS = 0.6;
/** 聚合的程序：time＝載入後慢慢聚；scroll＝依捲動位置聚；none＝一開始就是形體。 */
export type GatherMode = 'none' | 'time' | 'scroll';

/** smoothstep：起步與收尾都慢，中間走得最快（聚合要「慢慢」開始、輕輕定住）。 */
const ease = (u: number): number => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};

/** 載入後（聚合開始後）經過 `elapsed` 秒，散開量是多少：`GATHER_START_SCATTER` 起、起步與收尾都慢地降到 0。 */
export function gatherByTime(elapsed: number): number {
  return GATHER_START_SCATTER * (1 - ease(elapsed / GATHER_SECONDS));
}

/**
 * 捲動 `scrollY`（視窗高 `vh`、最多能捲 `max`）時的散開量：頁首最散（`GATHER_START_SCATTER`，不是全散：頁首仍隱約看得出形體），
 * 捲過 `GATHER_SCROLL_VIEWPORTS` 個視窗高（或最大捲動量的九成）聚齊（0）；頁面捲不動時直接聚好。
 */
export function gatherByScroll(scrollY: number, vh: number, max: number): number {
  if (!(max > 40) || !(vh > 0)) return 0;
  const distance = Math.min(max * 0.9, GATHER_SCROLL_VIEWPORTS * vh);
  const y = Number.isFinite(scrollY) ? scrollY : 0;
  return GATHER_START_SCATTER * Math.min(1, Math.max(0, 1 - y / distance));
}

/** 場地（院門）：寬螢幕依捲動聚，窄螢幕（頁首的一條會捲走）依時間聚；404 依時間聚；其餘一開始就是形體。 */
export function gatherModeOf(kind: PageKind, wide: boolean): GatherMode {
  if (kind === 'lost') return 'time';
  if (kind === 'facility') return wide ? 'scroll' : 'time';
  return 'none';
}
