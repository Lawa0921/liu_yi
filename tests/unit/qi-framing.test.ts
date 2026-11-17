import { describe, expect, it } from 'vitest';
import { framingFor, PORTRAIT_REACH_MARGIN, portraitReachFor, weaponLeftFor, weaponReachFor, WEAPON_LEFT_MARGIN_PX, WEAPON_RIGHT_RESERVE_PX } from '../../src/qi/engine/framing';

/**
 * 取景（試作的值，原本寫在 stage.ts 的 `fit`）：橫向與直向各自決定可視高度與鏡頭位移。
 * 抽成純函式後，兵器擺位（寬螢幕的槍長要留出右緣的段落導覽）也能用同一份取景算「槍尖落在畫布的幾成處」。
 */
describe('framingFor（取景）', () => {
  it('橫向（aspect 1.6）：可視高 5.9 ÷ aspect，鏡頭往左移 13% 的可視寬，人形落在 63% 處', () => {
    const f = framingFor(1.6, false);
    expect(f.visibleH).toBeCloseTo(5.9 / 1.6, 10);
    expect(f.lookX).toBeCloseTo(-f.visibleH * 1.6 * 0.13, 10);
    expect(f.lookY).toBe(1.05);
  });

  it('橫向很寬（aspect 2.2）：可視高有下限 3.4', () => {
    expect(framingFor(2.2, false).visibleH).toBe(3.4);
  });

  it('直向（aspect 0.46）：可視高 2.75 ÷ aspect，鏡頭往下移 13%，x 不動', () => {
    const f = framingFor(0.46, true);
    expect(f.visibleH).toBeCloseTo(2.75 / 0.46, 10);
    expect(f.lookX).toBe(0);
    expect(f.lookY).toBeCloseTo(1.05 - f.visibleH * 0.13, 10);
  });

  it('直向取景遇到較寬的畫布（aspect 1.05；視窗與畫布的寬高比不同，邊界值）：可視高取下限 3.4', () => {
    expect(framingFor(1.05, true).visibleH).toBe(3.4);
  });
});

describe('weaponReachFor（寬螢幕兵器右端的世界座標上限）', () => {
  const CASES: [aspect: number, widthPx: number][] = [
    [1.556, 996], // 1024×768 的畫布
    [1.863, 1252], // 1280×800
    [1.83, 1412], // 1440×900
    [1.987, 1892], // 1920×1080
    [2.4, 2400],
  ];

  it.each(CASES)('aspect %s、畫布寬 %s px：上限處投影到離畫布右緣 WEAPON_RIGHT_RESERVE_PX 處', (aspect, widthPx) => {
    const { visibleH, lookX } = framingFor(aspect, false);
    const reach = weaponReachFor(aspect, widthPx);
    const rightPx = (0.5 + (reach - lookX) / (visibleH * aspect)) * widthPx;
    expect(widthPx - rightPx).toBeCloseTo(WEAPON_RIGHT_RESERVE_PX, 6);
  });

  it('導覽 58px ＋ 槍頭光暈 40px 都放得進保留的距離（再留一點餘裕）', () => {
    expect(WEAPON_RIGHT_RESERVE_PX).toBeGreaterThanOrEqual(58 + 40);
  });

  it('畫布越寬，保留的比例越小（導覽與光暈是固定的 px，不隨視窗放大）', () => {
    const fraction = (aspect: number, widthPx: number) => {
      const { visibleH, lookX } = framingFor(aspect, false);
      return 0.5 + (weaponReachFor(aspect, widthPx) - lookX) / (visibleH * aspect);
    };
    expect(fraction(1.987, 1892)).toBeGreaterThan(fraction(1.556, 996));
  });

  it('畫布很窄時有下限（右端不低於畫布寬的 70%），上限永遠是正數', () => {
    for (const [aspect, widthPx] of [[1.2, 200], [1.0, 120], [1.6, 400]] as const) {
      expect(weaponReachFor(aspect, widthPx), `aspect ${aspect}、寬 ${widthPx}`).toBeGreaterThan(0);
    }
    const { visibleH, lookX } = framingFor(1.2, false);
    expect(0.5 + (weaponReachFor(1.2, 200) - lookX) / (visibleH * 1.2)).toBeCloseTo(0.7, 10);
  });
});

describe('weaponLeftFor（兵器左端的世界座標下限：不進入該段實際文字）', () => {
  const CASES: [aspect: number, widthPx: number, textRightPx: number][] = [
    [1.11, 972, 440], // 1000×1000：該段文字右緣（從畫布左緣起算）
    [1.556, 996, 440], // 1024×768
    [1.83, 1412, 471], // 1440×900：大槍那一段的字只排到約 471px
    [2.62, 844, 380], // 844×390 橫放手機
  ];

  it.each(CASES)('aspect %s、畫布寬 %s px、文字欄右緣 %s px：下限投影到文字右緣再加 WEAPON_LEFT_MARGIN_PX', (aspect, widthPx, textRightPx) => {
    const { visibleH, lookX } = framingFor(aspect, false);
    const left = weaponLeftFor(aspect, widthPx, textRightPx);
    const leftPx = (0.5 + (left - lookX) / (visibleH * aspect)) * widthPx;
    expect(leftPx).toBeCloseTo(textRightPx + WEAPON_LEFT_MARGIN_PX, 6);
  });

  it('文字排得越右，下限越往右；留的空隙是 24px', () => {
    expect(WEAPON_LEFT_MARGIN_PX).toBe(24);
    expect(weaponLeftFor(1.5, 1000, 600)).toBeGreaterThan(weaponLeftFor(1.5, 1000, 400));
  });
});

describe('portraitReachFor（直向版面持械形體的左右界：畫布的左右緣各留 4%，Task 27）', () => {
  it('以鏡頭的 lookX 為中心對稱；寬 = 可視寬 × (1 − 2 × 邊距)', () => {
    for (const aspect of [0.4, 0.46, 0.62, 0.8]) {
      const { visibleH, lookX } = framingFor(aspect, true);
      const reach = portraitReachFor(aspect);
      expect((reach.left + reach.right) / 2, `aspect ${aspect}`).toBeCloseTo(lookX, 10);
      expect(reach.right - reach.left, `aspect ${aspect}`).toBeCloseTo(visibleH * aspect * (1 - 2 * PORTRAIT_REACH_MARGIN), 10);
    }
  });

  it('界在畫布可視範圍之內（比可視寬的一半小）、右界在左界之右；邊距是 4%', () => {
    expect(PORTRAIT_REACH_MARGIN).toBe(0.04);
    const aspect = 0.46;
    const { visibleH } = framingFor(aspect, true);
    const reach = portraitReachFor(aspect);
    expect(reach.right).toBeGreaterThan(reach.left);
    expect(reach.right - reach.left).toBeLessThan(visibleH * aspect);
    expect(reach.right).toBeGreaterThan(0); // armedLayout 要求右界是正數（直向 lookX = 0）
  });
});
