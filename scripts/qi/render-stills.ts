/**
 * 靜態圖產線（D19）：在建置時由 Node 的 `sharp` 從 `.bin` 形體檔渲出首屏用的 WebP，不依賴 headless 瀏覽器。
 * 靜態圖是 three 還沒到之前顯示的畫面（也是「減少動態」「沒有 WebGL2」的退回畫面），所以要像引擎的終態：
 * 金色光點、亮輪廓、內部有流動感；朱紅只用在兵器的纓、朱印與零星的火星。
 *
 * 渲染（`renderStill`）：
 *   1. 取景：形體的 xy 外框置中、等比放大到佔滿影像的 80% 高或 88% 寬（先到者為準）；暗底 `#0b0a09`。
 *   2. Float32 加色高斯點：每個形體點一顆，顏色與透明度照引擎（試作 `src/lab/qi/shaders.ts`）——人形由金到米白、
 *      靠輪廓越近越亮；鋼＝米白、銅＝金、暗色＝暗金、氣＝很淡的金；朱印＝朱紅。光點半徑隨形體在影像上的大小而定
 *      （點數固定為 16 384，形體越大點越要大才蓋得住）。人形再疊三樣東西：
 *      沿身體縱向流動的「氣脈」（亮度與色相的起伏，加上深處的霧與短尾筆觸；都只放在離輪廓夠遠的深處，
 *      不會碰到輪廓或鏤空的負形，例如 `salute` 的雙手）、0.6% 的朱紅火星，
 *      以及貼在形體周圍的環境煙（D14 的 7%，很淡、範圍隨形體大小，不是滿版）。
 *   3. 紅纓（`KIND.RED`）與火星是「畫上去」的朱紅：除了加一點光，還累積覆蓋度，合成時蓋掉底下的金光。
 *      純加色會被周圍的金色氣與鋼的光暈洗成橘粉。
 *   4. 色調映射：ACES filmic（與引擎同一條曲線，曝光 1.05）與「保色相」版本（只壓亮度、不讓顏色漂向白）混合，
 *      再做 sRGB 編碼；暗底另外加回去，所以沒有光的地方恰是底色。
 *   5. 光暈：各色獨立壓縮（x / (1 + x)）的光編成 8-bit sRGB，交給 `sharp.blur` 做兩層高斯模糊（近的緊、遠的柔），
 *      換回線性空間疊回去。光暈只跟著點走，強度由 `glow` 控制；`glow = 0` 就是純光點。
 *      （sharp 的 raw 輸入只吃 8-bit，所以光暈在編碼後的空間裡模糊：暗部不會出現階梯。）
 *   6. WebP 編碼。
 *
 * 產出（`renderAllStills`）：`hero-wide.webp`（1440×810）與 `hero-tall.webp`（780×1280）由 `land` 渲出；
 * 每個形體各一張 `<id>.webp`（1000×750）；`stills.json` ＝ `{ [name]: { width, height, bytes } }`（name 不含副檔名）。
 * 兵器的 `.bin` 是橫放的單位形，靜態圖照引擎寬螢幕的擺法加上仰角（`WEAPON_TILT`）。
 *
 * 寫檔紀律同 `build-shapes.ts`：先全部渲到 `outDir/.staging/`，都成功才換入；換入前先刪 `stills.json`；
 * 失敗不留看起來完整的混雜產物（沒有 `stills.json` 也沒有 `.inputs-hash`），下一次整批重建；`.staging` 的清理是盡力而為。
 * 輸入雜湊 ＝ 各 `.bin` 的內容雜湊＋本檔與 `hash.ts`、`format.ts`、`rng.ts` 的原始碼＋sharp 版本；沒變、檔案齊全就跳過。
 *
 * 固定種子（由名稱雜湊而來）＋純函式渲染：同輸入逐位元相同。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { decodeShape, KIND, type Shape } from '../../src/qi/shapes/format';
import { rng } from '../../src/qi/shapes/rng';
import { hashInputs, sha256 } from './hash';

/** 渲染邏輯的版本（改了畫法但原始碼雜湊沒涵蓋到的地方，例如調參數以外的格式變動，手動加一）。 */
const STILL_VERSION = 1;
const HASH_FILE = '.inputs-hash';
const MANIFEST = 'stills.json';
const STAGING = '.staging';

// ── 色彩（與引擎同一組，見試作 `src/lab/qi/main.ts`）───────────────────────────
const BACKGROUND = '#0b0a09';
const GOLD = '#b3924f';
const PAPER = '#f1e3c6';
const SEAL = '#b3261e';
const EXPOSURE = 1.05;

type Vec3 = readonly [number, number, number];

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function hexToLinear(hex: string): Vec3 {
  const n = Number.parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}
const C_BG = hexToLinear(BACKGROUND);
const C_GOLD = hexToLinear(GOLD);
const C_PAPER = hexToLinear(PAPER);
const C_SEAL = hexToLinear(SEAL);
/** 朱紅覆蓋層的顏色（線性）：比印色亮一點。 */
const C_VERMILION: Vec3 = [C_SEAL[0] * 1.6, C_SEAL[1] * 1.6, C_SEAL[2] * 1.6];

/** 線性 [0,1] → sRGB 的 8-bit 值；查表（16 384 格）比逐點 pow 快一個量級。 */
const ENCODE_STEPS = 16384;
const ENCODE_LUT = new Uint8Array(ENCODE_STEPS + 1);
for (let i = 0; i <= ENCODE_STEPS; i++) {
  const c = i / ENCODE_STEPS;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  ENCODE_LUT[i] = Math.round(s * 255);
}
const encode = (linear: number): number => ENCODE_LUT[Math.round(Math.min(1, Math.max(0, linear)) * ENCODE_STEPS)]!;
/** 8-bit sRGB → 線性。 */
const DECODE_LUT = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));

/** ACES 的 RRT／ODT 擬合曲線（Stephen Hill；three.js 的 `ACESFilmicToneMapping` 用的同一條）。 */
const acesFit = (v: number): number => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
/** 保色相版本占的比例：0 ＝ 純 ACES，1 ＝ 只壓亮度。 */
const HUE_KEEP = 0.65;

/** 色調映射：輸入線性 RGB（未乘曝光），輸出線性 [0, 1] 寫進 out[o..o+2]。 */
function toneMap(r: number, g: number, b: number, out: Float32Array, o: number): void {
  const k = EXPOSURE / 0.6;
  r *= k;
  g *= k;
  b *= k;
  // ACES：輸入矩陣 → 擬合 → 輸出矩陣（與 three.js 同）
  const fr = acesFit(0.59719 * r + 0.35458 * g + 0.04823 * b);
  const fg = acesFit(0.076 * r + 0.90834 * g + 0.01566 * b);
  const fb = acesFit(0.0284 * r + 0.13383 * g + 0.83777 * b);
  const ar = Math.min(1, Math.max(0, 1.60475 * fr - 0.53108 * fg - 0.07367 * fb));
  const ag = Math.min(1, Math.max(0, -0.10208 * fr + 1.10813 * fg - 0.00605 * fb));
  const ab = Math.min(1, Math.max(0, -0.00327 * fr - 0.07276 * fg + 1.07602 * fb));
  // 保色相：把亮度過同一條曲線，三色等比縮放；超過 1 就整體縮回（色相不變）
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let hr = r;
  let hg = g;
  let hb = b;
  if (lum > 1e-9) {
    const ratio = acesFit(lum) / lum;
    hr *= ratio;
    hg *= ratio;
    hb *= ratio;
    const peak = Math.max(hr, hg, hb);
    if (peak > 1) {
      hr /= peak;
      hg /= peak;
      hb /= peak;
    }
  }
  out[o] = mix(ar, hr, HUE_KEEP);
  out[o + 1] = mix(ag, hg, HUE_KEEP);
  out[o + 2] = mix(ab, hb, HUE_KEEP);
}

// ── 調參 ────────────────────────────────────────────────────────────────────
/** 取景：形體外框占影像的比例上限（高、寬各自）。 */
const FIT_HEIGHT = 0.8;
const FIT_WIDTH = 0.88;
/**
 * 光點的高斯半徑 ＝ 此係數 × √（形體在影像上實際占住的像素面積）：點數固定，形體占的面積越大，點越要大才蓋得住，
 * 單位面積的光量才一致。「占住」＝外框切成 OCCUPANCY_GRID² 格後有點落入的格數，所以橫排的 others（外框大、人形小）
 * 不會因為外框大就把點放大。太小的點縮放時會閃，所以有下限。
 */
const SIGMA_AREA = 0.00468;
const SIGMA_MIN_PX = 0.75;
const OCCUPANCY_GRID = 48;
/** 全域亮度：光點的透明度乘它。 */
const INTENSITY = 0.62;
/** 輪廓帶（kind 99）的加亮倍率：亮輪廓。 */
const RIM_BOOST = 0.85;
/** 環境煙占形體點數的比例（D14：全部點的 7%）。 */
const AMBIENT_SHARE = 0.07 / 0.93;
/** 人形的朱紅火星比例。 */
const SPARK_SHARE = 0.006;
/** 氣脈的霧：人形深處的點中，這個比例會多放一團大而淡的光，沿氣脈把流動畫成連續的亮帶（不離開輪廓）。 */
const MIST_SHARE = 0.16;
/**
 * 紅纓（KIND.RED）與火星是「畫上去」的朱紅，不是加色：每顆點除了加一點光，還累積「朱紅覆蓋度」，
 * 合成時覆蓋度越高越蓋掉底下的金光與光暈。純加色的話，紅纓周圍的金色氣與鋼的光暈會把紅洗成橘粉。
 * 紅纓點很密（大槍的纓 1 400 多點擠在不到 2 000 px²），所以每顆的覆蓋量不必大。
 */
const PAINT_RED = 0.12;
/** 氣脈的筆觸：深處的點中，這個比例會往身體下方拖一道短尾（沿氣的流向），內部才有「往上流」的方向感。尾長不超過輪廓帶的寬，不會跑出輪廓。 */
const STREAK_SHARE = 0.3;
const STREAK_LENGTH = 0.045; // 世界單位，以身高 2 為準（見 `streakLength`）
const STREAK_STAMPS = 6;
/** 光暈：近、遠兩層的模糊半徑（相對影像短邊）與權重；來源是各色獨立壓縮（x / (1 + x)）的光，所以光暈保留金或朱紅的色相。 */
const GLOW_NEAR = { sigma: 0.0055, weight: 0.45 };
const GLOW_FAR = { sigma: 0.02, weight: 0.32 };
const GLOW_SOURCE_GAIN = 1.0;
/** WebP 品質：實測 hero 約 28–43 KB（預算 60）、其餘約 21–34 KB（預算 45）；體積門檻由單元測試把關。 */
const WEBP_QUALITY = 80;
/** 兵器的仰角（弧度，鋒尖朝右上；引擎寬螢幕的擺法，見試作）。 */
const WEAPON_TILT: Record<string, number> = { jian: 0.16, miaodao: 0.22, spear: 0.05 };

// ── 小工具 ───────────────────────────────────────────────────────────────────
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = clamp01((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};
const mixColor = (a: Vec3, b: Vec3, t: number): Vec3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** 整數格點的雜湊 → [0, 1)。 */
function lattice(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** 二維 value noise（雙線性、smoothstep 內插），回傳 [0, 1)。 */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  return mix(mix(lattice(ix, iy, seed), lattice(ix + 1, iy, seed), u), mix(lattice(ix, iy + 1, seed), lattice(ix + 1, iy + 1, seed), u), v);
}

/** 氣脈：沿身體縱向流動的亮帶（0–1）。座標是世界單位，所以不同取景下長得一樣。 */
function vein(x: number, y: number, seed: number): number {
  const phase = (seed % 97) * 0.37;
  const wx = x * 2.6 + 0.35 * Math.sin(y * 3.1 + phase);
  const wy = y * 0.7 - 0.25 * Math.sin(x * 4 + phase * 1.7);
  const n = 0.65 * valueNoise(wx, wy, seed) + 0.35 * valueNoise(wx * 2.1 + 9, wy * 2.1 + 4, seed + 1);
  return smoothstep(0.38, 0.78, n);
}

/** 氣的流向（弧度，0 ＝ 正上，左偏為負）：大致往上、帶一點緩慢的擺動。 */
function flowAngle(x: number, y: number, seed: number): number {
  const phase = (seed % 89) * 0.41;
  return (valueNoise(x * 1.7 + 3, y * 1.1, seed + 7) - 0.5) * 2.2 + 0.6 * Math.sin(y * 2.3 + phase);
}

// ── 渲染 ────────────────────────────────────────────────────────────────────
export interface StillOptions {
  width: number;
  height: number;
  /** 亂數種子（光點大小與色差、火星、環境煙、氣脈相位都由它決定）。 */
  seed: number;
  /** 光暈強度，預設 1；0 ＝只有光點。 */
  glow?: number;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} 必須是正整數：${value}`);
}

/** 畫布：線性 HDR 光（RGB 交錯，加色）與「朱紅覆蓋度」（單通道，見 `PAINT_RED`）。 */
interface Canvas {
  width: number;
  height: number;
  hdr: Float32Array;
  paint: Float32Array;
}

/** 形體實際占住的面積（世界單位²）：把 xy 外框切成 OCCUPANCY_GRID² 格，數有點落入的格子。 */
function occupiedArea(shape: Shape, minX: number, minY: number, spanX: number, spanY: number): number {
  const cells = new Uint8Array(OCCUPANCY_GRID * OCCUPANCY_GRID);
  let occupied = 0;
  for (let i = 0; i < shape.count; i++) {
    const gx = Math.min(OCCUPANCY_GRID - 1, Math.floor(((shape.positions[i * 3]! - minX) / spanX) * OCCUPANCY_GRID));
    const gy = Math.min(OCCUPANCY_GRID - 1, Math.floor(((shape.positions[i * 3 + 1]! - minY) / spanY) * OCCUPANCY_GRID));
    const cell = gy * OCCUPANCY_GRID + gx;
    if (!cells[cell]) {
      cells[cell] = 1;
      occupied++;
    }
  }
  return (occupied / cells.length) * spanX * spanY;
}

/** 加一顆高斯光點到畫布：光加到 hdr；paint > 0 時，同一個高斯也累積到覆蓋度。 */
function splat(canvas: Canvas, px: number, py: number, sigma: number, r: number, g: number, b: number, paint = 0): void {
  const { width, height, hdr } = canvas;
  const reach = Math.ceil(sigma * 3);
  const x0 = Math.max(0, Math.floor(px) - reach);
  const x1 = Math.min(width - 1, Math.floor(px) + reach);
  const y0 = Math.max(0, Math.floor(py) - reach);
  const y1 = Math.min(height - 1, Math.floor(py) + reach);
  const k = -1 / (2 * sigma * sigma);
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - py;
    const row = y * width;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - px;
      const w = Math.exp((dx * dx + dy * dy) * k);
      const o = (row + x) * 3;
      hdr[o]! += r * w;
      hdr[o + 1]! += g * w;
      hdr[o + 2]! += b * w;
      if (paint > 0) canvas.paint[row + x]! += paint * w;
    }
  }
}

/** 一個點的顏色（線性）、透明度與大小倍率；規則搬自引擎的光點著色器（`kind` 是形體檔的 u8）。 */
function pointLook(kind: number, tone: number, veinValue: number): { color: Vec3; alpha: number; size: number } {
  if (kind <= 99) {
    // 人形：內部是金，氣脈處更亮、偏米白；輪廓帶（99）是亮的金米色
    const rim = kind >= 90;
    const t = rim ? 0.3 + tone * 0.3 : clamp01(tone * 0.16 + (kind / 99) * 0.45 + veinValue * 0.2);
    const alpha = rim ? 0.55 * RIM_BOOST : 0.55 * (0.25 + 1.0 * veinValue);
    return { color: mixColor(C_GOLD, C_PAPER, t), alpha, size: 1 };
  }
  switch (kind) {
    case KIND.STEEL:
      return { color: mixColor(C_PAPER, [1, 1, 1], 0.15), alpha: 0.3, size: 1 };
    case KIND.BRASS:
      return { color: [C_GOLD[0] * 1.2, C_GOLD[1] * 1.2, C_GOLD[2] * 1.2], alpha: 0.45, size: 1 };
    case KIND.RED:
      return { color: [C_SEAL[0] * 1.4, C_SEAL[1] * 1.4, C_SEAL[2] * 1.4], alpha: 0.2, size: 1.15 };
    case KIND.DARK:
      return { color: [C_GOLD[0] * 0.85, C_GOLD[1] * 0.85, C_GOLD[2] * 0.85], alpha: 0.6, size: 1 };
    case KIND.SEAL:
      return { color: [C_SEAL[0] * 1.25, C_SEAL[1] * 1.25, C_SEAL[2] * 1.25], alpha: 0.6, size: 1.25 };
    default: // AURA
      return { color: mixColor(C_GOLD, C_PAPER, tone * 0.5), alpha: 0.16, size: 0.9 };
  }
}

export async function renderStill(shape: Shape, opts: StillOptions): Promise<Uint8Array> {
  const { width, height, seed } = opts;
  const glow = opts.glow ?? 1;
  assertPositiveInteger('width', width);
  assertPositiveInteger('height', height);
  assertPositiveInteger('形體 count', shape.count);
  if (!Number.isInteger(seed)) throw new RangeError(`seed 必須是整數：${seed}`);
  if (!(glow >= 0) || !Number.isFinite(glow)) throw new RangeError(`glow 必須是不小於 0 的數：${glow}`);
  if (shape.positions.length !== shape.count * 3 || shape.kinds.length !== shape.count) {
    throw new RangeError(`形體 count ${shape.count} 與 positions／kinds 的長度不符`);
  }

  // 取景：xy 外框置中，等比放大到高 80%／寬 88% 之內
  const { positions, kinds, count } = shape;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (!(spanX > 0 || spanY > 0) || !Number.isFinite(spanX + spanY)) throw new RangeError('形體的 xy 外框退化（沒有大小），無法取景');
  const tiny = Math.max(spanX, spanY) * 1e-3;
  const scale = Math.min((width * FIT_WIDTH) / Math.max(spanX, tiny), (height * FIT_HEIGHT) / Math.max(spanY, tiny));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const toPx = (x: number): number => width / 2 + (x - centerX) * scale;
  const toPy = (y: number): number => height / 2 - (y - centerY) * scale;

  const canvas: Canvas = { width, height, hdr: new Float32Array(width * height * 3), paint: new Float32Array(width * height) };
  const { hdr, paint } = canvas;
  const sigmaBase = Math.max(SIGMA_MIN_PX, SIGMA_AREA * Math.sqrt(occupiedArea(shape, minX, minY, Math.max(spanX, tiny), Math.max(spanY, tiny)) * scale * scale));
  const random = rng(seed);

  // 筆觸尾長隨形體大小縮：kind 的「離輪廓夠遠」是原形體的世界單位，合成的小人形（others，0.38 倍）的門檻也只有 0.38 倍，
  // 尾長不跟著縮就會跑出輪廓。身高 ≥ 2 的人形不縮。
  const streakLength = STREAK_LENGTH * Math.min(1, spanY / 2);
  // 形體本身的點（每點固定抽 5 個亂數，加減分支不會讓後面的點跑掉）
  for (let i = 0; i < count; i++) {
    const big = random();
    const tone = random();
    const spark = random();
    const spare = random();
    const mist = random();
    const kind = kinds[i]!;
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    const human = kind <= 99;
    const veinValue = human ? vein(x, y, seed) : 0;
    const look = pointLook(kind, tone, veinValue);
    let { color, alpha } = look;
    let size = look.size * mix(0.55, 1.45, big);
    let coverage = kind === KIND.RED ? PAINT_RED : 0;
    if (human && spark < SPARK_SHARE) {
      color = C_VERMILION;
      alpha = 0.5;
      size *= 1.1;
      coverage = 0.9;
    }
    const depth = 1 + z * 0.5; // 靠鏡頭的稍亮稍大
    alpha *= INTENSITY * depth * (0.9 + spare * 0.2);
    splat(canvas, toPx(x), toPy(y), sigmaBase * size * (0.95 + z * 0.15), color[0] * alpha, color[1] * alpha, color[2] * alpha, coverage);
    // 氣脈的筆觸：從這點往下方拖一道漸淡的短尾
    if (kind === 0 && mist > 1 - STREAK_SHARE) {
      const a = flowAngle(x, y, seed);
      const dx = -Math.sin(a) * streakLength;
      const dy = -Math.cos(a) * streakLength;
      for (let s = 1; s <= STREAK_STAMPS; s++) {
        const f = s / (STREAK_STAMPS + 1);
        const w = alpha * (1 - f) ** 1.5 * 0.6;
        splat(canvas, toPx(x + dx * f), toPy(y + dy * f), sigmaBase * size * (1 - 0.35 * f), color[0] * w, color[1] * w, color[2] * w);
      }
    }
    // 氣脈的霧：只放在離輪廓夠遠的深處（kind 0），大而淡的光不會碰到輪廓或鏤空的負形
    if (kind === 0 && mist < MIST_SHARE) {
      const m = 0.075 * INTENSITY * veinValue * veinValue;
      splat(canvas, toPx(x), toPy(y), sigmaBase * 4.5, C_GOLD[0] * m, C_GOLD[1] * m, C_GOLD[2] * m);
    }
  }

  // 環境煙：從形體上隨機一點往外飄一段，很淡；範圍隨形體大小（人形 ≈ 0.9、兵器 ≈ 0.45 世界單位）
  const spread = 0.18 * (spanX + spanY);
  const ambient = Math.round(count * AMBIENT_SHARE);
  for (let n = 0; n < ambient; n++) {
    const from = Math.floor(random() * count);
    const angle = random() * Math.PI * 2;
    const reach = spread * (0.12 + random() ** 2.2 * 1.7);
    const tone = random();
    const big = random();
    const x = positions[from * 3]! + Math.cos(angle) * reach;
    const y = positions[from * 3 + 1]! + Math.sin(angle) * reach;
    const color = mixColor(C_GOLD, C_PAPER, tone * 0.5);
    const alpha = 0.35 * 0.55 * INTENSITY;
    splat(canvas, toPx(x), toPy(y), sigmaBase * 0.9 * mix(0.55, 1.45, big), color[0] * alpha, color[1] * alpha, color[2] * alpha);
  }

  // 光暈的來源：各色獨立壓縮（x / (1 + x)）再編成 8-bit sRGB（sharp 只吃 8-bit，編碼後的模糊也不會在暗部出現階梯）
  const pixels = width * height;
  const toned = new Float32Array(3);
  const raw = { raw: { width, height, channels: 3 as const } };
  let near: Buffer | undefined;
  let far: Buffer | undefined;
  if (glow > 0) {
    const source = new Uint8Array(pixels * 3);
    for (let i = 0; i < source.length; i++) {
      const x = hdr[i]! * GLOW_SOURCE_GAIN;
      source[i] = encode(x / (1 + x));
    }
    const short = Math.min(width, height);
    // sharp 的高斯模糊，換回線性空間疊回去
    [near, far] = await Promise.all([GLOW_NEAR, GLOW_FAR].map((g) => sharp(source, raw).blur(Math.max(0.3, g.sigma * short)).raw().toBuffer()));
  }

  // 色調映射＋底色＋光暈 → sRGB
  const out = new Uint8Array(pixels * 3);

  const wNear = glow * GLOW_NEAR.weight;
  const wFar = glow * GLOW_FAR.weight;
  for (let p = 0; p < pixels; p++) {
    toneMap(hdr[p * 3]!, hdr[p * 3 + 1]!, hdr[p * 3 + 2]!, toned, 0);
    const cover = 1 - Math.exp(-paint[p]!);
    for (let c = 0; c < 3; c++) {
      let v = C_BG[c]! + toned[c]!;
      if (near && far) v += wNear * DECODE_LUT[near[p * 3 + c]!]! + wFar * DECODE_LUT[far[p * 3 + c]!]!;
      if (cover > 0) v = mix(v, C_VERMILION[c]!, cover);
      out[p * 3 + c] = encode(v);
    }
  }

  const bytes = await sharp(out, raw).webp({ quality: WEBP_QUALITY, effort: 6, smartSubsample: true }).toBuffer();
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// ── 整批產出 ────────────────────────────────────────────────────────────────
const HEROES = [
  { name: 'hero-wide', source: 'land', width: 1440, height: 810 },
  { name: 'hero-tall', source: 'land', width: 780, height: 1280 },
] as const;
const POSE_SIZE = { width: 1000, height: 750 } as const;
/** 影響渲染結果的原始碼（相對專案根目錄）。 */
const SOURCES = ['scripts/qi/render-stills.ts', 'scripts/qi/hash.ts', 'src/qi/shapes/format.ts', 'src/qi/shapes/rng.ts'];
const DEFAULT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** 名稱 → 32 位元種子（sha256 的前 8 個十六進位字元）：不依賴出圖順序，加減形體不會讓其他圖的點跑掉。 */
const seedOf = (name: string): number => Number.parseInt(sha256(`qi-still:${name}`).slice(0, 8), 16);

function failedStill(name: string, cause: unknown): Error {
  return new Error(`靜態圖 ${name}：${cause instanceof Error ? cause.message : String(cause)}`, { cause });
}

/** 兵器是橫放的單位形；照引擎的擺法繞 z 軸轉一個仰角（鋒尖朝右上），其餘形體原樣。 */
function placed(id: string, shape: Shape): Shape {
  const tilt = WEAPON_TILT[id];
  if (!tilt) return shape;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const positions = new Float32Array(shape.positions.length);
  for (let i = 0; i < shape.count; i++) {
    const x = shape.positions[i * 3]!;
    const y = shape.positions[i * 3 + 1]!;
    positions[i * 3] = x * cos - y * sin;
    positions[i * 3 + 1] = x * sin + y * cos;
    positions[i * 3 + 2] = shape.positions[i * 3 + 2]!;
  }
  return { ...shape, positions };
}

function sizeOf(path: string): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}

function discardStaging(staging: string, warn: (message: string) => void): void {
  try {
    rmSync(staging, { recursive: true, force: true, maxRetries: 3 });
  } catch (cause) {
    warn(`清不掉暫存目錄 ${staging}（${cause instanceof Error ? cause.message : String(cause)}），下一次建置會再清一次`);
  }
}

/** `shapes.json` 列出的形體 id（形體檔的權威清單）。 */
function manifestIds(shapesDir: string): string[] {
  let list: unknown;
  try {
    list = JSON.parse(readFileSync(join(shapesDir, 'shapes.json'), 'utf8'));
  } catch (cause) {
    throw new Error(`讀不到形體清單 shapes.json（${shapesDir}）：${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
  if (!Array.isArray(list) || !list.every((e) => typeof (e as { id?: unknown })?.id === 'string')) {
    throw new Error(`形體清單 shapes.json 格式不對（${shapesDir}）：應為 [{ id, bytes, sha256 }]`);
  }
  const ids = list.map((e: { id: string }) => e.id);
  if (!ids.includes('land')) throw new Error(`shapes.json 沒有 land：hero 靜態圖要由 land 渲出（${shapesDir}）`);
  return ids;
}

/** stills.json 與實際檔案是否一致（每個名稱都在、大小相符）。 */
function manifestMatches(outDir: string, names: string[]): boolean {
  let recorded: Record<string, { bytes?: number } | undefined>;
  try {
    recorded = JSON.parse(readFileSync(join(outDir, MANIFEST), 'utf8'));
  } catch {
    return false;
  }
  return names.every((name) => recorded[name]?.bytes === sizeOf(join(outDir, `${name}.webp`)));
}

export async function renderAllStills(opts: {
  shapesDir: string;
  outDir: string;
  /** 專案根目錄（原始碼雜湊用）；預設是本檔所在專案。 */
  root?: string;
  force?: boolean;
  /** 清不掉暫存目錄這類「不影響結果」的問題用它回報；預設 `console.warn`。 */
  warn?: (message: string) => void;
}): Promise<{ built: string[]; skipped: boolean }> {
  const { shapesDir, outDir } = opts;
  const root = opts.root ?? DEFAULT_ROOT;
  const warn = opts.warn ?? ((message: string) => console.warn(message));
  const ids = manifestIds(shapesDir);
  const names = [...HEROES.map((h) => h.name), ...ids];

  // 先讀全部 .bin 的位元組（算輸入雜湊要用；解碼留到輪到它的時候，失敗才會帶名稱、也才不會在渲染之前就整批擋下）
  const bins = new Map<string, Uint8Array>();
  for (const id of ids) {
    try {
      bins.set(id, new Uint8Array(readFileSync(join(shapesDir, `${id}.bin`))));
    } catch (cause) {
      throw failedStill(id, cause);
    }
  }
  const salt = `qst${STILL_VERSION}:sharp${sharp.versions.sharp}:${ids.map((id) => `${id}=${sha256(bins.get(id)!)}`).join(',')}`;
  const inputsHash = hashInputs(root, SOURCES, salt);
  const hashFile = join(outDir, HASH_FILE);

  const upToDate = !opts.force && existsSync(hashFile) && readFileSync(hashFile, 'utf8').trim() === inputsHash && manifestMatches(outDir, names);
  if (upToDate) return { built: [], skipped: true };

  mkdirSync(outDir, { recursive: true });
  // 先拿掉舊雜湊：之後不管在哪一步失敗或被中斷，下一次一定重建
  rmSync(hashFile, { force: true });

  const staging = join(outDir, STAGING);
  discardStaging(staging, warn);
  mkdirSync(staging, { recursive: true });
  try {
    const manifest: Record<string, { width: number; height: number; bytes: number }> = {};
    const shapes = new Map<string, Shape>();
    const shapeOf = (id: string): Shape => {
      let shape = shapes.get(id);
      if (!shape) {
        shape = placed(id, decodeShape(bins.get(id)!));
        shapes.set(id, shape);
      }
      return shape;
    };
    const jobs = [
      ...HEROES.map((h) => ({ name: h.name, source: h.source, width: h.width, height: h.height })),
      ...ids.map((id) => ({ name: id, source: id, ...POSE_SIZE })),
    ];
    for (const { name, source, width, height } of jobs) {
      let bytes: Uint8Array;
      try {
        bytes = await renderStill(shapeOf(source), { width, height, seed: seedOf(name) });
      } catch (cause) {
        throw failedStill(name, cause);
      }
      writeFileSync(join(staging, `${name}.webp`), bytes);
      manifest[name] = { width, height, bytes: bytes.byteLength };
    }
    writeFileSync(join(staging, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);

    // 全部成功才換入。先刪 stills.json：換入到一半失敗時 .webp 可能新舊混雜，
    // 但目錄裡既沒有 stills.json 也沒有 .inputs-hash，一看就是不完整，下一次整批重建。
    rmSync(join(outDir, MANIFEST), { force: true });
    for (const name of names) renameSync(join(staging, `${name}.webp`), join(outDir, `${name}.webp`));
    renameSync(join(staging, MANIFEST), join(outDir, MANIFEST));
    // 改名或移除的形體不留殘檔（頁面用 glob 收 `*.webp`，殘檔會被一起打進 dist）
    const known = new Set(names.map((name) => `${name}.webp`));
    for (const file of readdirSync(outDir)) if (file.endsWith('.webp') && !known.has(file)) rmSync(join(outDir, file));
    writeFileSync(hashFile, `${inputsHash}\n`);
  } finally {
    discardStaging(staging, warn);
  }
  return { built: names, skipped: false };
}
