/**
 * 持械形體（Task 27，使用者要求「苗刀、大槍等粒子應該要有人物拿著的感覺，美術會比較一致」）：
 * 拳師持械的光點形體 ＝ 剪影取樣（把剪影自己畫的那條細兵器剔掉）＋兵器幾何（`sample-weapon.ts` 的單位形，落在剪影的手上）。
 *
 *   1. 剔掉剪影裡的兵器（`eraseWeapon`）：膠囊（沿兵器軸、半寬略大於兵器的粗細）與矩形（纓穗之類垂下來的部分），
 *      但「保留圈」（手、頭）裡的像素不剔——手握在兵器上，兵器的軸會穿過手與頭（苗刀橫在頭頂），剔掉就會在人身上挖洞。
 *   2. 人形部分照 `sampleFigure` 取樣，座標用「原圖」（剔之前）的外框：腳底在 y = 0、中線在 x = 0，所以持械的人與其他姿勢的人同一把尺，
 *      剔掉兵器也不會讓人往旁邊挪。
 *   3. 兵器部分用 `sampleWeapon` 的單位形（長軸 +x、鋒尖朝 +x、全長 1），照剪影裡兵器的鋒尖與尾端（原圖 px）擺放：
 *      縮放成兩端的距離、轉到兩端的方向、平移到兩端的中點。紅纓（`KIND.RED`）掛著、順著重力垂下：不跟著轉，只以紮點為軸平移與縮放
 *      （與執行時 `expand.ts` 的 `layOut` 同一個規則）。
 *   4. 兩部分交錯成一個形體：第 i 個點取自兵器或人形由「累計比例」決定，所以任何前綴（載入時依 tier 取前綴）都是同一個比例的縮影，
 *      兵器點占 `weaponShare`——兵器的面積比人小得多，點數占這麼多就比人形密、亮（種類 100–104 在著色器裡本來就比人形亮）。
 *
 * 純函式、固定種子：同輸入逐位元相同。不碰 three／DOM，Node 與瀏覽器通用。
 */

import type { ArmedSpec, EraseSpec } from '../config/armed';
import { WORLD_UNIT_PER_LAND_PX } from '../config/figures';
import { KIND, type Shape } from './format';
import { figureFrame, sampleFigure, type FigureImage } from './sample-figure';
import { sampleWeapon } from './sample-weapon';
import type { WeaponSnapshot } from './weapon-snapshot';

/** 到線段的距離平方。 */
function segmentDistanceSq(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len));
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/** 把剪影裡的兵器剔成透明（回傳新的 alpha，不改原圖）。 */
export function eraseWeapon(img: FigureImage, spec: EraseSpec): { image: FigureImage; erased: number } {
  const { width, height } = img;
  const alpha = Uint8Array.from(img.alpha);
  const keep = spec.keep ?? [];
  const kept = (x: number, y: number): boolean => keep.some(([cx, cy, r]) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r);
  let erased = 0;
  const clear = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (alpha[i] === 0 || kept(x, y)) return;
    alpha[i] = 0;
    erased++;
  };
  for (const [x0, y0, x1, y1] of spec.rects ?? []) {
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(height - 1, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(width - 1, Math.ceil(x1)); x++) clear(x, y);
    }
  }
  for (const { a, b, r } of spec.capsules ?? []) {
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0]) + r));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1]) + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if (segmentDistanceSq(x + 0.5, y + 0.5, a, b) <= r * r) clear(x, y);
    }
  }
  return { image: { alpha, width, height }, erased };
}

export interface ArmedAxis {
  /** 世界座標（x 以原圖外框中線為 0、y 以腳底為 0、向上為正）。 */
  tip: { x: number; y: number };
  butt: { x: number; y: number };
  length: number;
  /** butt → tip 的方向（弧度，逆時針；朝 −x 是 π）。 */
  angle: number;
}

/** 剪影裡兵器軸（鋒尖與尾端的原圖 px）換成世界座標；`scale` 是這張剪影的比例（`figureScale`）。 */
export function armedAxis(img: FigureImage, scale: number, spec: Pick<ArmedSpec, 'tip' | 'butt'>): ArmedAxis {
  const { centerPx, footPx } = figureFrame(img);
  const unit = WORLD_UNIT_PER_LAND_PX * scale;
  const world = ([px, py]: [number, number]) => ({ x: (px - centerPx) * unit, y: (footPx - py) * unit });
  const tip = world(spec.tip);
  const butt = world(spec.butt);
  const dx = tip.x - butt.x;
  const dy = tip.y - butt.y;
  return { tip, butt, length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
}

/** 單位形裡紅纓紮點的 x（紅點 x 的平均；與 `expand.ts` 的 `tasselPivot` 同一個定義）；沒有紅點是 null。 */
function pivotOf(weapon: Shape): number | null {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < weapon.count; i++) {
    if (weapon.kinds[i] !== KIND.RED) continue;
    sum += weapon.positions[i * 3]!;
    n++;
  }
  return n > 0 ? sum / n : null;
}

export function sampleArmed(img: FigureImage, scale: number, snapshot: WeaponSnapshot, spec: ArmedSpec, opts: { count: number; seed: number }): Shape {
  const { count, seed } = opts;
  if (!Number.isInteger(count) || count <= 0) throw new RangeError(`count 必須是正整數：${count}`);
  if (!(spec.weaponShare > 0 && spec.weaponShare < 1)) throw new RangeError(`weaponShare 必須在 0 與 1 之間（不含）：${spec.weaponShare}`);
  const axis = armedAxis(img, scale, spec);
  if (!(axis.length > 0)) throw new RangeError('剪影裡的兵器鋒尖與尾端是同一點，量不出兵器軸');

  const weaponCount = Math.min(count - 1, Math.max(1, Math.round(count * spec.weaponShare)));
  const bodyCount = count - weaponCount;
  const frame = figureFrame(img); // 原圖的框：剔掉兵器之後人不會往旁邊挪
  const body = sampleFigure(eraseWeapon(img, spec.erase).image, scale, { count: bodyCount, seed, frame });
  const weapon = sampleWeapon(snapshot, { count: weaponCount, seed: (seed ^ 0x5a17) >>> 0, surfaceShare: spec.surfaceShare });

  // 兵器：單位形 → 世界座標（縮成軸長、轉到軸向、平移到兩端的中點）
  const midX = (axis.tip.x + axis.butt.x) / 2;
  const midY = (axis.tip.y + axis.butt.y) / 2;
  const cos = Math.cos(axis.angle) * axis.length;
  const sin = Math.sin(axis.angle) * axis.length;
  const pivot = pivotOf(weapon);
  const pivotX = pivot !== null ? pivot * cos + midX : 0;
  const pivotY = pivot !== null ? pivot * sin + midY : 0;
  const placed = new Float32Array(weaponCount * 3);
  for (let k = 0; k < weaponCount; k++) {
    const x = weapon.positions[k * 3]!;
    const y = weapon.positions[k * 3 + 1]!;
    if (pivot !== null && weapon.kinds[k] === KIND.RED) {
      placed[k * 3] = pivotX + (x - pivot) * axis.length;
      placed[k * 3 + 1] = pivotY + y * axis.length;
    } else {
      placed[k * 3] = x * cos - y * sin + midX;
      placed[k * 3 + 1] = x * sin + y * cos + midY;
    }
    placed[k * 3 + 2] = weapon.positions[k * 3 + 2]! * axis.length;
  }

  // 交錯：累計比例每跨過一個整數就取一個兵器點，任何前綴都是同一個比例
  const positions = new Float32Array(count * 3);
  const kinds = new Uint8Array(count);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let nextBody = 0;
  let nextWeapon = 0;
  for (let i = 0; i < count; i++) {
    const useWeapon = nextWeapon < weaponCount && (nextBody >= bodyCount || Math.floor(((i + 1) * weaponCount) / count) > nextWeapon);
    if (useWeapon) {
      positions.set(placed.subarray(nextWeapon * 3, nextWeapon * 3 + 3), i * 3);
      kinds[i] = weapon.kinds[nextWeapon]!;
      nextWeapon++;
    } else {
      positions.set(body.positions.subarray(nextBody * 3, nextBody * 3 + 3), i * 3);
      kinds[i] = body.kinds[nextBody]!;
      nextBody++;
    }
    for (let a = 0; a < 3; a++) {
      const v = positions[i * 3 + a]!;
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
  }
  return { count, positions, kinds, min, max };
}
