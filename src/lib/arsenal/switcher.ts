// 兵器台的切換狀態：舊兵器收走（leaving）→ 新兵器入場（entering）→ 停住（idle）。純函式。

import type { WeaponKind } from './pose';

export const LEAVE_MS = 380;
export const ENTER_MS = 760;

export interface SwitchState {
  /** 目前畫面上那一件。 */
  current: WeaponKind;
  /** 收走之後要換上的那一件；沒有在切換時是 null。 */
  next: WeaponKind | null;
  phase: 'idle' | 'leaving' | 'entering';
  /** 目前這一段走了多少（0–1）。 */
  t: number;
}

export function createSwitch(kind: WeaponKind): SwitchState {
  return { current: kind, next: null, phase: 'idle', t: 0 };
}

/** 目前該畫哪一件、露出多少（0 完全收走，1 完全在場）。 */
export function switchPresence(state: SwitchState): { kind: WeaponKind; presence: number } {
  if (state.phase === 'leaving') return { kind: state.current, presence: 1 - state.t };
  if (state.phase === 'entering') return { kind: state.current, presence: state.t };
  return { kind: state.current, presence: 1 };
}

export function requestSwitch(state: SwitchState, kind: WeaponKind, options: { instant?: boolean } = {}): SwitchState {
  if (options.instant) {
    return state.phase === 'idle' && state.current === kind ? state : createSwitch(kind);
  }
  const { presence } = switchPresence(state);
  if (kind === state.current) {
    // 已經是它：閒置或正在入場就不動；正在收走就原地折返。
    if (state.phase !== 'leaving') return state;
    return { current: kind, next: null, phase: 'entering', t: presence };
  }
  if (state.phase === 'leaving') return { ...state, next: kind };
  return { current: state.current, next: kind, phase: 'leaving', t: 1 - presence };
}

export function advanceSwitch(state: SwitchState, dtMs: number): SwitchState {
  let current = state;
  let remaining = Math.max(0, dtMs);
  while (current.phase !== 'idle') {
    const duration = current.phase === 'leaving' ? LEAVE_MS : ENTER_MS;
    const needed = (1 - current.t) * duration;
    if (remaining < needed) return { ...current, t: current.t + remaining / duration };
    remaining -= needed;
    current =
      current.phase === 'leaving'
        ? { current: current.next ?? current.current, next: null, phase: 'entering', t: 0 }
        : createSwitch(current.current);
  }
  return current;
}
