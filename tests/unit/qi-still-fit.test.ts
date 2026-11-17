import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STILL_FIT_HEIGHT, STILL_FIT_WIDTH, stillScale } from '../../src/qi/config/still-fit';
import { stillOffsetOf, stillScaleOf } from '../../src/lib/still-fit';
import { encodeShape, SHAPE_COUNT, type Shape } from '../../src/qi/shapes/format';

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

/**
 * 讀形體檔外框的部分（`lib/still-fit.ts`，建置時在 Astro 的 frontmatter 用）：目錄可以注入。
 * 預設目錄是被 gitignore 的建置產物 `src/assets/generated/qi/shapes/`，全新 clone 上直接跑 `npm test` 時它還不存在，
 * 所以這裡在暫存目錄寫幾個外框已知的假形體檔（`encodeShape`），不依賴任何建置產物。
 */
describe('stillScaleOf／stillOffsetOf（讀形體檔的外框，目錄可注入）', () => {
  let dir: string;

  /** 一個外框為 [−w/2, w/2] × [y0, y1] 的假形體（四個角各一點，其餘點落在中間）。 */
  const boxShape = (w: number, y0: number, y1: number): Shape => {
    const positions = new Float32Array(SHAPE_COUNT * 3);
    const corners: [number, number][] = [
      [-w / 2, y0],
      [w / 2, y0],
      [-w / 2, y1],
      [w / 2, y1],
    ];
    for (let i = 0; i < SHAPE_COUNT; i++) {
      const [x, y] = i < 4 ? corners[i]! : [0, (y0 + y1) / 2];
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
    }
    return { count: SHAPE_COUNT, positions, kinds: new Uint8Array(SHAPE_COUNT), min: [-w / 2, y0, 0], max: [w / 2, y1, 0] };
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'qi-still-fit-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'upright.bin'), encodeShape(boxShape(1.15, 0, 2)));
    writeFileSync(join(dir, 'squat.bin'), encodeShape(boxShape(1.8, 0, 1.46)));
    writeFileSync(join(dir, 'arch.bin'), encodeShape(boxShape(2.4, 0, 1.0)));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('高的形體（1.15 × 2.0）：倍率約 0.4', () => {
    expect(stillScaleOf('upright', 4 / 3, dir)).toBeCloseTo(STILL_FIT_HEIGHT / 2, 4);
  });

  it('寬的形體（2.4 × 1.0）：寬度先到（倍率 = 4/3 × 0.88 ÷ 2.4 ≈ 0.49，小於高度先到時的 0.8）', () => {
    const k = stillScaleOf('arch', 4 / 3, dir);
    expect(k).toBeCloseTo(((4 / 3) * STILL_FIT_WIDTH) / 2.4, 4);
    expect(k).toBeLessThan(STILL_FIT_HEIGHT);
  });

  it('stillOffsetOf：外框中心剛好在 cy 的不用移；蹲低的架勢（高 1.46，外框中心在 0.73）靜態圖要往下移 cy − 0.73', () => {
    expect(stillOffsetOf('upright', 1, dir)).toBeCloseTo(0, 4);
    expect(stillOffsetOf('squat', 1, dir)).toBeCloseTo(1 - 0.73, 4);
    expect(stillOffsetOf('arch', 0.5, dir)).toBeCloseTo(0, 4);
  });

  it('不存在的形體：丟錯（不輸出大小不對的圖）', () => {
    expect(() => stillScaleOf('no-such-shape', 4 / 3, dir)).toThrow();
    expect(() => stillOffsetOf('no-such-shape', 1, dir)).toThrow();
  });

  it('不同目錄各自讀各自的檔（快取以目錄與形體 id 為鍵，不會把別的目錄的同名檔拿來用）', () => {
    const other = mkdtempSync(join(tmpdir(), 'qi-still-fit-other-'));
    try {
      writeFileSync(join(other, 'upright.bin'), encodeShape(boxShape(1.15, 0, 1)));
      expect(stillScaleOf('upright', 4 / 3, other)).not.toBeCloseTo(stillScaleOf('upright', 4 / 3, dir), 3);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
