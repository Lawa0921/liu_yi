import { describe, expect, it } from 'vitest';
import { fitScale, restingLean, rotatedExtent } from '../../src/lib/arsenal/stage';

describe('rotatedExtent：一件斜放的長兵器佔多寬多高', () => {
  it('橫放：寬是長度，高是兩側的餘裕', () => {
    expect(rotatedExtent({ length: 1, clearance: 0.05, lean: 0 })).toEqual({ width: 1, height: 0.1 });
  });

  it('直立：寬高對調', () => {
    const extent = rotatedExtent({ length: 1, clearance: 0.05, lean: Math.PI / 2 });
    expect(extent.width).toBeCloseTo(0.1, 6);
    expect(extent.height).toBeCloseTo(1, 6);
  });

  it('往下斜和往上斜佔的範圍一樣', () => {
    expect(rotatedExtent({ length: 1.4, clearance: 0.06, lean: -0.6 })).toEqual(
      rotatedExtent({ length: 1.4, clearance: 0.06, lean: 0.6 }),
    );
  });
});

describe('fitScale：兵器放大到剛好裝進舞台範圍', () => {
  const sword = { length: 1, clearance: 0.05 };

  it('裝得下：放大後的寬高都不超過範圍', () => {
    for (const lean of [0, 0.3, 0.8, 1.2]) {
      for (const [regionWidth, regionHeight] of [
        [6, 2],
        [2, 6],
        [3, 3],
      ] as const) {
        const scale = fitScale({ ...sword, lean, regionWidth, regionHeight });
        const extent = rotatedExtent({ ...sword, lean });
        expect(extent.width * scale).toBeLessThanOrEqual(regionWidth + 1e-9);
        expect(extent.height * scale).toBeLessThanOrEqual(regionHeight + 1e-9);
        // 而且有一邊是頂到的（不是隨便縮小）。
        const slack = Math.min(regionWidth - extent.width * scale, regionHeight - extent.height * scale);
        expect(slack).toBeLessThan(1e-6);
      }
    }
  });

  it('範圍是 0 或負的時候回 0，不會是負數或 NaN', () => {
    expect(fitScale({ ...sword, lean: 0.3, regionWidth: 0, regionHeight: 2 })).toBe(0);
    expect(fitScale({ ...sword, lean: 0.3, regionWidth: -1, regionHeight: 2 })).toBe(0);
    expect(fitScale({ length: 0, clearance: 0, lean: 0, regionWidth: 2, regionHeight: 2 })).toBe(0);
  });
});

describe('restingLean：兵器沿著舞台範圍的對角線斜放', () => {
  it('範圍越高窄，放得越陡；越扁，放得越平', () => {
    expect(restingLean(2, 6)).toBeGreaterThan(restingLean(3, 3));
    expect(restingLean(3, 3)).toBeGreaterThan(restingLean(6, 2));
  });

  it('不會平到躺下，也不會陡到直立', () => {
    expect(restingLean(100, 1)).toBeGreaterThanOrEqual(0.12);
    expect(restingLean(1, 100)).toBeLessThanOrEqual(1.15);
    expect(restingLean(0, 0)).toBeGreaterThanOrEqual(0.12);
  });
});
