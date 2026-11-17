/**
 * 形體 → 目標貼圖（D10、D13、D14）：把解碼後的 `Shape`（固定 N = 16 384 點）展開成 `size × size` 的 RGBA float 貼圖
 * （每格一個光點：xyz＝目標位置，w＝種類），GPGPU 的位置著色器照它拉彈簧。
 *
 *   - 環境煙（D14，占 7%）不進形體檔，執行時程序化產生，**所有姿勢共用同一批**：`ambientField` 決定「哪些格子是煙」與
 *     它們的位置，`expandTargets` 與 `flowTargets` 只是把它們原樣寫進各自的貼圖，換招時煙不會被拉進人形。
 *     煙格的 w ＝ −1（著色器據此畫成低亮度的飄煙）。
 *   - 其餘格子依序（索引由小到大）領形體的第 0、1、2…個取樣：N ≥ 格數就是取前綴（形體檔已打散序，前綴是同一個比例的縮影）；
 *     不夠就循環重複，重複的點（第 N 個起）在世界座標加每軸 ±`JITTER`（0.006）的抖動（D10），好讓重疊的光點散成一層而不是疊成一個；
 *     細線條的光點館徽（`KIND.CREST`）只抖 `CREST_JITTER`（0.002），線條才不糊（每個點依自己的種類，亂數的取用數不變）。
 *     抖動只取決於「第幾個點」，不取決於姿勢，所以同一批光點換姿勢時的微動一致。
 *   - 兵器（D13）：形體檔存的是「長軸 +x、鋒尖朝 +x、置中、全長 1」的單位形；`Layout` 依視窗比例把它縮放、繞 z 轉、平移到位。
 *     抖動在 layout 之後加（世界單位），不會被兵器的 scale 放大。紅纓（RED）掛著、順著重力垂下：兵器傾斜時
 *     纓穗以紮點為軸反向轉回，仍朝下（試作的 pendulum 反向旋轉）。
 *
 * 純函式、固定種子：同輸入逐位元相同。不碰 three／DOM，Node 與瀏覽器通用。
 */

import { KIND, kindToW, type Shape } from './format';
import { rng } from './rng';

export interface AmbientField {
  /** 長度 count；1 ＝ 這一格是環境煙。 */
  mask: Uint8Array;
  /** xyz 交錯，長度 count × 3；只有 `mask` 為 1 的格子有值，其餘是 0。 */
  positions: Float32Array;
}

export interface Layout {
  scale: number;
  /** 繞 z 軸的旋轉（弧度，逆時針；鋒尖朝右上為正）。 */
  rotZ: number;
  offset: [number, number, number];
  /**
   * 擺好之後最右邊的光點（世界 x）不得超過它：超過就把整把兵器等比例縮小（以 `offset` 為中心；`rotZ`、中點高度不變）。
   * 寬螢幕的右緣有段落導覽，大槍原本的長度會壓到它（Task 22b，數字見 `engine/framing.ts` 的 `weaponReachFor`）。
   * 只縮、不放大；用形體實際最右的點量（形體檔的 x 範圍約 ±0.6，比「全長 1」的假設略長），不是靠長度推算。
   */
  maxRight?: number;
  /**
   * 擺好之後最左邊的光點（世界 x）不得小於它（文字欄之後才是兵器的地盤）：左端超過就整把往右推（長度不變），
   * 推到右端到 `maxRight` 還放不下，才縮到剛好塞進 `minLeft`…`maxRight` 的窗裡（縮的中心是 `offset`，之後再推）。
   */
  minLeft?: number;
  /**
   * 槽取景（Task 26，非首頁的頁面）：擺好之後所有光點都要落在這個視窗內（以世界的 (0, cy) 為中心，半寬 `halfWidth`、半高 `halfHeight`；
   * 見 `engine/slot.ts`）。超過就以 `offset` 為中心等比例縮小；只縮、不放大。
   */
  window?: LayoutWindow;
}

/** 槽在世界座標裡的視窗（`engine/slot.ts` 的 `SlotFrame`）。 */
export interface LayoutWindow {
  halfWidth: number;
  halfHeight: number;
  cy: number;
}

/** 兵器的左右窗（`minLeft` 到 `maxRight`）至少這麼寬（世界單位，約人形半高）：再窄就不縮了，免得擺出長度接近 0 的兵器。 */
const WEAPON_MIN_SPAN = 1;

/** 環境煙占全部格子的比例（D14）。 */
const AMBIENT_SHARE = 0.07;
const AMBIENT_SEED = 7;
/** 煙的位置用另一條亂數序列（與 mask 的挑選分開），種子由 `seed` 衍生。 */
const AMBIENT_PLACE_SALT = 0x9e3779b9;
/** 重複點的抖動幅度（每軸 ±，世界單位；D10）。 */
export const JITTER = 0.006;
/**
 * 光點館徽（`KIND.CREST`）的重複點抖動：細線條的館徽（鬃毛、捲紋、浪紋）一條線只有一兩個點寬，
 * 被 0.006 的抖動（加上著色器的顆粒）散開就糊成一片（Task 25 審查）。降到 0.002：重疊的點仍散成一層，但線條保持清楚。
 * 其他形體不變。
 */
export const CREST_JITTER = 0.002;
const CREST_W = kindToW(KIND.CREST);
const JITTER_SEED = 0x6a17;

/** 試作的兵器擺放（D13）：寬螢幕與窄螢幕各自的全長（世界單位）與傾角（弧度，鋒尖朝右上）。 */
const WEAPON_LAYOUT: Record<'jian' | 'miaodao' | 'spear', { wide: [number, number]; narrow: [number, number] }> = {
  jian: { wide: [2.9, 0.16], narrow: [1.9, 0.5] },
  miaodao: { wide: [3.2, 0.22], narrow: [2.1, 0.55] },
  spear: { wide: [3.8, 0.05], narrow: [2.3, 0.45] },
};
/** 兵器中點的世界高度（與人形身高一半同一帶）。 */
const WEAPON_MID_HEIGHT = 1.05;

/** 收費段的氣流範圍（世界單位）：每個軸都比環境煙（x ±5.8、y −0.2–3.4、z −5.4–3.8）寬。 */
const FLOW_SEED = 0x0f10;
const FLOW_HALF_WIDTH = 7.5;
const FLOW_Z_CENTER = -0.8;
const FLOW_Z_HALF = 6;
const FLOW_Y_CENTER = 1.2;
const FLOW_Y_WAVE = 1.3;
const FLOW_Y_SPREAD = 1.7;
const FLOW_WAVE_FREQUENCY = 0.55;

/** `size × size` 的格數；`size` 必須是正整數。 */
function cellCount(size: number): number {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`Texture size must be a positive integer: ${size}`);
  return size * size;
}

function checkAmbient(ambient: AmbientField, cells: number): void {
  if (ambient.mask.length !== cells) throw new RangeError(`Ambient field has ${ambient.mask.length} cells but the texture has ${cells}`);
  if (ambient.positions.length !== cells * 3) throw new RangeError(`Ambient field positions length ${ambient.positions.length} does not match cells × 3 (${cells * 3})`);
}

/** 把共用的那一格煙寫進貼圖。 */
function writeAmbient(out: Float32Array, i: number, ambient: AmbientField): void {
  out[i * 4] = ambient.positions[i * 3]!;
  out[i * 4 + 1] = ambient.positions[i * 3 + 1]!;
  out[i * 4 + 2] = ambient.positions[i * 3 + 2]!;
  out[i * 4 + 3] = -1;
}

/**
 * 環境煙：哪些格子是煙（約 7%）與它們的位置。位置是人物四周一個扁的殼（近的稀、遠的多），背景才有一層煙；
 * 搬自試作的 `ambientMask`／`fillAmbient`。固定種子，每次載入都長一樣。
 */
export function ambientField(count: number, seed: number = AMBIENT_SEED): AmbientField {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`Ambient cell count must be a non-negative integer: ${count}`);
  const pick = rng(seed);
  const place = rng((seed ^ AMBIENT_PLACE_SALT) >>> 0);
  const mask = new Uint8Array(count);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    if (!(pick() < AMBIENT_SHARE)) continue;
    mask[i] = 1;
    const angle = place() * Math.PI * 2;
    const radius = 1.3 + Math.pow(place(), 0.7) * 4.5;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = -0.2 + place() * 3.6;
    positions[i * 3 + 2] = Math.sin(angle) * radius * 0.8 - 0.8;
  }
  return { mask, positions };
}

/**
 * 兵器的擺放（D13）：長度、傾角與中點高度依視窗寬窄（`wide`）取試作的數值。
 * `maxRight`／`minLeft`（寬版才有意義）：最右、最左的光點不得超出這個世界 x 範圍（見 `Layout.maxRight`、`Layout.minLeft`）；
 * 窄版（直向）沒有右緣導覽、文字在下方，不套用。兩個都給而窗太窄（< `WEAPON_MIN_SPAN`）時把 `minLeft` 往左放寬到剛好那麼寬。
 */
export function weaponLayout(name: 'jian' | 'miaodao' | 'spear', wide: boolean, maxRight?: number, minLeft?: number, window?: LayoutWindow): Layout {
  if (!Object.hasOwn(WEAPON_LAYOUT, name)) throw new RangeError(`Unknown weapon: ${String(name)}`);
  if (window !== undefined && !(Number.isFinite(window.halfWidth) && window.halfWidth > 0 && Number.isFinite(window.halfHeight) && window.halfHeight > 0 && Number.isFinite(window.cy))) {
    throw new RangeError('Weapon window must have a positive finite half width and half height');
  }
  if (maxRight !== undefined && !(Number.isFinite(maxRight) && maxRight > 0)) throw new RangeError(`Weapon maxRight must be a positive finite number: ${maxRight}`);
  if (minLeft !== undefined && !Number.isFinite(minLeft)) throw new RangeError(`Weapon minLeft must be a finite number: ${minLeft}`);
  const [scale, rotZ] = WEAPON_LAYOUT[name][wide ? 'wide' : 'narrow'];
  const layout: Layout = { scale, rotZ, offset: [0, WEAPON_MID_HEIGHT, 0] };
  if (wide && maxRight !== undefined) layout.maxRight = maxRight;
  if (wide && minLeft !== undefined) layout.minLeft = maxRight !== undefined ? Math.min(minLeft, maxRight - WEAPON_MIN_SPAN) : minLeft;
  if (window !== undefined) layout.window = window;
  return layout;
}

/**
 * 紅纓（`KIND.RED`）的紮點在單位形長軸上的位置（x）；沒有紅點就是 `null`。
 * 單位形的長軸就是 x 軸（y = 0），纓穗從紮點往 −y 垂（`sample-weapon.ts`），所以紅點 x 的平均就是紮點。
 */
function tasselPivot(shape: Shape): number | null {
  let sum = 0;
  let n = 0;
  for (let k = 0; k < shape.count; k++) {
    if (shape.kinds[k] !== KIND.RED) continue;
    sum += shape.positions[k * 3]!;
    n++;
  }
  return n > 0 ? sum / n : null;
}

/** 把形體的每個取樣依 `layout`（長度以 `scale` 為準、整把再往右推 `dx`）擺到世界座標；紅纓掛著、順著重力垂下（見檔頭）。 */
function layOut(shape: Shape, layout: Layout, scale: number, dx = 0): Float64Array {
  const { count } = shape;
  const [ox0, oy, oz] = layout.offset;
  const ox = ox0 + dx;
  const cos = Math.cos(layout.rotZ) * scale;
  const sin = Math.sin(layout.rotZ) * scale;
  // 紅纓是掛著的，順著重力垂下：兵器傾斜時纓穗不跟著傾斜。試作把纓穗（pendulum）反向旋轉；這裡等價於
  // 「紅點相對紮點只受 scale 影響（不轉）」：紮點隨兵器轉到位，纓穗從紮點起仍朝下。
  const pivot = tasselPivot(shape);
  const pivotX = pivot !== null ? pivot * cos + ox : 0;
  const pivotY = pivot !== null ? pivot * sin + oy : 0;
  const laid = new Float64Array(count * 3);
  for (let k = 0; k < count; k++) {
    const x = shape.positions[k * 3]!;
    const y = shape.positions[k * 3 + 1]!;
    if (pivot !== null && shape.kinds[k] === KIND.RED) {
      laid[k * 3] = pivotX + (x - pivot) * scale;
      laid[k * 3 + 1] = pivotY + y * scale;
    } else {
      laid[k * 3] = x * cos - y * sin + ox;
      laid[k * 3 + 1] = x * sin + y * cos + oy;
    }
    laid[k * 3 + 2] = shape.positions[k * 3 + 2]! * scale + oz;
  }
  return laid;
}

/**
 * 把 `shape` 展開成 `size × size × 4` 的目標貼圖（xyz＋w）。
 * w：人形 0–1（靠近輪廓的程度）、兵器 2–6、朱印 7（`kindToW`）、環境煙 −1。
 */
export function expandTargets(shape: Shape, size: number, ambient: AmbientField, layout?: Layout): Float32Array {
  const cells = cellCount(size);
  checkAmbient(ambient, cells);
  const { count } = shape;
  if (!(count > 0)) throw new RangeError('Shape has no samples to expand');
  if (shape.positions.length < count * 3 || shape.kinds.length < count) throw new RangeError('Shape positions/kinds are shorter than count');

  // 每個取樣只算一次：套 layout（沒給就原樣）與 kind → w
  let base: ArrayLike<number> = shape.positions;
  if (layout) {
    let scale = layout.scale;
    let laid = layOut(shape, layout, scale);
    const extent = (points: Float64Array): { left: number; right: number } => {
      let left = Infinity;
      let right = -Infinity;
      for (let k = 0; k < count; k++) {
        left = Math.min(left, points[k * 3]!);
        right = Math.max(right, points[k * 3]!);
      }
      return { left, right };
    };
    const ox = layout.offset[0];
    if (layout.maxRight !== undefined) {
      // 最右的光點超過上限就等比例縮小：擺放對 scale 是線性的（以 offset 為中心），第二次算就是精確值
      const { right } = extent(laid);
      if (right > layout.maxRight && right > ox) {
        scale = (scale * (layout.maxRight - ox)) / (right - ox);
        laid = layOut(shape, layout, scale);
      }
    }
    if (layout.minLeft !== undefined) {
      let { left, right } = extent(laid);
      if (left < layout.minLeft) {
        // 左端伸進文字欄：先試著整把往右推；右端會超過上限（窗比兵器窄）才縮到剛好塞進窗裡再推
        const span = layout.maxRight !== undefined ? layout.maxRight - layout.minLeft : Infinity;
        if (right - left > span && right > left) {
          scale *= span / (right - left);
          ({ left, right } = extent(layOut(shape, layout, scale)));
        }
        laid = layOut(shape, layout, scale, layout.minLeft - left);
      }
    }
    if (layout.window) {
      // 槽取景：以 offset 為中心量最大的水平、垂直偏移，超過視窗就等比例縮（擺放對 scale 是線性的，第二次算就是精確值）
      const { halfWidth, halfHeight, cy } = layout.window;
      const oy = layout.offset[1];
      let reachX = 0;
      let reachY = 0;
      for (let k = 0; k < count; k++) {
        reachX = Math.max(reachX, Math.abs(laid[k * 3]! - ox));
        reachY = Math.max(reachY, Math.abs(laid[k * 3 + 1]! - oy));
      }
      const roomX = Math.max(halfWidth - Math.abs(ox), 0.05);
      const roomY = Math.max(halfHeight - Math.abs(oy - cy), 0.05);
      const shrink = Math.min(1, reachX > 0 ? roomX / reachX : 1, reachY > 0 ? roomY / reachY : 1);
      if (shrink < 1) laid = layOut(shape, layout, scale * shrink);
    }
    base = laid;
  }
  const w = new Float32Array(count);
  for (let k = 0; k < count; k++) w[k] = kindToW(shape.kinds[k]!);

  const out = new Float32Array(cells * 4);
  const jitter = rng(JITTER_SEED);
  let j = 0; // 第幾個非環境煙的點
  for (let i = 0; i < cells; i++) {
    if (ambient.mask[i]) {
      writeAmbient(out, i, ambient);
      continue;
    }
    const k = j % count;
    let x = base[k * 3]!;
    let y = base[k * 3 + 1]!;
    let z = base[k * 3 + 2]!;
    if (j >= count) {
      const spread = w[k] === CREST_W ? CREST_JITTER : JITTER; // 每個點依自己的種類；亂數的取用數不變
      x += (jitter() * 2 - 1) * spread;
      y += (jitter() * 2 - 1) * spread;
      z += (jitter() * 2 - 1) * spread;
    }
    out[i * 4] = x;
    out[i * 4 + 1] = y;
    out[i * 4 + 2] = z;
    out[i * 4 + 3] = w[k]!;
    j++;
  }
  return out;
}

/**
 * 收費段的氣流目標（`flow` 姿勢）：全部的點都是緩流（w ＝ −1，著色器當低亮度的氣畫）。
 * 環境煙那批格子沿用共用的位置；其餘的點散在比環境煙更寬的一帶（x 兩側、y 上下、z 前後都更遠），
 * 沿 x 帶一點起伏，讀起來像一道緩緩流過的氣。程序化、固定種子，沒有形體檔。
 */
export function flowTargets(size: number, ambient: AmbientField): Float32Array {
  const cells = cellCount(size);
  checkAmbient(ambient, cells);
  const out = new Float32Array(cells * 4);
  const random = rng(FLOW_SEED);
  for (let i = 0; i < cells; i++) {
    if (ambient.mask[i]) {
      writeAmbient(out, i, ambient);
      continue;
    }
    const x = (random() * 2 - 1) * FLOW_HALF_WIDTH;
    // 兩個均勻亂數相加（三角分布）：中線附近比較密，往上下兩側漸疏
    const spread = (random() + random() - 1) * FLOW_Y_SPREAD;
    out[i * 4] = x;
    out[i * 4 + 1] = FLOW_Y_CENTER + Math.sin(x * FLOW_WAVE_FREQUENCY) * FLOW_Y_WAVE + spread;
    out[i * 4 + 2] = FLOW_Z_CENTER + (random() * 2 - 1) * FLOW_Z_HALF;
    out[i * 4 + 3] = -1;
  }
  return out;
}
