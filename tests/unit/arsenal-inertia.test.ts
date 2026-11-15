import { describe, expect, it } from 'vitest';
import { createSpin, dragSpin, grabSpin, releaseSpin, stepSpin, type SpinState } from '../../src/lib/arsenal/inertia';

const TAU = Math.PI * 2;

function run(state: SpinState, ms: number, options: Parameters<typeof stepSpin>[2], frame = 16): SpinState {
  let current = state;
  for (let t = 0; t < ms; t += frame) current = stepSpin(current, frame, options);
  return current;
}

describe('拖曳慣性與回正', () => {
  it('拖曳：角度跟著位移走，方向一致', () => {
    const start = grabSpin(createSpin(0));
    const right = dragSpin(start, 100, 16);
    const left = dragSpin(start, -100, 16);
    expect(right.angle).toBeGreaterThan(0);
    expect(left.angle).toBeCloseTo(-right.angle, 10);
    expect(dragSpin(start, 200, 16).angle).toBeCloseTo(right.angle * 2, 10);
  });

  it('按住不動時不會自己轉', () => {
    const held = dragSpin(grabSpin(createSpin(0)), 80, 16);
    const later = run(held, 2000, { home: 0 });
    expect(later.angle).toBe(held.angle);
  });

  it('放手有慣性：先順著原方向再走一段', () => {
    let state = grabSpin(createSpin(0));
    for (let i = 0; i < 5; i++) state = dragSpin(state, 30, 16);
    const released = releaseSpin(state);
    const soon = run(released, 160, { home: 0 });
    expect(soon.angle).toBeGreaterThan(released.angle);
  });

  it('放手後緩緩回正，最後停在原位', () => {
    let state = grabSpin(createSpin(0));
    for (let i = 0; i < 5; i++) state = dragSpin(state, 30, 16);
    const settled = run(releaseSpin(state), 12_000, { home: 0 });
    expect(Math.abs(settled.angle)).toBeLessThan(0.01);
    expect(Math.abs(settled.velocity)).toBeLessThan(1e-5);
  });

  it('轉了好幾圈後回到最近的正面，不倒轉回去', () => {
    const spun: SpinState = { angle: TAU * 3 + 0.4, velocity: 0, dragging: false };
    const settled = run(spun, 12_000, { home: 0 });
    expect(settled.angle).toBeCloseTo(TAU * 3, 1);
  });

  it('回正不是瞬間的：半秒後還沒到', () => {
    const offset: SpinState = { angle: 1.2, velocity: 0, dragging: false };
    const soon = run(offset, 500, { home: 0 });
    expect(soon.angle).toBeGreaterThan(0.3);
    expect(soon.angle).toBeLessThan(1.2);
  });

  it('自轉模式：放手後回到固定的自轉速度，不回正', () => {
    let state = grabSpin(createSpin(0));
    for (let i = 0; i < 5; i++) state = dragSpin(state, -40, 16);
    const settled = run(releaseSpin(state), 8000, { cruise: 0.0004 });
    expect(settled.velocity).toBeCloseTo(0.0004, 5);
  });

  it('減少動態（不自轉、不回正）：放手後停在放手的地方', () => {
    let state = grabSpin(createSpin(0));
    state = dragSpin(state, 120, 16);
    const released = releaseSpin(state, { keepMomentum: false });
    const later = run(released, 3000, {});
    expect(later.angle).toBe(released.angle);
    expect(later.velocity).toBe(0);
  });

  it('掉幀（一格很久）也不會爆衝', () => {
    const offset: SpinState = { angle: 2, velocity: 0.02, dragging: false };
    const after = stepSpin(offset, 5000, { home: 0 });
    expect(Number.isFinite(after.angle)).toBe(true);
    expect(Math.abs(after.angle)).toBeLessThan(TAU * 4);
  });
});
