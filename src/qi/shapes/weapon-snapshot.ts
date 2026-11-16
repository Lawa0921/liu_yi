/**
 * 兵器幾何快照 `.geo` v1（D29）：把 `weapons.ts` 建出來的三角網格存成入庫的小檔，
 * 好讓建置與執行時都不必 import `weapons.ts`（與它背後的 three 建模）。
 *
 *   header（80 B，小端）
 *     0  魔數 'QWG1'
 *     4  u16 版本（= 1）
 *     6  u8 名稱（0 jian、1 miaodao、2 spear）
 *     7  u8 零件數
 *     8  f32 tip（鋒尖的 Y）、12 f32 butt（尾端的 Y）：`weapons.ts` 宣告的值，公尺
 *     16 f32×3 min、28 f32×3 max：全部頂點的外框（量化的基準）
 *     40 ASCII×40：`weapons.ts` 的 `git hash-object`（沒有就全 0），讓快照可以追溯到哪一版建模
 *   其後每個零件：
 *     u8 cls（2 鋼、3 銅、4 紅纓、5 暗色＝柄與桿）、u8 索引寬度（2 或 4）、u16 保留（0）、u32 頂點數、u32 索引數
 *     int16 x[頂點數]、int16 y[]、int16 z[]（依 min／max 線性量化到 −32768…32767，平面化）
 *     索引（u16 或 u32，頂點數 ≤ 65 535 用 u16）
 *
 * 座標沿用 `weapons.ts` 的原座標（長軸 +Y、公尺、刃面朝 ±Z）。唯一的姿勢處理在產生快照的腳本裡：
 * 纓穗已繞自己的紮點轉到「朝 +X」，等長軸平放到 +x 之後它才會朝下（見 `scripts/qi/snapshot-weapons.ts`）。
 */

export interface WeaponPart {
  /** 2 鋼、3 銅、4 紅纓、5 暗色（柄、桿）。 */
  cls: 2 | 3 | 4 | 5;
  /** xyz 交錯，長度 = 頂點數 × 3。 */
  positions: Float32Array;
  indices: Uint32Array;
}

export interface WeaponSnapshot {
  name: 'jian' | 'miaodao' | 'spear';
  /** `weapons.ts` 宣告的鋒尖與尾端（Y，公尺）。 */
  tip: number;
  butt: number;
  parts: WeaponPart[];
  /** 產生這份快照時 `weapons.ts` 的 `git hash-object`（40 位十六進位）；未知就省略。 */
  sourceHash?: string;
}

const MAGIC = [0x51, 0x57, 0x47, 0x31] as const; // 'QWG1'
const VERSION = 1;
const HEADER_BYTES = 80;
const HASH_AT = 40;
const HASH_BYTES = 40;
const PART_HEADER_BYTES = 12;
const NAMES = ['jian', 'miaodao', 'spear'] as const;
const CLASSES = [2, 3, 4, 5] as const;
/** int16 一共 65 536 格，量化步長 = 外框 / 65 535。 */
const QUANT = 65535;
const INT16_MIN = -32768;
const MAX_U16_VERTICES = 65535;

const indexWidth = (vertices: number): 2 | 4 => (vertices <= MAX_U16_VERTICES ? 2 : 4);

export function encodeSnapshot(s: WeaponSnapshot): Uint8Array {
  const nameCode = NAMES.indexOf(s.name);
  if (nameCode < 0) throw new RangeError(`未知的兵器名稱：${String(s.name)}`);
  if (s.parts.length === 0 || s.parts.length > 255) throw new RangeError(`零件數必須在 1–255 之間：${s.parts.length}`);
  if (s.sourceHash !== undefined && !/^[0-9a-f]{40}$/.test(s.sourceHash)) throw new RangeError(`sourceHash 必須是 40 位小寫十六進位：${s.sourceHash}`);

  let bytesNeeded = HEADER_BYTES;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  s.parts.forEach((part, k) => {
    if (!(CLASSES as readonly number[]).includes(part.cls)) throw new RangeError(`零件 ${k} 的 cls 不合法：${String(part.cls)}（只認 2–5）`);
    if (part.positions.length % 3 !== 0) throw new RangeError(`零件 ${k} 的 positions 長度 ${part.positions.length} 不是 3 的倍數`);
    if (part.indices.length % 3 !== 0) throw new RangeError(`零件 ${k} 的索引數 ${part.indices.length} 不是 3 的倍數`);
    const vertices = part.positions.length / 3;
    for (const index of part.indices) {
      if (index >= vertices) throw new RangeError(`零件 ${k} 的索引 ${index} 越界（頂點數 ${vertices}）`);
    }
    for (let i = 0; i < part.positions.length; i++) {
      const a = i % 3;
      const v = part.positions[i]!;
      if (!Number.isFinite(v)) throw new RangeError(`零件 ${k} 的頂點含非有限數值`);
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
    bytesNeeded += PART_HEADER_BYTES + vertices * 6 + part.indices.length * indexWidth(vertices);
  });

  const bytes = new Uint8Array(bytesNeeded);
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC, 0);
  view.setUint16(4, VERSION, true);
  view.setUint8(6, nameCode);
  view.setUint8(7, s.parts.length);
  view.setFloat32(8, s.tip, true);
  view.setFloat32(12, s.butt, true);
  // header 存的是 f32；量化也用 f32 取整後的外框，編碼與解碼才用同一把尺。
  const lo = min.map(Math.fround);
  const hi = max.map(Math.fround);
  for (let a = 0; a < 3; a++) {
    view.setFloat32(16 + a * 4, lo[a]!, true);
    view.setFloat32(28 + a * 4, hi[a]!, true);
  }
  if (s.sourceHash !== undefined) bytes.set(new TextEncoder().encode(s.sourceHash), HASH_AT);

  let at = HEADER_BYTES;
  for (const part of s.parts) {
    const vertices = part.positions.length / 3;
    const width = indexWidth(vertices);
    view.setUint8(at, part.cls);
    view.setUint8(at + 1, width);
    view.setUint16(at + 2, 0, true);
    view.setUint32(at + 4, vertices, true);
    view.setUint32(at + 8, part.indices.length, true);
    at += PART_HEADER_BYTES;
    for (let a = 0; a < 3; a++) {
      const base = lo[a]!;
      const range = hi[a]! - base;
      for (let i = 0; i < vertices; i++) {
        const t = range > 0 ? ((part.positions[i * 3 + a]! - base) / range) * QUANT : 0;
        view.setInt16(at + i * 2, Math.min(QUANT, Math.max(0, Math.round(t))) + INT16_MIN, true);
      }
      at += vertices * 2;
    }
    for (let i = 0; i < part.indices.length; i++) {
      if (width === 2) view.setUint16(at + i * 2, part.indices[i]!, true);
      else view.setUint32(at + i * 4, part.indices[i]!, true);
    }
    at += part.indices.length * width;
  }
  return bytes;
}

export function decodeSnapshot(b: Uint8Array): WeaponSnapshot {
  if (b.byteLength < HEADER_BYTES) throw new Error(`兵器快照長度 ${b.byteLength} B 不足 header（${HEADER_BYTES} B）`);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < MAGIC.length; i++) {
    if (b[i] !== MAGIC[i]) throw new Error('兵器快照魔數不符（應為 QWG1）');
  }
  const version = view.getUint16(4, true);
  if (version !== VERSION) throw new Error(`不支援的兵器快照版本 ${version}（只認 ${VERSION}）`);
  const name = NAMES[view.getUint8(6)];
  if (!name) throw new Error(`兵器快照的名稱碼 ${view.getUint8(6)} 未定義`);
  const partCount = view.getUint8(7);
  const tip = view.getFloat32(8, true);
  const butt = view.getFloat32(12, true);
  const min = [view.getFloat32(16, true), view.getFloat32(20, true), view.getFloat32(24, true)];
  const max = [view.getFloat32(28, true), view.getFloat32(32, true), view.getFloat32(36, true)];

  const hashBytes = b.subarray(HASH_AT, HASH_AT + HASH_BYTES);
  const sourceHash = hashBytes.some((v) => v !== 0) ? new TextDecoder().decode(hashBytes) : undefined;

  const parts: WeaponPart[] = [];
  let at = HEADER_BYTES;
  for (let k = 0; k < partCount; k++) {
    if (at + PART_HEADER_BYTES > b.byteLength) throw new Error(`兵器快照被截斷：零件 ${k} 的檔頭超出長度（${b.byteLength} B）`);
    const cls = view.getUint8(at);
    const width = view.getUint8(at + 1);
    const vertices = view.getUint32(at + 4, true);
    const indexCount = view.getUint32(at + 8, true);
    if (!(CLASSES as readonly number[]).includes(cls)) throw new Error(`零件 ${k} 的 cls ${cls} 未定義`);
    if (width !== 2 && width !== 4) throw new Error(`零件 ${k} 的索引寬度 ${width} 未定義`);
    at += PART_HEADER_BYTES;
    const need = vertices * 6 + indexCount * width;
    if (at + need > b.byteLength) throw new Error(`兵器快照長度 ${b.byteLength} B 不足（零件 ${k} 還需要 ${need} B，被截斷）`);

    const positions = new Float32Array(vertices * 3);
    for (let a = 0; a < 3; a++) {
      const range = max[a]! - min[a]!;
      for (let i = 0; i < vertices; i++) {
        positions[i * 3 + a] = min[a]! + ((view.getInt16(at + i * 2, true) - INT16_MIN) / QUANT) * range;
      }
      at += vertices * 2;
    }
    const indices = new Uint32Array(indexCount);
    for (let i = 0; i < indexCount; i++) {
      const index = width === 2 ? view.getUint16(at + i * 2, true) : view.getUint32(at + i * 4, true);
      if (index >= vertices) throw new Error(`零件 ${k} 的索引 ${index} 越界（頂點數 ${vertices}）`);
      indices[i] = index;
    }
    at += indexCount * width;
    parts.push({ cls: cls as WeaponPart['cls'], positions, indices });
  }
  if (at !== b.byteLength) throw new Error(`兵器快照長度 ${b.byteLength} B ≠ 預期 ${at} B（尾端多出資料）`);

  const snapshot: WeaponSnapshot = { name, tip, butt, parts };
  if (sourceHash !== undefined) snapshot.sourceHash = sourceHash;
  return snapshot;
}
