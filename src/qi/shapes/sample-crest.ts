/**
 * 光點館徽的取樣（Task 25，預約段）：把 Task 24 的透明底館徽（`src/assets/images/crest-lion.png`，金色線條、亮度當不透明度）
 * 取樣成 count 個光點的目標位置。純函式（輸入 alpha 陣列，不碰 canvas），Node 與瀏覽器通用；實際只在建置時由 `scripts/qi/build-shapes.ts` 呼叫。
 *
 *   - 取樣機率正比於 alpha 的 `ALPHA_POWER` 次方：亮線（不透明）多取、半透明的反鋸齒邊與暗面少取，所以金線的輪廓清楚，
 *     而不是把整個獅子糊成一塊（獅子的毛、浪、捲紋都是細線，點數固定 16 384，要集中在線上）。完全透明的像素不取。
 *   - 世界座標：x 向右、y 向上；圖中心在 (0, `CREST_CENTER_Y`)，全寬 `CREST_WORLD_WIDTH`。每個點在所屬像素內均勻抖動，z 只有薄薄 ±`DEPTH`。
 *   - 種類全部是 `KIND.CREST`（金，著色器裡比人形的金偏暖、不帶朱紅）。
 * 固定種子，同輸入逐位元相同。
 */

import { CREST_CENTER_Y, CREST_WORLD_WIDTH } from '../config/shapes';
import { KIND, type Shape } from './format';
import { rng } from './rng';

/** 取樣用的圖：每像素一個 alpha（0–255，列優先）。與 `sample-figure.ts` 的 `FigureImage` 結構相同（那個檔案是 Node 專用，這裡不 import 它）。 */
export interface CrestImage {
  alpha: Uint8Array;
  width: number;
  height: number;
}

/** 取樣機率 ∝ (alpha / 255) ^ 這個次方：越大越集中在最亮的線上。 */
const ALPHA_POWER = 2.5;
/** 館徽很薄：z 在 ±這個值內（世界單位）。 */
const DEPTH = 0.02;

export function sampleCrest(img: CrestImage, opts: { count: number; seed: number }): Shape {
  const { alpha, width, height } = img;
  const { count, seed } = opts;
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`Crest sample count must be a positive integer: ${count}`);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || alpha.length !== width * height) {
    throw new RangeError(`Crest image ${width}×${height} does not match its alpha length ${alpha.length}`);
  }

  // 累積權重：第 i 個像素的區間是 (cumulative[i − 1], cumulative[i]]；權重 0 的像素區間為空，永遠抽不到
  const cumulative = new Float64Array(alpha.length);
  let total = 0;
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i]!;
    if (a > 0) total += (a / 255) ** ALPHA_POWER;
    cumulative[i] = total;
  }
  if (!(total > 0)) throw new RangeError('Crest image is fully transparent: nothing to sample');

  const unit = CREST_WORLD_WIDTH / width;
  const random = rng(seed);
  const positions = new Float32Array(count * 3);
  const kinds = new Uint8Array(count).fill(KIND.CREST);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const target = random() * total;
    // 二分搜尋：第一個累積權重 > target 的像素（區間為空的像素不會被選到，因為它的累積值等於前一個）
    let lo = 0;
    let hi = alpha.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cumulative[mid]! > target) hi = mid;
      else lo = mid + 1;
    }
    const px = (lo % width) + random();
    const py = Math.floor(lo / width) + random();
    positions[i * 3] = (px - width / 2) * unit;
    positions[i * 3 + 1] = CREST_CENTER_Y + (height / 2 - py) * unit;
    positions[i * 3 + 2] = (random() * 2 - 1) * DEPTH;
    for (let k = 0; k < 3; k++) {
      const v = positions[i * 3 + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { count, positions, kinds, min, max };
}
