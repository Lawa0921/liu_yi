import { describe, expect, it } from 'vitest';
import { decodeShape, encodeShape, KIND, kindToW, SHAPE_COUNT, type Shape } from '../../src/qi/shapes/format';

/** 固定種子的小亂數，讓測試資料可重現。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeShape(count = SHAPE_COUNT): Shape {
  const random = lcg(42);
  const positions = new Float32Array(count * 3);
  const kinds = new Uint8Array(count);
  const min: [number, number, number] = [-1.3, 0, -0.29];
  const max: [number, number, number] = [1.45, 2.05, 0.3];
  for (let i = 0; i < count; i++) {
    for (let a = 0; a < 3; a++) positions[i * 3 + a] = min[a]! + random() * (max[a]! - min[a]!);
    kinds[i] = i % 3 === 0 ? 99 : Math.floor(random() * 60);
  }
  return { count, positions, kinds, min, max };
}

describe('形體檔格式 QSH1 v1', () => {
  it('一檔固定 16 384 點，byteLength === 40 + 7 × 16 384（114 728 B）', () => {
    expect(SHAPE_COUNT).toBe(16384);
    const bytes = encodeShape(makeShape());
    expect(bytes.byteLength).toBe(40 + 7 * 16384);
    expect(bytes.byteLength).toBe(114_728);
  });

  it('header：魔數 QSH1、版本 1、count 與 min／max 就位', () => {
    const shape = makeShape(64);
    const bytes = encodeShape(shape);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)).toBe('QSH1');
    expect(view.getUint16(4, true)).toBe(1);
    expect(view.getUint32(8, true)).toBe(64);
    expect(view.getUint16(6, true)).toBe(0); // flags
    expect(view.getFloat32(12, true)).toBeCloseTo(shape.min[0], 6);
    expect(view.getFloat32(20, true)).toBeCloseTo(shape.min[2], 6);
    expect(view.getFloat32(24, true)).toBeCloseTo(shape.max[0], 6);
    expect(view.getFloat32(32, true)).toBeCloseTo(shape.max[2], 6);
    expect(view.getUint32(36, true)).toBe(0); // 保留
  });

  it('往返誤差 ≤ (max−min)/65535 + 1e-6，kinds 逐位元相同', () => {
    const shape = makeShape();
    const back = decodeShape(encodeShape(shape));
    expect(back.count).toBe(shape.count);
    expect(Array.from(back.kinds)).toEqual(Array.from(shape.kinds));
    for (let a = 0; a < 3; a++) {
      const tolerance = (shape.max[a]! - shape.min[a]!) / 65535 + 1e-6;
      let worst = 0;
      for (let i = 0; i < shape.count; i++) {
        worst = Math.max(worst, Math.abs(back.positions[i * 3 + a]! - shape.positions[i * 3 + a]!));
      }
      expect(worst).toBeLessThanOrEqual(tolerance);
    }
    for (let a = 0; a < 3; a++) {
      expect(back.min[a]).toBeCloseTo(shape.min[a]!, 5);
      expect(back.max[a]).toBeCloseTo(shape.max[a]!, 5);
    }
  });

  it('某一軸 min === max（整片貼平）也能往返，不出現 NaN', () => {
    const shape: Shape = {
      count: 4,
      positions: new Float32Array([0.5, 0, 0.25, 1, 1, 0.25, -1, 2, 0.25, 0, 0.5, 0.25]),
      kinds: new Uint8Array([0, 10, 99, 105]),
      min: [-1, 0, 0.25],
      max: [1, 2, 0.25],
    };
    const back = decodeShape(encodeShape(shape));
    for (let i = 0; i < 4; i++) expect(back.positions[i * 3 + 2]).toBeCloseTo(0.25, 6);
    expect(back.positions.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('decode 回傳的是拷貝，不與輸入共用記憶體；也接受有 byteOffset 的 view', () => {
    const bytes = encodeShape(makeShape(32));
    const padded = new Uint8Array(bytes.byteLength + 5);
    padded.set(bytes, 5);
    const view = padded.subarray(5);
    const back = decodeShape(view);
    expect(back.count).toBe(32);
    view.fill(0);
    expect(back.kinds.some((k) => k !== 0)).toBe(true);
  });

  it('輸入是 Node Buffer 時，decode 回傳的 kinds 也不與輸入共用記憶體', () => {
    // Buffer.prototype.slice 是 subarray 的別名（共用記憶體），不是拷貝
    const source = Buffer.from(encodeShape(makeShape(32)));
    const back = decodeShape(source);
    const before = Array.from(back.kinds);
    source.fill(0xff);
    expect(Array.from(back.kinds)).toEqual(before);
    expect(back.kinds.buffer).not.toBe(source.buffer);
    expect(back.kinds.byteLength).toBe(32); // 不帶著整個 Buffer 池
    expect(back.kinds.buffer.byteLength).toBe(32);
  });

  it('手算位元組：3 個點，平面化的小端排列、端點量化 0／65535、kinds 在 40 + 6N', () => {
    const shape: Shape = {
      count: 3,
      positions: new Float32Array([
        -1, 0.5, -0.5, // p0：三軸都在下界
        1, 2.5, 0.5, // p1：三軸都在上界
        0.5, 1.5, -0.25, // p2：x 3/4、y 1/2、z 1/4
      ]),
      kinds: new Uint8Array([0, 99, 105]),
      min: [-1, 0.5, -0.5],
      max: [1, 2.5, 0.5],
    };
    // 量化：round((v − min) / (max − min) × 65535)
    //   x：p0 0、p1 65535、p2 0.75 × 65535 = 49151.25 → 49151 = 0xBFFF
    //   y：p0 0、p1 65535、p2 0.5 × 65535 = 32767.5 → 32768 = 0x8000
    //   z：p0 0、p1 65535、p2 0.25 × 65535 = 16383.75 → 16384 = 0x4000
    const expected = Uint8Array.from([
      // header（40 B）
      0x51, 0x53, 0x48, 0x31, // 'QSH1'
      0x01, 0x00, // 版本 1
      0x00, 0x00, // flags
      0x03, 0x00, 0x00, 0x00, // count = 3
      0x00, 0x00, 0x80, 0xbf, // min.x = −1.0
      0x00, 0x00, 0x00, 0x3f, // min.y = 0.5
      0x00, 0x00, 0x00, 0xbf, // min.z = −0.5
      0x00, 0x00, 0x80, 0x3f, // max.x = 1.0
      0x00, 0x00, 0x20, 0x40, // max.y = 2.5
      0x00, 0x00, 0x00, 0x3f, // max.z = 0.5
      0x00, 0x00, 0x00, 0x00, // 保留
      // x[]（偏移 40）
      0x00, 0x00, 0xff, 0xff, 0xff, 0xbf,
      // y[]（偏移 40 + 2N = 46）
      0x00, 0x00, 0xff, 0xff, 0x00, 0x80,
      // z[]（偏移 40 + 4N = 52）
      0x00, 0x00, 0xff, 0xff, 0x00, 0x40,
      // kinds（偏移 40 + 6N = 58）
      0x00, 0x63, 0x69,
    ]);
    expect(expected.length).toBe(40 + 7 * 3);
    const bytes = encodeShape(shape);
    expect(Array.from(bytes)).toEqual(Array.from(expected));
    // kinds 的偏移量
    expect(Array.from(bytes.subarray(40 + 6 * 3))).toEqual([0, 99, 105]);

    // 反向：手算的位元組解得回來
    const back = decodeShape(expected);
    expect(Array.from(back.kinds)).toEqual([0, 99, 105]);
    expect(back.min[1]).toBe(0.5);
    expect(back.max[1]).toBe(2.5);
    expect(back.positions[0]).toBe(-1);
    expect(back.positions[3]).toBe(1);
    expect(back.positions[4]).toBe(2.5);
  });

  it('壞魔數、版本 2、截短資料、多出資料各自 throw', () => {
    const good = encodeShape(makeShape(64));

    const badMagic = good.slice();
    badMagic[0] = 'X'.charCodeAt(0);
    expect(() => decodeShape(badMagic)).toThrow(/魔數|magic/i);

    const v2 = good.slice();
    new DataView(v2.buffer).setUint16(4, 2, true);
    expect(() => decodeShape(v2)).toThrow(/版本|version/i);

    expect(() => decodeShape(good.slice(0, good.byteLength - 1))).toThrow(/長度|length/i);
    expect(() => decodeShape(good.slice(0, 39))).toThrow(/長度|length/i);
    expect(() => decodeShape(new Uint8Array(0))).toThrow();

    const extra = new Uint8Array(good.byteLength + 1);
    extra.set(good);
    expect(() => decodeShape(extra)).toThrow(/長度|length/i);
  });

  it('encode：positions、kinds 與 count 不一致時 throw', () => {
    const shape = makeShape(8);
    expect(() => encodeShape({ ...shape, count: 9 })).toThrow();
    expect(() => encodeShape({ ...shape, kinds: new Uint8Array(7) })).toThrow();
  });

  it('kindToW：0–99 → kind/99；STEEL..AURA → 2..6；SEAL → 7', () => {
    expect(kindToW(0)).toBe(0);
    expect(kindToW(50)).toBeCloseTo(0.505, 3);
    expect(kindToW(99)).toBe(1);
    expect(kindToW(KIND.STEEL)).toBe(2);
    expect(kindToW(KIND.BRASS)).toBe(3);
    expect(kindToW(KIND.RED)).toBe(4);
    expect(kindToW(KIND.DARK)).toBe(5);
    expect(kindToW(KIND.AURA)).toBe(6);
    expect(kindToW(KIND.SEAL)).toBe(7);
  });

  it('kindToW：超出定義的 kind（106、−1、非整數）throw', () => {
    expect(() => kindToW(106)).toThrow(RangeError);
    expect(() => kindToW(-1)).toThrow(RangeError);
    expect(() => kindToW(1.5)).toThrow(RangeError);
  });

  it('KIND 常數值：人形 0–99 之外從 100 起', () => {
    expect(KIND).toEqual({ STEEL: 100, BRASS: 101, RED: 102, DARK: 103, AURA: 104, SEAL: 105 });
  });
});
