import { describe, expect, it } from 'vitest';
import { othersFitWindow, OTHERS_MAX_SCALE } from '../../src/qi/engine/others-layout';
import { ambientField, expandTargets, weaponLayout } from '../../src/qi/shapes/expand';
import { KIND, type Shape } from '../../src/qi/shapes/format';
import { arrangedSize, type FigureBox } from '../../src/qi/shapes/arrange';

/**
 * 槽取景下形體怎麼擺進視窗（Task 26）：兵器縮進視窗、others（四個小人形）依視窗的寬窄選一排或 2×2。
 * 視窗是槽在世界座標裡的半寬、半高與中心高度（`engine/slot.ts`）；首頁不傳視窗，行為不變（qi-expand、qi-others-layout 守住）。
 */

/** 一條軸線上的兵器：x 從 −0.6 到 +0.6，全是鋼。 */
function axisWeapon(): Shape {
  const count = 64;
  const positions = new Float32Array(count * 3);
  const kinds = new Uint8Array(count).fill(KIND.STEEL);
  for (let k = 0; k < count; k++) positions[k * 3] = -0.6 + (1.2 * k) / (count - 1);
  return { count, positions, kinds, min: [-0.6, 0, 0], max: [0.6, 0, 0] };
}

/** 前 64 個點（形體的取樣各一次，還沒重複）的 xy 外框。 */
function extent(out: Float32Array, ambient: ReturnType<typeof ambientField>): { maxX: number; minX: number; maxY: number; minY: number } {
  const slots: number[] = [];
  for (let i = 0; i < ambient.mask.length && slots.length < 64; i++) if (!ambient.mask[i]) slots.push(i);
  const xs = slots.map((i) => out[i * 4]!);
  const ys = slots.map((i) => out[i * 4 + 1]!);
  return { maxX: Math.max(...xs), minX: Math.min(...xs), maxY: Math.max(...ys), minY: Math.min(...ys) };
}

describe('weaponLayout 的視窗 window（槽取景：兵器縮進槽）', () => {
  it('給 window 時 layout 帶著它；沒給就沒有這個欄位（首頁不受影響）', () => {
    const window = { halfWidth: 0.9, halfHeight: 1.2, cy: 1 };
    expect(weaponLayout('jian', false, undefined, undefined, window)).toEqual({ scale: 1.9, rotZ: 0.5, offset: [0, 1.05, 0], window });
    expect('window' in weaponLayout('jian', false)).toBe(false);
  });

  it('兵器比視窗寬：等比例縮到最右、最左的光點剛好在視窗的邊（傾角與中點不變）', () => {
    const ambient = ambientField(112 * 112);
    const window = { halfWidth: 0.5, halfHeight: 3, cy: 1 };
    const out = expandTargets(axisWeapon(), 112, ambient, weaponLayout('jian', false, undefined, undefined, window));
    const e = extent(out, ambient);
    expect(e.maxX).toBeCloseTo(0.5, 5);
    expect(e.minX).toBeCloseTo(-0.5, 5);
    expect((e.maxY + e.minY) / 2).toBeCloseTo(1.05, 4);
  });

  it('兵器比視窗高（傾角大、視窗矮）：以高度為準縮', () => {
    const ambient = ambientField(112 * 112);
    const window = { halfWidth: 3, halfHeight: 0.2, cy: 1.05 };
    const out = expandTargets(axisWeapon(), 112, ambient, weaponLayout('jian', false, undefined, undefined, window));
    const e = extent(out, ambient);
    expect((e.maxY - e.minY) / 2).toBeCloseTo(0.2, 5);
  });

  it('放得下的不動：只縮、不放大', () => {
    const ambient = ambientField(112 * 112);
    const window = { halfWidth: 3, halfHeight: 3, cy: 1 };
    const plain = expandTargets(axisWeapon(), 112, ambient, weaponLayout('jian', false));
    const fitted = expandTargets(axisWeapon(), 112, ambient, weaponLayout('jian', false, undefined, undefined, window));
    expect(Array.from(fitted)).toEqual(Array.from(plain));
  });
});

describe('othersFitWindow（槽取景：四個小人形放進視窗）', () => {
  /** `config/shapes.ts` 的 others 配方（縮 0.38）各人形的外框：寬約 0.44／0.69／0.69／0.67、高約 0.76／0.55／0.59／0.46。 */
  const boxes: FigureBox[] = [
    { minX: -1.62, maxX: -1.18, minY: 0, maxY: 0.76 },
    { minX: -0.95, maxX: -0.26, minY: 0, maxY: 0.55 },
    { minX: 0.0, maxX: 0.69, minY: 0, maxY: 0.59 },
    { minX: 0.96, maxX: 1.63, minY: 0, maxY: 0.46 },
  ];

  it('窄而高的視窗（右側欄）：2×2', () => {
    const fit = othersFitWindow({ boxes, halfWidth: 0.8, halfHeight: 1.6, cy: 1 });
    expect(fit.arrangement.rows).toEqual([[0, 1], [2, 3]]);
  });

  it('寬而矮的視窗（頁首的一條）：一排', () => {
    const fit = othersFitWindow({ boxes, halfWidth: 2.3, halfHeight: 0.6, cy: 1 });
    expect(fit.arrangement.rows).toEqual([[0, 1, 2, 3]]);
  });

  it.each([
    ['右側欄', 0.8, 1.6],
    ['頁首的一條', 2.3, 0.6],
    ['小手機的頁首', 0.9, 0.55],
  ])('%s：排好的外框在視窗內，並以 cy 為中心上下置中', (_name, halfWidth, halfHeight) => {
    const fit = othersFitWindow({ boxes, halfWidth, halfHeight, cy: 1 });
    const size = arrangedSize(boxes, fit.arrangement);
    expect(size.width).toBeLessThanOrEqual(2 * halfWidth + 1e-9);
    expect(size.height).toBeLessThanOrEqual(2 * halfHeight + 1e-9);
    expect(fit.offset.x).toBe(0);
    expect(fit.offset.y + size.height / 2).toBeCloseTo(1, 8);
  });

  it('視窗很大：倍率不超過上限（OTHERS_MAX_SCALE）；視窗極小：倍率仍是正數', () => {
    expect(othersFitWindow({ boxes, halfWidth: 20, halfHeight: 20, cy: 1 }).arrangement.scale).toBe(OTHERS_MAX_SCALE);
    expect(othersFitWindow({ boxes, halfWidth: 0.01, halfHeight: 0.01, cy: 1 }).arrangement.scale).toBeGreaterThan(0);
  });
});
