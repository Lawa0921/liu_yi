/**
 * 竹簡形體的取樣（Task 25，課表段）：程序化的「攤開的竹簡」——幾根直立竹片並排、上下兩道綁繩橫穿、兩端略捲。
 * 完全由幾何產生（`config/shapes.ts` 的 `SCROLL`），沒有任何輸入圖或字，所以不可能含字；純函式、固定種子，Node 與瀏覽器通用
 * （實際只在建置時由 `scripts/qi/build-shapes.ts` 呼叫，輸出 `scroll.bin`）。
 *
 *   - 竹片：每片寬 = 間距 × `fill`，片與片之間留縫。點的一半均勻落在長條內，一半沿著長條的邊（內縮一小段），
 *     邊緣多放點才看得出一片一片的竹片，而不是糊成一塊。每片分到的點一樣多（輪流分配，所以載入時取任何前綴，每片仍各占 1/片數）。
 *   - 綁繩：每 `CORD_EVERY` 個點取一個給綁繩（`KIND.DARK`，比竹片亮），上下兩道輪流；繩比竹片厚一點點（z 略往前），蓋在竹片上。
 *   - 兩端略捲：最外側 `curledSlats` 片繞著一根垂直的軸向鏡頭捲起——x 以「弧長 → 弦」收窄（正面看變窄），z 往前凸出。
 *     中央的竹片與綁繩是平的。`curl` 是捲到最外緣的角度（弧度），預設 `SCROLL.curlAngle`；0 ＝ 完全攤平（測試用）。
 *   - 竹片的高度各有 ±4% 的差（像手工削的），固定由片的序號雜湊決定，不吃亂數序列。
 */

import { SCROLL } from '../config/shapes';
import { KIND, type Shape } from './format';
import { rng } from './rng';

/** 沿邊放的點占竹片點的比例，與內縮的深度（世界單位）。 */
const EDGE_SHARE = 0.5;
const EDGE_DEPTH = 0.01;
/** 每隔幾個點取一個給綁繩（約 9%）。 */
const CORD_EVERY = 11;
/** 竹片的厚度（z 的抖動範圍，世界單位）；綁繩略往前。 */
const SLAT_DEPTH = 0.04;
const CORD_Z = 0.025;
const CORD_DEPTH = 0.02;
/** 竹片高度的手工差：±這個比例（上下緣參差，才不像一塊整齊的板）。 */
const HEIGHT_VARIATION = 0.04;

export interface ScrollOptions {
  count: number;
  seed: number;
  /** 兩端捲到最外緣的角度（弧度，≥ 0）；0 ＝ 完全攤平。預設 `SCROLL.curlAngle`。 */
  curl?: number;
}

const pitch = SCROLL.width / SCROLL.slats;

/** 攤平時每片竹片的 x 區間（左到右，整體以 x = 0 為中線）。 */
export function slatIntervals(): { left: number; right: number }[] {
  const half = (pitch * SCROLL.fill) / 2;
  return Array.from({ length: SCROLL.slats }, (_, i) => {
    const center = (i - (SCROLL.slats - 1) / 2) * pitch;
    return { left: center - half, right: center + half };
  });
}

/** 整數序號 → [−1, 1] 的固定雜湊（不吃亂數序列）。 */
function hashSigned(i: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (((h ^ (h >>> 15)) >>> 0) / 4294967296) * 2 - 1;
}

/** 捲曲：攤平的 x → 正面的 (x, z)。中央不動；超過 `rollStart` 的部分以半徑 r 的圓弧向鏡頭捲起。 */
function roll(x: number, curl: number): { x: number; z: number } {
  if (curl === 0) return { x, z: 0 };
  const rollStart = SCROLL.width / 2 - SCROLL.curledSlats * pitch;
  const along = Math.abs(x) - rollStart;
  if (along <= 0) return { x, z: 0 };
  const radius = (SCROLL.curledSlats * pitch) / curl;
  const angle = along / radius;
  return { x: Math.sign(x) * (rollStart + radius * Math.sin(angle)), z: radius * (1 - Math.cos(angle)) };
}

export function sampleScroll(opts: ScrollOptions): Shape {
  const { count, seed } = opts;
  const curl = opts.curl ?? SCROLL.curlAngle;
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`Scroll sample count must be a positive integer: ${count}`);
  if (!Number.isFinite(curl) || curl < 0) throw new RangeError(`Scroll curl must be a finite non-negative angle: ${curl}`);

  const slats = slatIntervals();
  const random = rng(seed);
  const positions = new Float32Array(count * 3);
  const kinds = new Uint8Array(count);
  const half = SCROLL.height / 2;
  const cordY = SCROLL.cordAt * SCROLL.height;
  const left = slats[0]!.left;
  const right = slats[slats.length - 1]!.right;
  let slatPoints = 0;
  let cordPoints = 0;

  for (let i = 0; i < count; i++) {
    // 每個點固定抽 4 個亂數，分支不會讓後面的點跑掉
    const a = random();
    const b = random();
    const c = random();
    const d = random();
    let x: number;
    let y: number;
    let z: number;
    if (i % CORD_EVERY === 0) {
      // 綁繩：上下兩道輪流，橫跨第一片的左緣到最後一片的右緣
      const top = cordPoints++ % 2 === 0;
      x = left + a * (right - left);
      y = SCROLL.centerY + (top ? cordY : -cordY) + (b - 0.5) * SCROLL.cordThickness;
      z = CORD_Z + (c - 0.5) * CORD_DEPTH;
      kinds[i] = KIND.DARK;
    } else {
      // 竹片：輪流分給每一片；高度有手工差
      const index = slatPoints++ % slats.length;
      const { left: l, right: r } = slats[index]!;
      const h = half * (1 + HEIGHT_VARIATION * hashSigned(index));
      if (a < EDGE_SHARE) {
        // 沿邊：左右兩條長邊占大部分，上下兩條短邊其次（依邊長比例）
        const width = r - l;
        const along = (width * 2 + h * 4) * b; // 周長 2×寬 + 2×高（高 = 2h）
        const depth = c * EDGE_DEPTH;
        if (along < h * 2) {
          x = l + depth;
          y = SCROLL.centerY - h + along;
        } else if (along < h * 4) {
          x = r - depth;
          y = SCROLL.centerY - h + (along - h * 2);
        } else if (along < h * 4 + width) {
          x = l + (along - h * 4);
          y = SCROLL.centerY + h - depth;
        } else {
          x = l + (along - h * 4 - width);
          y = SCROLL.centerY - h + depth;
        }
      } else {
        x = l + b * (r - l);
        y = SCROLL.centerY - h + c * (2 * h);
      }
      z = (d - 0.5) * SLAT_DEPTH;
      kinds[i] = KIND.BAMBOO;
    }
    const rolled = roll(x, curl);
    positions[i * 3] = rolled.x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z + rolled.z;
  }

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i * 3 + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { count, positions, kinds, min, max };
}
