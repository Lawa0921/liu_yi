/**
 * 把兵器快照取樣成 count 個光點的目標位置（兵器形體）。規則搬自試作 `src/lab/qi/shapes.ts` 的 `sampleWeapon`，
 * 改成純函式（輸入快照，不碰 three），好在 Node 的建置腳本與單元測試裡跑：
 *
 *   - 單位形（D13）：長軸 +x、鋒尖朝 +x、置中、全長 1。快照是長軸 +Y 的原座標，這裡轉 −90°（繞 Z）：(x, y, z) → (y, −x, z)，
 *     再依「全部頂點在長軸上的實際範圍」縮成長度 1 並置中。用實際範圍而不是 `tip − butt`：劍穗的結會比劍首多出約 2%，
 *     長度要把它算進去，非 AURA 點的 x 範圍才會剛好是 1。
 *   - 表面占 30%（SURFACE_SHARE）；其餘是貼著兵器的氣（kind = AURA）。
 *   - 每個零件（快照裡同一種 cls 只能有一個零件，重複會直接 throw）的點數 ∝ 面積^0.6 × 種類加權
 *     （鋼 ×1.8、銅 ×1、紅纓 ×0.7、暗色 ×1.4）。面積開 0.6 次方：刃面大、纓穗細，直接按面積分配穗會幾乎看不到。
 *   - 補強（試作的兩個已知缺點）：
 *       纓穗（cls 4）權重由 0.5 提到 0.7，並保證至少占全部點的 3.5%（RED_MIN_SHARE），紅色才看得出來。
 *       大槍的纓（兩束共 0.35 m² 的細絲）面積大，權重 1.6 會讓紅點占到全部點的 14.9%、亮成一團；0.7 時大槍約 9%、
 *       劍約 4.7%。保底只在自然占比低於 3.5% 時才會生效（真快照用不到，由合成快照的測試釘住）；
 *       暗色零件（cls 5：柄與桿）至少要有半徑 0.0144（單位長度）的粗細：離長軸不到 0.0144 的表面點改成
 *       在半徑 0.0144 的垂直軸向圓盤內均勻散布（p95 ≈ 0.0144 × √0.95 ≈ 0.014），桿才看得出粗細（大槍的桿本身半徑
 *       只有約 0.006）；比這更粗的柄維持貼在表面。散布是「取代」而不是「疊加」，大槍的 p95 才會是 0.014 而不是更粗。
 *   - 其他零件的表面點只加一點點垂直軸向的散布（試作是 ±0.006／±0.02 世界單位，這裡按當時的兵器擺放長度換成單位長度），
 *     光點才不會全疊在同一條線上。沿長軸方向不加散布：全長要穩穩是 1。
 *   - 氣的延伸 0.03–0.35（試作的世界單位）同樣按擺放長度換成單位長度。
 *   - 兩端各固定放一個「端點」：長軸上最前與最後的那個頂點，非 AURA 點的 x 範圍才與取樣的運氣無關。
 *   - 最後整批打散（D10：載入時依 tier 取前綴，前綴要是同一個比例的縮影）。
 *
 * 劍鞘不在快照裡，不取樣。纓穗在快照裡已朝 +X，轉到單位形後朝下（−y）。固定種子，同輸入逐位元相同。
 */

import { KIND, type Shape } from './format';
import { rng } from './rng';
import type { WeaponPart, WeaponSnapshot } from './weapon-snapshot';

/** 表面點占全部點的比例。 */
const SURFACE_SHARE = 0.3;
/** 面積權重的次方。 */
const AREA_POWER = 0.6;
/** 種類加權：鋼 ×1.8、暗色 ×1.4、銅 ×1、紅纓 ×0.7（試作是 0.5；簡報的 1.6 會讓大槍的紅占 14.9%，裁定降到 8–10%）。 */
const BOOST: Record<WeaponPart['cls'], number> = { 2: 1.8, 3: 1, 4: 0.7, 5: 1.4 };
const KIND_OF: Record<WeaponPart['cls'], number> = { 2: KIND.STEEL, 3: KIND.BRASS, 4: KIND.RED, 5: KIND.DARK };
/** 紅纓（cls 4）至少占全部點的這個比例（只要這件兵器有纓）。 */
const RED_MIN_SHARE = 0.035;
/** 暗色零件至少要有的粗細：垂直軸向的散布半徑（單位長度）；大槍的暗色點離長軸的 p95 因此約 0.014。 */
const DARK_SPREAD = 0.0144;
/** 試作擺放兵器時的全長（世界單位，寬螢幕）：把試作的世界單位數值換成單位長度用。 */
const TRIAL_LENGTH: Record<WeaponSnapshot['name'], number> = { jian: 2.9, miaodao: 3.2, spear: 3.8 };
/** 試作的表面散布（全寬，世界單位）：垂直軸向的刃寬方向 0.012、刃厚方向 0.04。 */
const TRIAL_JITTER_Y = 0.012;
const TRIAL_JITTER_Z = 0.04;
/** 氣的延伸：0.03 + p^2.2 × 0.32（試作的世界單位）。 */
const AURA_NEAR = 0.03;
const AURA_SPAN = 0.32;
const AURA_CURVE = 2.2;
/** 兩端的端點。 */
const ANCHORS = 2;
const MIN_COUNT = 10;

interface Prepared {
  cls: WeaponPart['cls'];
  /** 已轉成單位形座標。 */
  positions: Float32Array;
  indices: Uint32Array;
  /** 三角形面積的累計（取樣時二分搜尋）；最後一項是總面積。 */
  cumulative: Float64Array;
  area: number;
}

/** 最大餘數法：把 total 依 weights 比例分成整數，總和剛好是 total；權重全 0 就全給 0。 */
function apportion(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = new Array<number>(weights.length).fill(0);
  if (!(sum > 0) || total <= 0) return out;
  const remainders: { index: number; rest: number }[] = [];
  let given = 0;
  weights.forEach((w, index) => {
    const exact = (w / sum) * total;
    out[index] = Math.floor(exact);
    given += out[index]!;
    remainders.push({ index, rest: exact - out[index]! });
  });
  remainders.sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (let k = 0; given < total; k = (k + 1) % remainders.length) {
    if (weights[remainders[k]!.index]! > 0) {
      out[remainders[k]!.index]!++;
      given++;
    }
  }
  return out;
}

export function sampleWeapon(s: WeaponSnapshot, opts: { count: number; seed: number }): Shape {
  const { count, seed } = opts;
  if (!Number.isInteger(count) || count < MIN_COUNT) throw new RangeError(`count 必須是 ≥ ${MIN_COUNT} 的整數：${count}`);
  if (!(s.tip > s.butt)) throw new RangeError(`快照的 tip（${s.tip}）必須大於 butt（${s.butt}）`);
  if (s.parts.length === 0) throw new RangeError('快照沒有零件');
  const seen = new Set<number>();
  for (const part of s.parts) {
    if (seen.has(part.cls)) throw new RangeError(`快照有重複的 cls ${part.cls}：同一種 cls 只能有一個零件（面積權重以零件為單位，重複會讓配額失真）`);
    seen.add(part.cls);
  }
  const referenceLength = TRIAL_LENGTH[s.name];

  // 長軸上的實際範圍（含纓穗的結）
  let lo = Infinity;
  let hi = -Infinity;
  for (const part of s.parts) {
    for (let i = 1; i < part.positions.length; i += 3) {
      const y = part.positions[i]!;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  if (!(hi > lo)) throw new RangeError('快照在長軸上沒有長度');
  const scale = 1 / (hi - lo);
  const center = (hi + lo) / 2;

  // 轉成單位形，並建面積表
  const parts: Prepared[] = s.parts.map((part) => {
    const vertices = part.positions.length / 3;
    const positions = new Float32Array(vertices * 3);
    for (let i = 0; i < vertices; i++) {
      positions[i * 3] = (part.positions[i * 3 + 1]! - center) * scale;
      positions[i * 3 + 1] = -part.positions[i * 3]! * scale;
      positions[i * 3 + 2] = part.positions[i * 3 + 2]! * scale;
    }
    const triangles = part.indices.length / 3;
    const cumulative = new Float64Array(triangles);
    let area = 0;
    for (let t = 0; t < triangles; t++) {
      const a = part.indices[t * 3]! * 3;
      const b = part.indices[t * 3 + 1]! * 3;
      const c = part.indices[t * 3 + 2]! * 3;
      const abx = positions[b]! - positions[a]!;
      const aby = positions[b + 1]! - positions[a + 1]!;
      const abz = positions[b + 2]! - positions[a + 2]!;
      const acx = positions[c]! - positions[a]!;
      const acy = positions[c + 1]! - positions[a + 1]!;
      const acz = positions[c + 2]! - positions[a + 2]!;
      const cx = aby * acz - abz * acy;
      const cy = abz * acx - abx * acz;
      const cz = abx * acy - aby * acx;
      area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
      cumulative[t] = area;
    }
    return { cls: part.cls, positions, indices: part.indices, cumulative, area };
  });

  // 兩端的端點：長軸上最前與最後的頂點（單位形的 x 就是 ±0.5）
  const anchorOf = (front: boolean) => {
    let best = { part: 0, vertex: 0, x: front ? -Infinity : Infinity };
    parts.forEach((part, k) => {
      for (let i = 0; i < part.positions.length / 3; i++) {
        const x = part.positions[i * 3]!;
        if (front ? x > best.x : x < best.x) best = { part: k, vertex: i, x };
      }
    });
    return best;
  };
  const anchors = [anchorOf(true), anchorOf(false)];

  // ── 配額：每個零件分到幾個表面點 ───────────────────────────────
  const surface = Math.round(count * SURFACE_SHARE);
  const budget = surface - ANCHORS;
  const weights = parts.map((p) => (p.area > 0 ? Math.pow(p.area, AREA_POWER) * BOOST[p.cls] : 0));
  const redIndex = parts.flatMap((p, k) => (p.cls === 4 && weights[k]! > 0 ? [k] : []));
  const otherIndex = parts.flatMap((_, k) => (redIndex.includes(k) ? [] : [k]));
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new RangeError('快照的零件面積全為 0');
  const redWeight = redIndex.reduce((sum, k) => sum + weights[k]!, 0);
  const red = redIndex.length === 0 ? 0 : Math.min(budget, Math.max(Math.round((redWeight / total) * budget), Math.ceil(count * RED_MIN_SHARE)));
  const quota = new Array<number>(parts.length).fill(0);
  apportion(redIndex.map((k) => weights[k]!), red).forEach((n, i) => (quota[redIndex[i]!] = n));
  apportion(otherIndex.map((k) => weights[k]!), budget - red).forEach((n, i) => (quota[otherIndex[i]!] = n));

  // ── 取樣 ────────────────────────────────────────────────────
  const random = rng(seed);
  const positions = new Float32Array(count * 3);
  const kinds = new Uint8Array(count);
  let at = 0;

  anchors.forEach((anchor) => {
    const part = parts[anchor.part]!;
    positions[at * 3] = part.positions[anchor.vertex * 3]!;
    positions[at * 3 + 1] = part.positions[anchor.vertex * 3 + 1]!;
    positions[at * 3 + 2] = part.positions[anchor.vertex * 3 + 2]!;
    kinds[at] = KIND_OF[part.cls];
    at++;
  });

  const jitterY = TRIAL_JITTER_Y / referenceLength;
  const jitterZ = TRIAL_JITTER_Z / referenceLength;
  parts.forEach((part, k) => {
    for (let n = 0; n < quota[k]!; n++, at++) {
      // 依面積挑三角形，再在三角形內取均勻的一點
      const pick = random() * part.area;
      let from = 0;
      let to = part.cumulative.length - 1;
      while (from < to) {
        const mid = (from + to) >> 1;
        if (part.cumulative[mid]! < pick) from = mid + 1;
        else to = mid;
      }
      const a = part.indices[from * 3]! * 3;
      const b = part.indices[from * 3 + 1]! * 3;
      const c = part.indices[from * 3 + 2]! * 3;
      const r1 = Math.sqrt(random());
      const r2 = random();
      const wa = 1 - r1;
      const wb = r1 * (1 - r2);
      const wc = r1 * r2;
      positions[at * 3] = part.positions[a]! * wa + part.positions[b]! * wb + part.positions[c]! * wc;
      let y = part.positions[a + 1]! * wa + part.positions[b + 1]! * wb + part.positions[c + 1]! * wc;
      let z = part.positions[a + 2]! * wa + part.positions[b + 2]! * wb + part.positions[c + 2]! * wc;
      if (part.cls === 5 && Math.hypot(y, z) < DARK_SPREAD) {
        // 細桿：垂直軸向的圓盤散布，均勻佈滿半徑 DARK_SPREAD 的圓
        const angle = random() * Math.PI * 2;
        const radius = DARK_SPREAD * Math.sqrt(random());
        y = Math.cos(angle) * radius;
        z = Math.sin(angle) * radius;
      } else {
        y += (random() - 0.5) * jitterY;
        z += (random() - 0.5) * jitterZ;
      }
      positions[at * 3 + 1] = y;
      positions[at * 3 + 2] = z;
      kinds[at] = KIND_OF[part.cls];
    }
  });
  if (at !== surface) throw new Error(`表面點數 ${at} ≠ 預期 ${surface}（配額計算有誤）`);

  // 其餘是貼著兵器的氣：從某個表面點往隨機方向延伸一小段
  for (; at < count; at++) {
    const origin = Math.floor(random() * surface);
    const reach = (AURA_NEAR + Math.pow(random(), AURA_CURVE) * AURA_SPAN) / referenceLength;
    const u = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - u * u);
    positions[at * 3] = positions[origin * 3]! + Math.cos(angle) * ring * reach;
    positions[at * 3 + 1] = positions[origin * 3 + 1]! + u * reach;
    positions[at * 3 + 2] = positions[origin * 3 + 2]! + Math.sin(angle) * ring * reach;
    kinds[at] = KIND.AURA;
  }

  // 打散：哪個光點去兵器的哪一段要是亂的（變形時才是整團重組，載入時取前綴也是縮影）
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = order[i]!;
    order[i] = order[j]!;
    order[j] = t;
  }
  const shuffledPositions = new Float32Array(count * 3);
  const shuffledKinds = new Uint8Array(count);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const from = order[i]!;
    shuffledKinds[i] = kinds[from]!;
    for (let a = 0; a < 3; a++) {
      const v = positions[from * 3 + a]!;
      shuffledPositions[i * 3 + a] = v;
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
  }
  return { count, positions: shuffledPositions, kinds: shuffledKinds, min, max };
}
