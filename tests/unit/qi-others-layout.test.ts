import { describe, expect, it } from 'vitest';
import { framingFor } from '../../src/qi/engine/framing';
import { OTHERS_LANDSCAPE, OTHERS_MARGIN_PX, OTHERS_MAX_SCALE, OTHERS_MIN_SCALE, OTHERS_TEXT_GAP_PX, othersFit, othersMarginFor, othersTextGapFor } from '../../src/qi/engine/others-layout';
import { arrangeFigures, arrangedSize, figureIndexOf, measureFigures, type Arrangement, type FigureBox } from '../../src/qi/shapes/arrange';
import type { Shape } from '../../src/qi/shapes/format';
import { rng } from '../../src/qi/shapes/rng';

/**
 * others（四個小人形橫排）在執行時的排列（Task 23 修正 R1）：
 *   - 橫向：同一排、放大一點（人形外框高占畫布高至少 25%）；
 *   - 直向：2×2，縮放到可視寬度內，擺在文字上方（不壓文字、不被畫布裁掉）。
 * 配方（config/shapes.ts）與 .bin 不動，排列由 `arrangeFigures` 在展開成目標貼圖之前做。
 */

/** 配方的四個人形：中線 x、外框寬、高（縮成 0.38 後，config/shapes.ts 的註解數字）。 */
const CENTERS = [-1.4, -0.6, 0.35, 1.3];
const WIDTHS = [0.44, 0.69, 0.69, 0.67];
const HEIGHTS = [0.76, 0.55, 0.59, 0.46];

/** 假的 others：每個人形是一個實心長方體的取樣，腳底在 y = 0。 */
function synthOthers(perFigure = 400): Shape {
  const random = rng(11);
  const count = perFigure * 4;
  const positions = new Float32Array(count * 3);
  const kinds = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const k = i % 4;
    positions[i * 3] = CENTERS[k]! + (random() - 0.5) * WIDTHS[k]!;
    positions[i * 3 + 1] = random() * HEIGHTS[k]!;
    positions[i * 3 + 2] = (random() - 0.5) * 0.04;
    kinds[i] = 40 + k;
  }
  // 讓外框的邊界點一定存在（取樣不一定剛好落在邊上）
  for (let k = 0; k < 4; k++) {
    positions[k * 3] = CENTERS[k]! - WIDTHS[k]! / 2;
    positions[k * 3 + 1] = 0;
    positions[(k + 4) * 3] = CENTERS[k]! + WIDTHS[k]! / 2;
    positions[(k + 4) * 3 + 1] = HEIGHTS[k]!;
  }
  return { count, positions, kinds, min: [-1.8, 0, -0.02], max: [1.7, 0.8, 0.02] };
}

const spanOf = (shape: Shape, axis: 0 | 1 | 2, from = 0, to = shape.count, step = 1) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = from; i < to; i += step) {
    lo = Math.min(lo, shape.positions[i * 3 + axis]!);
    hi = Math.max(hi, shape.positions[i * 3 + axis]!);
  }
  return { lo, hi };
};

describe('figureIndexOf／measureFigures', () => {
  it('依最近的中線分組', () => {
    expect(figureIndexOf(-1.5, CENTERS)).toBe(0);
    expect(figureIndexOf(-0.9, CENTERS)).toBe(1);
    expect(figureIndexOf(0.0, CENTERS)).toBe(2);
    expect(figureIndexOf(0.5, CENTERS)).toBe(2);
    expect(figureIndexOf(1.2, CENTERS)).toBe(3);
  });

  it('每個人形量到自己的外框（x 範圍、腳底與頭頂 y）', () => {
    const boxes = measureFigures(synthOthers(), CENTERS);
    expect(boxes).toHaveLength(4);
    boxes.forEach((box, k) => {
      expect(box.maxX - box.minX, `第 ${k} 個的寬`).toBeCloseTo(WIDTHS[k]!, 1);
      expect(box.minY, `第 ${k} 個的腳底`).toBeCloseTo(0, 1);
      expect(box.maxY - box.minY, `第 ${k} 個的高`).toBeCloseTo(HEIGHTS[k]!, 1);
    });
  });

  it('某個人形一個點都沒有：丟 RangeError（不是量出無限大）', () => {
    const shape = synthOthers();
    expect(() => measureFigures(shape, [...CENTERS, 9])).toThrow(RangeError);
  });
});

describe('arrangedSize／arrangeFigures', () => {
  const shape = synthOthers();
  const boxes = measureFigures(shape, CENTERS);
  const widthOf = (b: FigureBox) => b.maxX - b.minX;
  const heightOf = (b: FigureBox) => b.maxY - b.minY;
  const row: Arrangement = { rows: [[0, 1, 2, 3]], scale: 1.15, gap: 0.15, rowGap: 0 };
  const grid: Arrangement = { rows: [[0, 1], [2, 3]], scale: 1.4, gap: 0.2, rowGap: 0.2 };

  it('一排：總寬＝各人形寬 × scale ＋ 間距，總高＝最高的人形 × scale', () => {
    const size = arrangedSize(boxes, row);
    expect(size.width).toBeCloseTo(boxes.reduce((sum, b) => sum + widthOf(b), 0) * 1.15 + 3 * 0.15, 9);
    expect(size.height).toBeCloseTo(Math.max(...boxes.map(heightOf)) * 1.15, 9);
  });

  it('一排：由左到右維持原順序、相鄰間距剛好是 gap、整排置中在 x = 0、腳底在 y = 0', () => {
    const out = arrangeFigures(shape, CENTERS, boxes, row);
    expect(out.count).toBe(shape.count);
    const spans = [0, 1, 2, 3].map((k) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < out.count; i++) {
        if (figureIndexOf(shape.positions[i * 3]!, CENTERS) !== k) continue;
        lo = Math.min(lo, out.positions[i * 3]!);
        hi = Math.max(hi, out.positions[i * 3]!);
      }
      return { lo, hi };
    });
    for (let k = 0; k < 3; k++) expect(spans[k + 1]!.lo - spans[k]!.hi, `第 ${k} 與 ${k + 1} 個之間`).toBeCloseTo(0.15, 6);
    spans.forEach((span, k) => expect(span.hi - span.lo, `第 ${k} 個的寬`).toBeCloseTo(widthOf(boxes[k]!) * 1.15, 6));
    expect(spans[0]!.lo + spans[3]!.hi).toBeCloseTo(0, 6);
    expect(spanOf(out, 1).lo).toBeCloseTo(0, 6);
    expect(spanOf(out, 1).hi).toBeCloseTo(arrangedSize(boxes, row).height, 6);
    expect(out.min[0]).toBeCloseTo(spanOf(out, 0).lo, 6);
    expect(out.max[1]).toBeCloseTo(spanOf(out, 1).hi, 6);
  });

  it('種類、點數、點與點的對應順序都不變；z 跟著 scale 縮放（相似形）', () => {
    const out = arrangeFigures(shape, CENTERS, boxes, grid);
    expect(Array.from(out.kinds)).toEqual(Array.from(shape.kinds));
    for (let i = 0; i < shape.count; i += 97) expect(out.positions[i * 3 + 2]).toBeCloseTo(shape.positions[i * 3 + 2]! * 1.4, 6);
  });

  it('2×2：上排放 0、1，下排放 2、3；各排置中；上排的腳底比下排的頭頂高出 rowGap；下排腳底在 y = 0', () => {
    const out = arrangeFigures(shape, CENTERS, boxes, grid);
    const rows = [
      { figures: [0, 1], lo: Infinity, hi: -Infinity, bottom: Infinity, top: -Infinity },
      { figures: [2, 3], lo: Infinity, hi: -Infinity, bottom: Infinity, top: -Infinity },
    ];
    for (let i = 0; i < out.count; i++) {
      const k = figureIndexOf(shape.positions[i * 3]!, CENTERS);
      const r = rows.find((item) => item.figures.includes(k))!;
      r.lo = Math.min(r.lo, out.positions[i * 3]!);
      r.hi = Math.max(r.hi, out.positions[i * 3]!);
      r.bottom = Math.min(r.bottom, out.positions[i * 3 + 1]!);
      r.top = Math.max(r.top, out.positions[i * 3 + 1]!);
    }
    for (const r of rows) expect(r.lo + r.hi, '每一排置中').toBeCloseTo(0, 6);
    expect(rows[1]!.bottom).toBeCloseTo(0, 6);
    expect(rows[0]!.bottom - rows[1]!.top).toBeCloseTo(0.2, 6);
    const size = arrangedSize(boxes, grid);
    expect(rows[0]!.top).toBeCloseTo(size.height, 6);
    expect(Math.max(rows[0]!.hi - rows[0]!.lo, rows[1]!.hi - rows[1]!.lo)).toBeCloseTo(size.width, 6);
  });

  it('offset 整體平移', () => {
    const base = arrangeFigures(shape, CENTERS, boxes, grid);
    const moved = arrangeFigures(shape, CENTERS, boxes, grid, { x: 0.3, y: 1.1 });
    for (let i = 0; i < shape.count; i += 53) {
      expect(moved.positions[i * 3]! - base.positions[i * 3]!).toBeCloseTo(0.3, 5);
      expect(moved.positions[i * 3 + 1]! - base.positions[i * 3 + 1]!).toBeCloseTo(1.1, 5);
    }
  });

  it('排列不合法（人形重複、漏掉、不存在、scale 非正）：丟 RangeError', () => {
    expect(() => arrangeFigures(shape, CENTERS, boxes, { ...row, rows: [[0, 1, 2]] })).toThrow(RangeError);
    expect(() => arrangeFigures(shape, CENTERS, boxes, { ...row, rows: [[0, 1], [1, 2, 3]] })).toThrow(RangeError);
    expect(() => arrangeFigures(shape, CENTERS, boxes, { ...row, rows: [[0, 1, 2, 4]] })).toThrow(RangeError);
    expect(() => arrangeFigures(shape, CENTERS, boxes, { ...row, scale: 0 })).toThrow(RangeError);
    expect(() => arrangedSize(boxes, { ...row, rows: [[0, 1, 2, 9]] })).toThrow(RangeError);
  });
});

describe('othersFit（橫向一排、直向 2×2 縮進畫布並避開文字）', () => {
  const boxes = measureFigures(synthOthers(), CENTERS);

  /** 把排好的世界座標投到畫布像素（與引擎同一份取景；z = 0 的線性推算）。 */
  function project(fit: ReturnType<typeof othersFit>, cssWidth: number, cssHeight: number) {
    const frame = framingFor(cssWidth / cssHeight, true);
    const visibleW = frame.visibleH * (cssWidth / cssHeight);
    const size = arrangedSize(boxes, fit.arrangement);
    const px = (x: number) => cssWidth / 2 + ((x - frame.lookX) / visibleW) * cssWidth;
    const py = (y: number) => cssHeight * (0.5 - (y - frame.lookY) / frame.visibleH);
    return {
      left: px(fit.offset.x - size.width / 2),
      right: px(fit.offset.x + size.width / 2),
      top: py(fit.offset.y + size.height),
      bottom: py(fit.offset.y),
    };
  }

  it('橫向：一排，放大到 OTHERS_LANDSCAPE.scale，腳底在 y = 0、置中在 x = 0', () => {
    const fit = othersFit({ boxes, portrait: false, cssWidth: 1412, cssHeight: 772 });
    expect(fit.arrangement.rows).toEqual([[0, 1, 2, 3]]);
    expect(fit.arrangement.scale).toBe(OTHERS_LANDSCAPE.scale);
    expect(fit.arrangement.gap).toBe(OTHERS_LANDSCAPE.gap);
    expect(fit.offset).toEqual({ x: 0, y: 0 });
    // 橫向的總寬不比原本的橫排寬（原本約 3.26）
    const original = arrangedSize(boxes, { rows: [[0, 1, 2, 3]], scale: 1, gap: 0.25, rowGap: 0 });
    expect(arrangedSize(boxes, fit.arrangement).width).toBeLessThanOrEqual(original.width + 0.05);
    expect(arrangedSize(boxes, fit.arrangement).height).toBeGreaterThan(original.height * 1.1);
  });

  for (const view of [
    { name: '390×844（畫布 390×776）', w: 390, h: 776, textTop: 332 },
    { name: '360×740（畫布 360×672）', w: 360, h: 672, textTop: 290 },
    { name: '412×915（畫布 412×803）', w: 412, h: 803, textTop: 350 },
    { name: '1024×1366 平板（畫布 1024×1238）', w: 1024, h: 1238, textTop: 560 },
  ]) {
    it(`直向 ${view.name}：2×2，四個人形都在畫布內（四邊至少 ${OTHERS_MARGIN_PX} px、隨畫布放大），底部離文字上緣至少 ${OTHERS_TEXT_GAP_PX} px（隨畫布放大）`, () => {
      const fit = othersFit({ boxes, portrait: true, cssWidth: view.w, cssHeight: view.h, textTop: view.textTop });
      expect(fit.arrangement.rows).toEqual([[0, 1], [2, 3]]);
      const box = project(fit, view.w, view.h);
      const margin = othersMarginFor(view.w, view.h);
      expect(margin).toBeGreaterThanOrEqual(OTHERS_MARGIN_PX);
      expect(box.left, '左').toBeGreaterThanOrEqual(margin - 0.5);
      expect(view.w - box.right, '右').toBeGreaterThanOrEqual(margin - 0.5);
      expect(box.top, '上').toBeGreaterThanOrEqual(margin - 0.5);
      expect(view.textTop - box.bottom, '離文字上緣').toBeGreaterThanOrEqual(othersTextGapFor(view.h) - 0.5);
      expect(fit.arrangement.scale).toBeLessThanOrEqual(OTHERS_MAX_SCALE);
      expect(fit.arrangement.scale).toBeGreaterThanOrEqual(OTHERS_MIN_SCALE);
    });
  }

  it('邊界隨畫布放大：手機維持最小值，平板（1024×1238）按畫布尺寸的比例放大', () => {
    expect(othersMarginFor(390, 776)).toBe(OTHERS_MARGIN_PX);
    expect(othersTextGapFor(776)).toBeCloseTo(0.03 * 776, 6);
    expect(othersMarginFor(1024, 1238)).toBeGreaterThan(OTHERS_MARGIN_PX);
    expect(othersTextGapFor(1238)).toBeGreaterThan(OTHERS_TEXT_GAP_PX);
  });

  it('直向：能放大就放大（寬與高都還有餘裕時，不會停在 1）', () => {
    const fit = othersFit({ boxes, portrait: true, cssWidth: 390, cssHeight: 776, textTop: 332 });
    expect(fit.arrangement.scale).toBeGreaterThan(1.2);
  });

  it('直向：文字上緣越高（可用的高越小），縮放越小；小到下限就不再縮', () => {
    const at = (textTop: number) => othersFit({ boxes, portrait: true, cssWidth: 390, cssHeight: 776, textTop }).arrangement.scale;
    expect(at(260)).toBeLessThan(at(332));
    expect(at(200)).toBeLessThan(at(260));
    expect(at(10)).toBe(OTHERS_MIN_SCALE);
    expect(at(-500)).toBe(OTHERS_MIN_SCALE);
  });

  it('直向：文字區塊高到沒有空間（320×568、文字上緣在 110）：縮到下限，上緣仍貼在畫布上緣的邊界上（不被畫布裁掉，寧可壓到文字）', () => {
    const fit = othersFit({ boxes, portrait: true, cssWidth: 320, cssHeight: 512, textTop: 110 });
    expect(fit.arrangement.scale).toBe(OTHERS_MIN_SCALE);
    const box = project(fit, 320, 512);
    expect(box.top).toBeGreaterThanOrEqual(othersMarginFor(320, 512) - 0.5);
    expect(box.left).toBeGreaterThanOrEqual(othersMarginFor(320, 512) - 0.5);
  });

  it('直向：沒有文字位置（harness、量不到）：腳底落在其他姿勢的腳底線（y = 0）之上，寬度仍在畫布內', () => {
    const fit = othersFit({ boxes, portrait: true, cssWidth: 390, cssHeight: 776 });
    const box = project(fit, 390, 776);
    expect(box.left).toBeGreaterThanOrEqual(OTHERS_MARGIN_PX - 0.5);
    expect(390 - box.right).toBeGreaterThanOrEqual(OTHERS_MARGIN_PX - 0.5);
    expect(fit.offset.y).toBeGreaterThanOrEqual(-1e-9);
  });

  it('文字上緣不是有限數（NaN）：當作沒有', () => {
    const none = othersFit({ boxes, portrait: true, cssWidth: 390, cssHeight: 776 });
    const nan = othersFit({ boxes, portrait: true, cssWidth: 390, cssHeight: 776, textTop: Number.NaN });
    expect(nan).toEqual(none);
  });
});
