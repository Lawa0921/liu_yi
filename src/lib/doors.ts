// 「大人｜小孩」切換的門扇開合（純邏輯）：兩扇窗櫺門從左右合攏蓋住課程卡 → 門後換組 → 門向內打開。
// 可以連點：合上途中改主意就繼續合、目標換成最後一次點的；打開途中又要換，從目前的開度反向合上。
// 任何時刻只顯示一組（shown）。DOM 接線在 src/scripts/audience-doors.ts。

import type { Audience } from './courses';

export const DOOR = {
  /** 合攏（帶一點加速，合上那一下有重量）。 */
  closeMs: 320,
  /** 打開（新的一組卡片同時由深處飛出）。 */
  openMs: 560,
} as const;

export type DoorPhase = 'idle' | 'closing' | 'opening';

export interface DoorState {
  phase: DoorPhase;
  /** 門後目前顯示的那一組。 */
  shown: Audience;
  /** 要換成哪一組。 */
  target: Audience;
  /** 這一段已經走了多久（ms）。 */
  t: number;
}

export function createDoor(shown: Audience): DoorState {
  return { phase: 'idle', shown, target: shown, t: 0 };
}

/** 門開了多少：0 全合、1 全開。 */
export function doorOpenness(state: DoorState): number {
  if (state.phase === 'closing') return Math.max(0, 1 - state.t / DOOR.closeMs);
  if (state.phase === 'opening') return Math.min(1, state.t / DOOR.openMs);
  return 1;
}

export function requestDoor(state: DoorState, target: Audience, options: { instant?: boolean } = {}): DoorState {
  if (options.instant) return createDoor(target);
  if (state.phase === 'idle') return target === state.shown ? state : { phase: 'closing', shown: state.shown, target, t: 0 };
  if (state.phase === 'closing') return { ...state, target };
  // 打開途中：要的就是門後這組，繼續開；否則從目前的開度反向合上。
  if (target === state.shown) return { ...state, target };
  return { phase: 'closing', shown: state.shown, target, t: DOOR.closeMs * (1 - doorOpenness(state)) };
}

export function advanceDoor(state: DoorState, dtMs: number): DoorState {
  if (state.phase === 'idle' || !(dtMs > 0)) return state;
  const t = state.t + dtMs;
  if (state.phase === 'closing') {
    if (t < DOOR.closeMs) return { ...state, t };
    // 合上了：門後換組，接著打開（多出來的時間算進打開）。
    return advanceDoor({ phase: 'opening', shown: state.target, target: state.target, t: 0 }, t - DOOR.closeMs);
  }
  if (t < DOOR.openMs) return { ...state, t };
  return createDoor(state.shown);
}
