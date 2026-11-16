/**
 * 形體檔 `.bin` v1（D10）：一個形體 = 固定 N 個光點的目標位置與種類。
 *
 *   header（40 B，小端）
 *     0  魔數 'QSH1'
 *     4  u16 版本（= 1）
 *     6  u16 flags（目前 0）
 *     8  u32 count
 *     12 f32×3 min（x, y, z 外框下界，量化的基準）
 *     24 f32×3 max
 *     36 u32 保留（0）
 *   其後（平面化）：u16 x[count]、u16 y[count]、u16 z[count]（依 min／max 線性量化到 0–65535）、u8 kinds[count]
 *
 * `kind`：0–99 是人形「靠近輪廓的程度」（99＝輪廓帶）；100 以上是兵器與朱印的種類。
 * 環境煙（D14）不進檔，由執行時程序化產生。
 */

/** 每個形體檔固定的點數（D10）。 */
export const SHAPE_COUNT = 16384;

/** 非人形的種類；0–99 保留給人形。 */
export const KIND = { STEEL: 100, BRASS: 101, RED: 102, DARK: 103, AURA: 104, SEAL: 105 } as const;

export interface Shape {
  count: number;
  /** xyz 交錯，長度 count × 3。 */
  positions: Float32Array;
  kinds: Uint8Array;
  min: [number, number, number];
  max: [number, number, number];
}

const MAGIC = [0x51, 0x53, 0x48, 0x31] as const; // 'QSH1'
const VERSION = 1;
const HEADER_BYTES = 40;
const QUANT = 65535;

/** 一個點在檔裡占 3 × u16 + u8。 */
const bodyBytes = (count: number): number => count * 7;

export function encodeShape(s: Shape): Uint8Array {
  const { count } = s;
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`形體 count 不合法：${count}`);
  if (s.positions.length !== count * 3) throw new RangeError(`positions 長度 ${s.positions.length} ≠ count × 3（${count * 3}）`);
  if (s.kinds.length !== count) throw new RangeError(`kinds 長度 ${s.kinds.length} ≠ count（${count}）`);

  const bytes = new Uint8Array(HEADER_BYTES + bodyBytes(count));
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC, 0);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, count, true);
  // header 存的是 f32；量化也用 f32 取整後的 min／max，編碼與解碼才用同一把尺。
  const min = s.min.map(Math.fround);
  const max = s.max.map(Math.fround);
  for (let a = 0; a < 3; a++) {
    view.setFloat32(12 + a * 4, min[a]!, true);
    view.setFloat32(24 + a * 4, max[a]!, true);
  }
  view.setUint32(36, 0, true);

  for (let a = 0; a < 3; a++) {
    const lo = min[a]!;
    const range = max[a]! - lo;
    const base = HEADER_BYTES + a * count * 2;
    for (let i = 0; i < count; i++) {
      const t = range > 0 ? ((s.positions[i * 3 + a]! - lo) / range) * QUANT : 0;
      view.setUint16(base + i * 2, Math.min(QUANT, Math.max(0, Math.round(t))), true);
    }
  }
  bytes.set(s.kinds, HEADER_BYTES + count * 6);
  return bytes;
}

export function decodeShape(b: Uint8Array): Shape {
  if (b.byteLength < HEADER_BYTES) throw new Error(`形體檔長度 ${b.byteLength} B 不足 header（${HEADER_BYTES} B）`);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < MAGIC.length; i++) {
    if (b[i] !== MAGIC[i]) throw new Error('形體檔魔數不符（應為 QSH1）');
  }
  const version = view.getUint16(4, true);
  if (version !== VERSION) throw new Error(`不支援的形體檔版本 ${version}（只認 ${VERSION}）`);
  const count = view.getUint32(8, true);
  const expected = HEADER_BYTES + bodyBytes(count);
  if (b.byteLength !== expected) throw new Error(`形體檔長度 ${b.byteLength} B ≠ 預期 ${expected} B（count = ${count}）`);

  const min: [number, number, number] = [view.getFloat32(12, true), view.getFloat32(16, true), view.getFloat32(20, true)];
  const max: [number, number, number] = [view.getFloat32(24, true), view.getFloat32(28, true), view.getFloat32(32, true)];
  const positions = new Float32Array(count * 3);
  for (let a = 0; a < 3; a++) {
    const range = max[a]! - min[a]!;
    const base = HEADER_BYTES + a * count * 2;
    for (let i = 0; i < count; i++) {
      positions[i * 3 + a] = min[a]! + (view.getUint16(base + i * 2, true) / QUANT) * range;
    }
  }
  // 明確拷貝：Node 的 Buffer.slice 與 subarray 一樣共用記憶體，不能依賴 slice 的語意
  const kinds = new Uint8Array(count);
  kinds.set(b.subarray(HEADER_BYTES + count * 6, expected));
  return { count, positions, kinds, min, max };
}

/** kind → 著色器用的 w：人形 0–99 → 0–1；STEEL..AURA → 2..6；SEAL → 7。 */
export function kindToW(kind: number): number {
  if (!Number.isInteger(kind) || kind < 0 || kind > KIND.SEAL) throw new RangeError(`未定義的 kind：${kind}`);
  if (kind <= 99) return kind / 99;
  return kind - 98;
}
