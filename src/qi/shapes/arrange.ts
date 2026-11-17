/**
 * 合成形體（`compose`，目前只有 `others`）的執行時排列（Task 23 修正 R1）。
 *
 * 配方把幾個縮小的人形橫排成一個形體（`config/shapes.ts`），形體檔與靜態圖都照那個排法。直向的手機畫布比那一排窄，
 * 整排會被畫布裁掉、還壓到文字，所以展開成目標貼圖之前，依視窗把每個人形搬到新的位置：
 *   - 認人形：每個取樣屬於中線 x 最近的那個人形（人形之間有空隙，配方的中線就是分界依據；`qi-build-shapes` 單元測試也這樣分）；
 *   - 搬位置：每個人形整個等比縮放（x、y、z 一起，仍是原形的相似形）、腳底對齊該排的腳底線，排成一排或多排，每排置中。
 *
 * 純函式、不碰 three／DOM，Node 與瀏覽器通用。
 */

import type { Shape } from './format';

/** 一個人形在配方座標裡的外框。 */
export interface FigureBox {
  minX: number;
  maxX: number;
  /** 腳底。 */
  minY: number;
  /** 頭頂。 */
  maxY: number;
}

export interface Arrangement {
  /** 每一排放哪幾個人形（索引對應中線的順序），由上到下；排內由左到右。每個人形恰好出現一次。 */
  rows: readonly (readonly number[])[];
  /** 每個人形在配方大小之上再乘的倍率。 */
  scale: number;
  /** 同一排相鄰人形外框之間的空隙（世界單位，不隨 scale 變）。 */
  gap: number;
  /** 上下兩排之間（上排腳底到下排最高處）的空隙（世界單位）。 */
  rowGap: number;
}

/** 世界座標的平移。 */
export interface Offset {
  x: number;
  y: number;
}

/** 取樣 x 屬於哪個人形：中線最近的那個。 */
export function figureIndexOf(x: number, centers: readonly number[]): number {
  let best = 0;
  for (let k = 1; k < centers.length; k++) {
    if (Math.abs(x - centers[k]!) < Math.abs(x - centers[best]!)) best = k;
  }
  return best;
}

/** 每個人形的外框（配方座標）。有人形一個取樣都沒有就丟 `RangeError`。 */
export function measureFigures(shape: Shape, centers: readonly number[]): FigureBox[] {
  const boxes: FigureBox[] = centers.map(() => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }));
  for (let i = 0; i < shape.count; i++) {
    const x = shape.positions[i * 3]!;
    const y = shape.positions[i * 3 + 1]!;
    const box = boxes[figureIndexOf(x, centers)]!;
    if (x < box.minX) box.minX = x;
    if (x > box.maxX) box.maxX = x;
    if (y < box.minY) box.minY = y;
    if (y > box.maxY) box.maxY = y;
  }
  boxes.forEach((box, k) => {
    if (!Number.isFinite(box.minX)) throw new RangeError(`Figure ${k} has no samples`);
  });
  return boxes;
}

function check(figureCount: number, a: Arrangement): void {
  if (!(Number.isFinite(a.scale) && a.scale > 0)) throw new RangeError(`Arrangement scale must be a positive finite number: ${a.scale}`);
  if (!(Number.isFinite(a.gap) && a.gap >= 0)) throw new RangeError(`Arrangement gap must be a non-negative finite number: ${a.gap}`);
  if (!(Number.isFinite(a.rowGap) && a.rowGap >= 0)) throw new RangeError(`Arrangement rowGap must be a non-negative finite number: ${a.rowGap}`);
  const seen = new Set<number>();
  for (const row of a.rows) {
    for (const k of row) {
      if (!Number.isInteger(k) || k < 0 || k >= figureCount) throw new RangeError(`Arrangement refers to a figure that does not exist: ${k}`);
      if (seen.has(k)) throw new RangeError(`Arrangement places figure ${k} twice`);
      seen.add(k);
    }
  }
  if (seen.size !== figureCount) throw new RangeError(`Arrangement must place all ${figureCount} figures, got ${seen.size}`);
}

const widthOf = (box: FigureBox): number => box.maxX - box.minX;
const heightOf = (box: FigureBox): number => box.maxY - box.minY;

/** 每一排的寬與高（已乘 scale）。 */
function rowSizes(boxes: readonly FigureBox[], a: Arrangement): { width: number; height: number }[] {
  return a.rows.map((row) => ({
    width: row.reduce((sum, k) => sum + widthOf(boxes[k]!) * a.scale, 0) + Math.max(0, row.length - 1) * a.gap,
    height: Math.max(...row.map((k) => heightOf(boxes[k]!))) * a.scale,
  }));
}

/** 排好之後整體的寬（最寬的一排）與高（各排的高加上排距）。 */
export function arrangedSize(boxes: readonly FigureBox[], a: Arrangement): { width: number; height: number } {
  check(boxes.length, a);
  const rows = rowSizes(boxes, a);
  return {
    width: Math.max(...rows.map((r) => r.width)),
    height: rows.reduce((sum, r) => sum + r.height, 0) + Math.max(0, rows.length - 1) * a.rowGap,
  };
}

/**
 * 依 `a` 把每個人形搬到新位置，回傳新的 `Shape`（點數、種類與點的順序不變，所以載入時依 tier 取前綴仍是同一個比例）。
 * 整體置中在 `offset.x`，最下面一排的腳底在 `offset.y`。
 */
export function arrangeFigures(shape: Shape, centers: readonly number[], boxes: readonly FigureBox[], a: Arrangement, offset: Offset = { x: 0, y: 0 }): Shape {
  check(boxes.length, a);
  const sizes = rowSizes(boxes, a);
  // 每個人形的新左緣 x 與腳底 y
  const left: number[] = [];
  const feet: number[] = [];
  let floor = offset.y;
  for (let r = a.rows.length - 1; r >= 0; r--) {
    const row = a.rows[r]!;
    let x = offset.x - sizes[r]!.width / 2;
    for (const k of row) {
      left[k] = x;
      feet[k] = floor;
      x += widthOf(boxes[k]!) * a.scale + a.gap;
    }
    floor += sizes[r]!.height + a.rowGap;
  }

  const positions = new Float32Array(shape.count * 3);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < shape.count; i++) {
    const k = figureIndexOf(shape.positions[i * 3]!, centers);
    const box = boxes[k]!;
    const x = left[k]! + (shape.positions[i * 3]! - box.minX) * a.scale;
    const y = feet[k]! + (shape.positions[i * 3 + 1]! - box.minY) * a.scale;
    const z = shape.positions[i * 3 + 2]! * a.scale;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  return { count: shape.count, positions, kinds: shape.kinds, min, max };
}
