/**
 * 把剪影取樣成 count 個光點的目標位置（人形形體）。規則搬自已刪除的 /lab/ 試作的 `shapes.ts`（歷史在 commit `e56a090`） 的 `sampleFigure`，
 * 改成純函式（輸入 alpha 陣列，不碰 canvas），好在 Node 的建置腳本與單元測試裡跑：
 *
 *   - 取樣網格 0.32（每 px 原圖縮成多少格），格內不透明像素過半才算「在剪影內」；
 *   - 距離場 chamfer 3-4（單位：格）；22% 的點取自輪廓帶（距離 < 1.7 格），其餘取自全部內部格；
 *   - 世界座標：每 px = WORLD_UNIT_PER_LAND_PX × scale，腳底（不透明外框底）對齊 y = 0，外框中線對齊 x = 0；
 *   - 厚度 `0.27·√min(depth/0.24, 1) + 0.025` 再加雜訊：離輪廓越遠越厚（軀幹厚、手腳薄）；
 *   - kind：輪廓帶 99，其餘 0–59（越靠近輪廓越大），`kindToW(kind)` 即試作的 w。
 *
 * 與試作不同的兩處：
 *   1. 點會落在「格內任一位置」，試作只看格是否在內，邊界格的點可能溢出輪廓一個格（約 3 px）；
 *      鏤空的負形（`fig-salute` 的雙手，佔剪影約 3%）很小，溢出會讓孔洞邊緣長出點。這裡每個點都回頭查原圖像素，
 *      落在透明處就在同一格內重抽，最後仍不行就取該格第一個不透明像素的中心——所以每個點必在不透明像素上。
 *   2. z 夾在 ±0.299 內（試作的公式上限約 0.354，只在最厚處的極端亂數才會超過），讓 z 厚度穩穩落在 0.30 之內。
 *
 * 環境煙（D14）不進檔。固定種子，同輸入逐位元相同。
 */

import { WORLD_UNIT_PER_LAND_PX } from '../config/figures';
import type { Shape } from './format';
import { OPAQUE } from './head';
import { rng } from './rng';

/** 取樣網格：每 px 原圖縮成多少格。 */
const GRID = 0.32;
/** 取自輪廓帶的比例。 */
const RIM_SHARE = 0.22;
/** 輪廓帶＝距離 < 1.7 格。 */
const RIM_DISTANCE = 1.7;
/** 在同一格內重抽的次數，之後改取該格第一個不透明像素。 */
const RETRIES = 8;
/** z 的絕對上限（世界單位）。略低於 0.30，留給 Float32 與 u16 量化的取整。 */
const Z_LIMIT = 0.299;

export interface FigureImage {
  /** 每像素一個 alpha（0–255），列優先。 */
  alpha: Uint8Array;
  width: number;
  height: number;
}

/** 內部到輪廓的距離（chamfer 3-4，單位：格）。 */
function insideDistance(mask: Uint8Array, w: number, h: number): Float32Array {
  const inf = 1e6;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? inf : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]!);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  for (let i = 0; i < d.length; i++) d[i] = d[i]! / 3;
  return d;
}

export function sampleFigure(img: FigureImage, scale: number, opts: { count: number; seed: number }): Shape {
  const { alpha, width, height } = img;
  const { count, seed } = opts;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || alpha.length !== width * height) {
    throw new RangeError(`剪影尺寸不符：alpha.length = ${alpha.length}，寬高 ${width}×${height}`);
  }
  if (!(scale > 0) || !Number.isFinite(scale)) throw new RangeError(`scale 必須是正數：${scale}`);
  if (!Number.isInteger(count) || count <= 0) throw new RangeError(`count 必須是正整數：${count}`);

  // 不透明外框（原解析度）：腳底與中線都以它為準
  let minX = width;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (alpha[row + x]! < OPAQUE) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      maxY = y;
    }
  }
  if (maxX < 0) throw new RangeError('剪影全透明，沒有東西可取樣');

  // 縮成取樣網格：每格記不透明像素數與總像素數
  const gw = Math.max(1, Math.round(width * GRID));
  const gh = Math.max(1, Math.round(height * GRID));
  const cellW = width / gw;
  const cellH = height / gh;
  const columnOf = new Int32Array(width);
  for (let x = 0; x < width; x++) columnOf[x] = Math.min(gw - 1, Math.floor(x / cellW));
  const hits = new Uint32Array(gw * gh);
  const total = new Uint32Array(gw * gh);
  for (let y = 0; y < height; y++) {
    const rowBase = Math.min(gh - 1, Math.floor(y / cellH)) * gw;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const cell = rowBase + columnOf[x]!;
      total[cell]!++;
      if (alpha[row + x]! >= OPAQUE) hits[cell]!++;
    }
  }
  const inside = new Uint8Array(gw * gh);
  let any = 0;
  for (let i = 0; i < inside.length; i++) {
    if (hits[i]! * 2 >= total[i]!) {
      inside[i] = 1;
      any++;
    }
  }
  if (any === 0) for (let i = 0; i < inside.length; i++) inside[i] = hits[i]! > 0 ? 1 : 0; // 極細的剪影：任何碰到的格都算
  const distance = insideDistance(inside, gw, gh);

  const cells: number[] = [];
  const rim: number[] = [];
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i]) continue;
    cells.push(i);
    if (distance[i]! < RIM_DISTANCE) rim.push(i);
  }

  const unit = WORLD_UNIT_PER_LAND_PX * scale; // 世界單位 / 原圖 px
  const cellWorld = unit * Math.sqrt(cellW * cellH); // 世界單位 / 格（距離換算用）
  const centerPx = (minX + maxX + 1) / 2;
  const footPx = maxY + 1;
  const random = rng(seed);

  const positions = new Float32Array(count * 3);
  const kinds = new Uint8Array(count);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < count; i++) {
    const fromRim = random() < RIM_SHARE;
    const pool = fromRim ? rim : cells;
    const cell = pool[Math.floor(random() * pool.length)]!;
    const cx = cell % gw;
    const cy = (cell - cx) / gw;

    // 格內位置：原圖上必須是不透明像素
    let px = 0;
    let py = 0;
    let found = false;
    for (let t = 0; t < RETRIES && !found; t++) {
      px = (cx + random()) * cellW;
      py = (cy + random()) * cellH;
      found = alpha[Math.min(height - 1, Math.floor(py)) * width + Math.min(width - 1, Math.floor(px))]! >= OPAQUE;
    }
    if (!found) {
      const x0 = Math.floor(cx * cellW);
      const x1 = Math.min(width, Math.ceil((cx + 1) * cellW));
      const y0 = Math.floor(cy * cellH);
      const y1 = Math.min(height, Math.ceil((cy + 1) * cellH));
      scan: for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++)
          if (alpha[y * width + x]! >= OPAQUE) {
            px = x + 0.5;
            py = y + 0.5;
            break scan;
          }
    }

    const depth = distance[cell]! * cellWorld;
    const thick = 0.27 * Math.sqrt(Math.min(depth / 0.24, 1)) + 0.025;
    let z = (random() * 2 - 1) * thick * (0.85 + random() * 0.3) + (random() - 0.5) * 0.03;
    z = Math.max(-Z_LIMIT, Math.min(Z_LIMIT, z));
    const x = (px - centerPx) * unit;
    const y = (footPx - py) * unit;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    kinds[i] = fromRim ? 99 : Math.round(Math.max(0, 1 - depth / 0.05) * 0.6 * 99);
    const stored = [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!]; // Float32 取整後的值
    for (let a = 0; a < 3; a++) {
      if (stored[a]! < min[a]!) min[a] = stored[a]!;
      if (stored[a]! > max[a]!) max[a] = stored[a]!;
    }
  }
  return { count, positions, kinds, min, max };
}
