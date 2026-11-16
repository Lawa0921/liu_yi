/**
 * 捲動模型（D17，純函式）：由 DOM `[data-beat]` 的位置與捲動量算出「目前是哪個 beat、有多散」。
 *
 *   - 焦點 = `scrollY + viewportH / 2`（視窗正中央在頁面上的位置）。
 *   - 相鄰兩個 beat 的邊界 = 前一個的底與後一個的頂的中點（版面連續時就是後一個的頂）。
 *   - 邊界兩側各 `BAND · viewportH / 2` 是轉場帶（總寬 `BAND` 個視窗高，所以聚合停留 ≥ 0.55）。
 *     焦點在帶內：`u` 由 0 走到 1，`scatter = sin(π·u)`（邊界上最散）；`mix = u`。
 *     目標在邊界（u = 0.5）切換：焦點 ≥ 邊界時 `index` 是後一個，否則是前一個。
 *   - 焦點在所有帶之外：`settled`、`scatter = 0`、`from = to = index`。
 *
 * 高度 ≤ 0（或非有限值）的 beat 先濾掉，例如某對象沒有課程所以整段在 hidden 面板裡（RF4）。
 * 回傳的 `index`／`from`／`to` 是 **傳入 `beats` 陣列的原始索引**，永遠指向有高度的 beat，
 * 所以呼叫端用 `beats[state.index].id` 查姿勢，不需要自己再濾一次。
 * 沒有任何有高度的 beat 時回 `{ index: 0, settled: true, scatter: 0 }`（此時 `beats[0]` 可能不存在，呼叫端要先檢查）。
 */

import type { BeatId } from '../config/poses';

export interface BeatRect {
  id: BeatId;
  /** 在頁面座標（相對文件頂端）的上緣。 */
  top: number;
  height: number;
}

export interface ScrollState {
  /** 目前的 beat（原陣列索引）；轉場帶內以邊界為界切換。 */
  index: number;
  from: number;
  to: number;
  /** 轉場帶內的進度 0–1；已定時為 0。 */
  mix: number;
  /** 散開量 0–1：`sin(π·u)`。 */
  scatter: number;
  /** 焦點在轉場帶之外。 */
  settled: boolean;
}

/** 轉場帶的總寬（以視窗高為單位）。 */
export const BAND = 0.45;

const EMPTY: Readonly<ScrollState> = { index: 0, from: 0, to: 0, mix: 0, scatter: 0, settled: true };

const settledAt = (index: number): ScrollState => ({ index, from: index, to: index, mix: 0, scatter: 0, settled: true });

export function scrollState(beats: readonly BeatRect[], scrollY: number, viewportH: number): ScrollState {
  // 有高度的 beat 的原始索引
  const live: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    if (beats[i]!.height > 0) live.push(i);
  }
  if (live.length === 0) return { ...EMPTY };

  const vh = Number.isFinite(viewportH) && viewportH > 0 ? viewportH : 0;
  const y = Number.isFinite(scrollY) ? scrollY : 0;
  const focus = y + vh / 2;
  const half = (BAND * vh) / 2;

  // 已經過幾道邊界（決定已定時的 index），以及帶內最近的那一道
  let passed = 0;
  let nearest = -1;
  let nearestBoundary = 0;
  let nearestDist = Infinity;
  for (let k = 0; k < live.length - 1; k++) {
    const a = beats[live[k]!]!;
    const b = beats[live[k + 1]!]!;
    const boundary = (a.top + a.height + b.top) / 2;
    if (focus >= boundary) passed = k + 1;
    const dist = Math.abs(focus - boundary);
    if (dist < half && dist < nearestDist) {
      nearest = k;
      nearestBoundary = boundary;
      nearestDist = dist;
    }
  }

  if (nearest < 0) return settledAt(live[passed]!);

  const u = (focus - (nearestBoundary - half)) / (2 * half);
  const from = live[nearest]!;
  const to = live[nearest + 1]!;
  return {
    index: focus >= nearestBoundary ? to : from,
    from,
    to,
    mix: u,
    scatter: Math.sin(Math.PI * u),
    settled: false,
  };
}
