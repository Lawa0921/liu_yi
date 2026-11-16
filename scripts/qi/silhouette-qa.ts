/**
 * 剪影機械品管閘門：純函式，輸入解碼後的 RGBA（只看 alpha 通道），回傳哪幾項不合格。
 * 只有 haze 的算法（遮罩 alpha > 127、半透明 8 < alpha < 247、離二值邊緣 > 2 px）與 `tools/silhouettes/postprocess.py`
 * 的 QA 區段相同；size／edge／stray／area 是這個閘門自己的規則。postprocess.py 對應的只有清理雜點（面積 < 16 px，
 * 或 < 300 px 且離主體 > 40 px 者移除）與回報度量，不做通過／不通過的判定；本檔的 stray 更嚴：最大 8 連通元件
 * 要 ≥ 遮罩面積 97%，且不留任何離主體 > 40 px 的小元件。
 * 測試在 `tests/unit/silhouette-qa.test.ts`（合成影像）與 `tests/unit/silhouette-assets.test.ts`（入庫素材，.png 與 .webp）。
 * 不依賴 sharp 或 Astro，解碼由呼叫端負責。
 */

export interface QaResult {
  ok: boolean;
  /** 元素為 'size'｜'edge'｜'stray'｜'haze'｜'area'，依這個固定順序排列。 */
  failures: string[];
}

/** 遮罩＝alpha > 127。 */
const MASK_ALPHA = 127;
/** size：寬高皆須 ≥ 500。 */
const MIN_SIDE = 500;
/** edge：遮罩外框離四邊至少 6 px。 */
const MIN_MARGIN = 6;
/** stray：最大 8 連通元件至少要占遮罩面積的 97%。 */
const MIN_MAIN_SHARE = 0.97;
/** stray：其餘（< 3%）的小元件離主體超過 40 px 就是遠處的雜點。 */
const STRAY_DISTANCE = 40;
/** haze：半透明（8 < alpha < 247）只允許出現在二值邊緣 2 px 內。 */
const HAZE_BAND = 2;
const HAZE_LOW = 8;
const HAZE_HIGH = 247;
/** area：遮罩面積占整張的比例（含邊界）。 */
const AREA_MIN = 0.12;
const AREA_MAX = 0.55;

/** 半徑 2 的圓盤偏移（x² + y² ≤ 4），與 postprocess.py 的 `disk(2)` 相同。 */
const BAND_OFFSETS: ReadonlyArray<readonly [number, number]> = (() => {
  const offsets: Array<[number, number]> = [];
  for (let dy = -HAZE_BAND; dy <= HAZE_BAND; dy++) {
    for (let dx = -HAZE_BAND; dx <= HAZE_BAND; dx++) {
      if (dx * dx + dy * dy <= HAZE_BAND * HAZE_BAND && (dx !== 0 || dy !== 0)) offsets.push([dx, dy]);
    }
  }
  return offsets;
})();

interface Components {
  /** 每個像素的元件編號，0＝背景，編號從 1 起。 */
  labels: Int32Array;
  /** `areas[i]` 是編號 i + 1 的像素數。 */
  areas: number[];
}

/** 8 連通元件標記（迭代式，避免遞迴爆堆疊）。 */
function labelComponents(mask: Uint8Array, width: number, height: number): Components {
  const labels = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  const areas: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = areas.length + 1;
    let area = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top > 0) {
      const at = stack[--top]!;
      area++;
      const x = at % width;
      const y = (at - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (mask[next] && !labels[next]) {
            labels[next] = id;
            stack[top++] = next;
          }
        }
      }
    }
    areas.push(area);
  }
  return { labels, areas };
}

/** 一維平方距離轉換（Felzenszwalb & Huttenlocher）：`f` 為 0（來源）或夠大的數，結果寫入 `d`。 */
function distanceTransform1d(f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array, n: number): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dq = q - v[k]!;
    d[q] = dq * dq + f[v[k]!]!;
  }
}

/** 每個像素到最近「來源像素」的歐氏距離平方（來源＝`isSource` 為 true 的像素）。 */
function squaredDistanceTo(isSource: (index: number) => boolean, width: number, height: number): Float64Array {
  const big = width * width + height * height + 1; // 大於任何真實的距離平方
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = isSource(i) ? 0 : big;
  const size = Math.max(width, height);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]!;
    distanceTransform1d(f, d, v, z, height);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y]!;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x]!;
    distanceTransform1d(f, d, v, z, width);
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x]!;
  }
  return grid;
}

/** stray：最大元件不到遮罩的 97%，或有離主體 > 40 px 的小元件。 */
function hasStray(mask: Uint8Array, width: number, height: number, maskArea: number): boolean {
  const { labels, areas } = labelComponents(mask, width, height);
  if (areas.length <= 1) return false;
  let mainId = 1;
  for (let i = 1; i < areas.length; i++) if (areas[i]! > areas[mainId - 1]!) mainId = i + 1;
  if (areas[mainId - 1]! < MIN_MAIN_SHARE * maskArea) return true;

  // 其餘元件加起來 < 3%：近處的碎塊可以接受，遠處的雜點不行
  const dist2 = squaredDistanceTo((i) => labels[i] === mainId, width, height);
  const nearest = new Float64Array(areas.length + 1).fill(Infinity);
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i]!;
    if (id !== 0 && id !== mainId && dist2[i]! < nearest[id]!) nearest[id] = dist2[i]!;
  }
  return nearest.some((d2, id) => id !== 0 && id !== mainId && d2 > STRAY_DISTANCE * STRAY_DISTANCE);
}

/** haze：半透明像素離二值邊緣（遮罩內外分界）超過 2 px 的個數；影像外視為背景（與 postprocess.py 的侵蝕一致）。 */
function hazePixels(rgba: Uint8Array, mask: Uint8Array, width: number, height: number): number {
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      const alpha = rgba[at * 4 + 3]!;
      if (alpha <= HAZE_LOW || alpha >= HAZE_HIGH) continue;
      // 離二值邊緣 ≤ 2 px ⇔ 圓盤內有像素的遮罩狀態和自己不同
      let inBand = false;
      for (const [dx, dy] of BAND_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        const inside = nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx] === 1;
        if (inside !== (mask[at] === 1)) {
          inBand = true;
          break;
        }
      }
      if (!inBand) count++;
    }
  }
  return count;
}

export function checkSilhouette(rgba: Uint8Array, width: number, height: number): QaResult {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`寬高必須是正整數，收到 ${width}×${height}`);
  }
  if (rgba.length !== width * height * 4) {
    throw new Error(`rgba 長度 ${rgba.length} 與 ${width}×${height}×4 = ${width * height * 4} 不符`);
  }

  const mask = new Uint8Array(width * height);
  let maskArea = 0;
  let x0 = width;
  let x1 = -1;
  let y0 = height;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3]! <= MASK_ALPHA) continue;
      mask[y * width + x] = 1;
      maskArea++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }

  const failures: string[] = [];
  if (width < MIN_SIDE || height < MIN_SIDE) failures.push('size');
  // 沒有遮罩就沒有外框與元件可判，只靠 area 擋下
  if (maskArea > 0 && Math.min(x0, y0, width - 1 - x1, height - 1 - y1) < MIN_MARGIN) failures.push('edge');
  if (maskArea > 0 && hasStray(mask, width, height, maskArea)) failures.push('stray');
  if (hazePixels(rgba, mask, width, height) > 0) failures.push('haze');
  const ratio = maskArea / (width * height);
  if (ratio < AREA_MIN || ratio > AREA_MAX) failures.push('area');
  return { ok: failures.length === 0, failures };
}
