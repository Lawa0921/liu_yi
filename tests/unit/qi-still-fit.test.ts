import { describe, expect, it } from 'vitest';
import { STILL_FIT_HEIGHT, STILL_FIT_WIDTH, stillScale } from '../../src/qi/config/still-fit';
import { stillOffsetOf, stillScaleOf } from '../../src/lib/still-fit';

/** 靜態圖大小的換算（Task 26）：形體外框 → 「每世界單位占圖高的倍率」，頁面光點層用它讓靜態圖與引擎的光點一樣大。 */
describe('stillScale', () => {
  it('高的形體（落地人形 1.15 × 2.0）：高度先到 0.8，倍率 = 0.8 ÷ 2.0', () => {
    expect(stillScale({ x: 1.15, y: 2 }, 4 / 3)).toBeCloseTo(STILL_FIT_HEIGHT / 2, 10);
  });

  it('寬的形體（院門 2.4 × 1.0，圖 4:3）：寬度先到 0.88，倍率 = 4/3 × 0.88 ÷ 2.4', () => {
    expect(stillScale({ x: 2.4, y: 1 }, 4 / 3)).toBeCloseTo(((4 / 3) * STILL_FIT_WIDTH) / 2.4, 10);
  });

  it('寬高比不同的圖（hero-tall 780×1280）：同一個形體倍率不同', () => {
    const wide = stillScale({ x: 1.15, y: 2 }, 4 / 3);
    const tall = stillScale({ x: 1.15, y: 2 }, 780 / 1280);
    expect(tall).toBeLessThanOrEqual(wide);
  });

  it('外框退化（寬或高為 0）不崩潰、結果有限', () => {
    expect(Number.isFinite(stillScale({ x: 0, y: 2 }, 4 / 3))).toBe(true);
    expect(Number.isFinite(stillScale({ x: 2, y: 0 }, 4 / 3))).toBe(true);
  });
});

describe('stillScaleOf（讀建置產物的形體檔）', () => {
  it('land：外框約 1.15 × 2.0，倍率約 0.4', () => {
    expect(stillScaleOf('land', 4 / 3)).toBeGreaterThan(0.39);
    expect(stillScaleOf('land', 4 / 3)).toBeLessThan(0.41);
  });

  it('gate：寬的形體，寬度先到（倍率 < 高度先到時的 0.8 ÷ 高）', () => {
    const k = stillScaleOf('gate', 4 / 3);
    expect(k).toBeGreaterThan(0.45);
    expect(k).toBeLessThan(0.55);
  });

  it('stillOffsetOf：落地人形（外框中心 ≈ 1.0 ＝ cy）不用移；蹲低的架勢（定軸高約 1.46）外框中心在 0.73，靜態圖要往下移 cy − 0.73', () => {
    expect(Math.abs(stillOffsetOf('land', 1))).toBeLessThan(0.02);
    expect(stillOffsetOf('dingzhou', 1)).toBeGreaterThan(0.2);
    expect(stillOffsetOf('dingzhou', 1)).toBeLessThan(0.34);
    expect(Math.abs(stillOffsetOf('gate', 0.51))).toBeLessThan(0.02);
  });

  it('不存在的形體：丟錯（不輸出大小不對的圖）', () => {
    expect(() => stillScaleOf('no-such-shape', 4 / 3)).toThrow();
  });
});
