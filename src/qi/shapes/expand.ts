/**
 * 形體 → 目標貼圖（D10、D13、D14）：把解碼後的 `Shape`（固定 N = 16 384 點）展開成 `size × size` 的 RGBA float 貼圖
 * （每格一個光點：xyz＝目標位置，w＝種類），GPGPU 的位置著色器照它拉彈簧。
 *
 *   - 環境煙（D14，占 7%）不進形體檔，執行時程序化產生，**所有姿勢共用同一批**：`ambientField` 決定「哪些格子是煙」與
 *     它們的位置，`expandTargets` 與 `flowTargets` 只是把它們原樣寫進各自的貼圖，換招時煙不會被拉進人形。
 *     煙格的 w ＝ −1（著色器據此畫成低亮度的飄煙）。
 *   - 其餘格子依序（索引由小到大）領形體的第 0、1、2…個取樣：N ≥ 格數就是取前綴（形體檔已打散序，前綴是同一個比例的縮影）；
 *     不夠就循環重複，重複的點（第 N 個起）在世界座標加每軸 ±0.006 的抖動（D10），好讓重疊的光點散成一層而不是疊成一個。
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
}

/** 環境煙占全部格子的比例（D14）。 */
const AMBIENT_SHARE = 0.07;
const AMBIENT_SEED = 7;
/** 煙的位置用另一條亂數序列（與 mask 的挑選分開），種子由 `seed` 衍生。 */
const AMBIENT_PLACE_SALT = 0x9e3779b9;
/** 重複點的抖動幅度（每軸 ±，世界單位；D10）。 */
const JITTER = 0.006;
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

/** 兵器的擺放（D13）：長度、傾角與中點高度依視窗寬窄（`wide`）取試作的數值。 */
export function weaponLayout(name: 'jian' | 'miaodao' | 'spear', wide: boolean): Layout {
  if (!Object.hasOwn(WEAPON_LAYOUT, name)) throw new RangeError(`Unknown weapon: ${String(name)}`);
  const [scale, rotZ] = WEAPON_LAYOUT[name][wide ? 'wide' : 'narrow'];
  return { scale, rotZ, offset: [0, WEAPON_MID_HEIGHT, 0] };
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
    const [ox, oy, oz] = layout.offset;
    const cos = Math.cos(layout.rotZ) * layout.scale;
    const sin = Math.sin(layout.rotZ) * layout.scale;
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
        laid[k * 3] = pivotX + (x - pivot) * layout.scale;
        laid[k * 3 + 1] = pivotY + y * layout.scale;
      } else {
        laid[k * 3] = x * cos - y * sin + ox;
        laid[k * 3 + 1] = x * sin + y * cos + oy;
      }
      laid[k * 3 + 2] = shape.positions[k * 3 + 2]! * layout.scale + oz;
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
      x += (jitter() * 2 - 1) * JITTER;
      y += (jitter() * 2 - 1) * JITTER;
      z += (jitter() * 2 - 1) * JITTER;
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
