import { describe, expect, it } from 'vitest';
import {
  ENTER_MS,
  LEAVE_MS,
  advanceSwitch,
  createSwitch,
  requestSwitch,
  switchPresence,
} from '../../src/lib/arsenal/switcher';

describe('兵器切換狀態', () => {
  it('一開始停在指定的兵器上，完全在場', () => {
    const state = createSwitch('jian');
    expect(state).toMatchObject({ current: 'jian', next: null, phase: 'idle' });
    expect(switchPresence(state)).toEqual({ kind: 'jian', presence: 1 });
  });

  it('選同一件不會重播', () => {
    const state = createSwitch('jian');
    expect(requestSwitch(state, 'jian')).toBe(state);
  });

  it('選另一件：舊的先收走，再換新的入場，最後停住', () => {
    let state = requestSwitch(createSwitch('jian'), 'spear');
    expect(state).toMatchObject({ current: 'jian', next: 'spear', phase: 'leaving' });

    state = advanceSwitch(state, LEAVE_MS / 2);
    expect(switchPresence(state).kind).toBe('jian');
    expect(switchPresence(state).presence).toBeGreaterThan(0);
    expect(switchPresence(state).presence).toBeLessThan(1);

    state = advanceSwitch(state, LEAVE_MS / 2);
    expect(state).toMatchObject({ current: 'spear', next: null, phase: 'entering' });
    expect(switchPresence(state)).toEqual({ kind: 'spear', presence: 0 });

    state = advanceSwitch(state, ENTER_MS / 2);
    expect(switchPresence(state).presence).toBeGreaterThan(0);
    expect(switchPresence(state).presence).toBeLessThan(1);

    state = advanceSwitch(state, ENTER_MS);
    expect(state).toMatchObject({ current: 'spear', next: null, phase: 'idle' });
    expect(switchPresence(state)).toEqual({ kind: 'spear', presence: 1 });
  });

  it('一次跨很長的時間也會走完整個切換，不會卡在半路', () => {
    const state = advanceSwitch(requestSwitch(createSwitch('jian'), 'miaodao'), 60_000);
    expect(state).toMatchObject({ current: 'miaodao', phase: 'idle' });
  });

  it('收走途中改選：直接換目標，不重頭收', () => {
    let state = advanceSwitch(requestSwitch(createSwitch('jian'), 'spear'), LEAVE_MS / 2);
    const before = switchPresence(state).presence;
    state = requestSwitch(state, 'miaodao');
    expect(state).toMatchObject({ current: 'jian', next: 'miaodao', phase: 'leaving' });
    expect(switchPresence(state).presence).toBe(before);
  });

  it('收走途中改回原本那件：原地回來', () => {
    let state = advanceSwitch(requestSwitch(createSwitch('jian'), 'spear'), LEAVE_MS / 2);
    const before = switchPresence(state).presence;
    state = requestSwitch(state, 'jian');
    expect(state).toMatchObject({ current: 'jian', next: null, phase: 'entering' });
    expect(switchPresence(state).presence).toBeCloseTo(before, 5);
    expect(advanceSwitch(state, ENTER_MS)).toMatchObject({ current: 'jian', phase: 'idle' });
  });

  it('入場途中改選：從目前露出的程度收走', () => {
    let state = advanceSwitch(requestSwitch(createSwitch('jian'), 'spear'), LEAVE_MS + ENTER_MS / 2);
    const before = switchPresence(state).presence;
    state = requestSwitch(state, 'miaodao');
    expect(state).toMatchObject({ current: 'spear', next: 'miaodao', phase: 'leaving' });
    expect(switchPresence(state).presence).toBeCloseTo(before, 5);
  });

  it('減少動態：立刻換好，沒有過場', () => {
    const state = requestSwitch(createSwitch('jian'), 'spear', { instant: true });
    expect(state).toMatchObject({ current: 'spear', next: null, phase: 'idle' });
    expect(switchPresence(state)).toEqual({ kind: 'spear', presence: 1 });
  });

  it('閒置時推進時間不改變狀態', () => {
    const state = createSwitch('miaodao');
    expect(advanceSwitch(state, 500)).toBe(state);
  });
});
