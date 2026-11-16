import { describe, expect, it } from 'vitest';
import { ambientField, expandTargets, flowTargets, weaponLayout, type AmbientField } from '../../src/qi/shapes/expand';
import { KIND, kindToW, SHAPE_COUNT, type Shape } from '../../src/qi/shapes/format';
import { rng } from '../../src/qi/shapes/rng';

/** 假形體：N 個打散序取樣，座標落在 [-1, 1]³，kind 是人形（0–99）與兵器（100–105）混合。 */
function synthShape(seed: number, count = SHAPE_COUNT, kinds: 'figure' | 'mixed' = 'mixed'): Shape {
  const random = rng(seed);
  const positions = new Float32Array(count * 3);
  const kindArray = new Uint8Array(count);
  for (let i = 0; i < count * 3; i++) positions[i] = random() * 2 - 1;
  for (let i = 0; i < count; i++) {
    kindArray[i] = kinds === 'figure' || random() < 0.5 ? Math.floor(random() * 100) : 100 + Math.floor(random() * 6);
  }
  return { count, positions, kinds: kindArray, min: [-1, -1, -1], max: [1, 1, 1] };
}

/** 非環境煙格的索引（依序）。 */
const solidSlots = (ambient: AmbientField): number[] => {
  const slots: number[] = [];
  for (let i = 0; i < ambient.mask.length; i++) if (!ambient.mask[i]) slots.push(i);
  return slots;
};

const dist3 = (a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number): number =>
  Math.hypot(a[ai]! - b[bi]!, a[ai + 1]! - b[bi + 1]!, a[ai + 2]! - b[bi + 2]!);

describe('ambientField（D14：環境煙 7%，所有姿勢共用）', () => {
  it('65536 格：mask 只有 0／1，1 的比例 0.07 ± 0.005', () => {
    const { mask } = ambientField(65536);
    expect(mask).toHaveLength(65536);
    let ones = 0;
    for (const v of mask) {
      expect(v === 0 || v === 1).toBe(true);
      ones += v;
    }
    expect(Math.abs(ones / 65536 - 0.07)).toBeLessThanOrEqual(0.005);
  });

  it('各 tier 的格數（36 864／20 736／12 544）比例都在 0.07 ± 0.01', () => {
    for (const n of [192 * 192, 144 * 144, 112 * 112]) {
      const { mask } = ambientField(n);
      const ratio = mask.reduce((a, b) => a + b, 0) / n;
      expect(Math.abs(ratio - 0.07)).toBeLessThanOrEqual(0.01);
    }
  });

  it('同 seed 逐位元相同；預設 seed 是 7；不同 seed 不同', () => {
    const a = ambientField(4096, 7);
    const b = ambientField(4096, 7);
    const dflt = ambientField(4096);
    expect(Buffer.from(a.mask.buffer).equals(Buffer.from(b.mask.buffer))).toBe(true);
    expect(Buffer.from(a.positions.buffer).equals(Buffer.from(b.positions.buffer))).toBe(true);
    expect(Buffer.from(dflt.mask.buffer).equals(Buffer.from(a.mask.buffer))).toBe(true);
    expect(Buffer.from(dflt.positions.buffer).equals(Buffer.from(a.positions.buffer))).toBe(true);
    const other = ambientField(4096, 8);
    expect(Buffer.from(other.mask.buffer).equals(Buffer.from(a.mask.buffer))).toBe(false);
  });

  it('positions 長度 count × 3；煙格在人物四周的扁殼內，其餘格是 0', () => {
    const { mask, positions } = ambientField(20736);
    expect(positions).toHaveLength(20736 * 3);
    for (let i = 0; i < mask.length; i++) {
      const [x, y, z] = [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
      if (!mask[i]) {
        expect([x, y, z]).toEqual([0, 0, 0]);
        continue;
      }
      expect(Math.abs(x)).toBeLessThanOrEqual(5.8 + 1e-4);
      expect(y).toBeGreaterThanOrEqual(-0.2 - 1e-4);
      expect(y).toBeLessThanOrEqual(3.4 + 1e-4);
      // 水平半徑 1.3–5.8（z 壓成 0.8 倍再往後挪 0.8）：離人物至少 1.3 以上，不會糊在人形裡
      expect(Math.hypot(x, (z + 0.8) / 0.8)).toBeGreaterThanOrEqual(1.3 - 1e-3);
    }
  });

  it('count 為 0 回空；負數或非整數 → RangeError', () => {
    expect(ambientField(0).mask).toHaveLength(0);
    expect(() => ambientField(-1)).toThrow(RangeError);
    expect(() => ambientField(1.5)).toThrow(RangeError);
  });
});

describe('expandTargets', () => {
  it('輸出長度 size × size × 4', () => {
    const ambient = ambientField(112 * 112);
    expect(expandTargets(synthShape(1), 112, ambient)).toHaveLength(112 * 112 * 4);
  });

  it('size = 112（12 544 格 ≤ N）：非環境煙的第 j 個點座標與 w 等於 shape 的第 j 個取樣（前綴，無抖動）', () => {
    const shape = synthShape(2);
    const ambient = ambientField(112 * 112);
    const out = expandTargets(shape, 112, ambient);
    const slots = solidSlots(ambient);
    expect(slots.length).toBeLessThanOrEqual(SHAPE_COUNT);
    slots.forEach((slot, j) => {
      expect(out[slot * 4]).toBe(shape.positions[j * 3]);
      expect(out[slot * 4 + 1]).toBe(shape.positions[j * 3 + 1]);
      expect(out[slot * 4 + 2]).toBe(shape.positions[j * 3 + 2]);
      expect(out[slot * 4 + 3]).toBe(Math.fround(kindToW(shape.kinds[j]!)));
    });
  });

  it('環境煙格 w === -1 且座標取自 ambient；人形格 0 ≤ w ≤ 1', () => {
    const shape = synthShape(3, SHAPE_COUNT, 'figure');
    const ambient = ambientField(144 * 144);
    const out = expandTargets(shape, 144, ambient);
    for (let i = 0; i < ambient.mask.length; i++) {
      const w = out[i * 4 + 3]!;
      if (ambient.mask[i]) {
        expect(w).toBe(-1);
        expect([out[i * 4], out[i * 4 + 1], out[i * 4 + 2]]).toEqual([ambient.positions[i * 3], ambient.positions[i * 3 + 1], ambient.positions[i * 3 + 2]]);
      } else {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
  });

  it('兵器與朱印的 kind 對應 w 2–7（不會落到 −1）', () => {
    const count = SHAPE_COUNT;
    const kinds = new Uint8Array(count);
    const palette = [KIND.STEEL, KIND.BRASS, KIND.RED, KIND.DARK, KIND.AURA, KIND.SEAL];
    for (let i = 0; i < count; i++) kinds[i] = palette[i % palette.length]!;
    const shape: Shape = { ...synthShape(4), kinds };
    const ambient = ambientField(112 * 112);
    const out = expandTargets(shape, 112, ambient);
    const seen = new Set<number>();
    for (const slot of solidSlots(ambient)) seen.add(out[slot * 4 + 3]!);
    expect([...seen].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('size = 256：第 N + k 個與第 k 個的距離 ≤ 0.006√3，且確實有抖動；w 與原點相同', () => {
    const shape = synthShape(5);
    const ambient = ambientField(256 * 256);
    const out = expandTargets(shape, 256, ambient);
    expect(out).toHaveLength(256 * 256 * 4);
    const slots = solidSlots(ambient);
    expect(slots.length).toBeGreaterThan(SHAPE_COUNT * 3); // 要涵蓋到第 2、第 3 輪重複
    const limit = 0.006 * Math.sqrt(3) + 1e-6;
    let jittered = 0;
    let maxAxis = 0;
    slots.forEach((slot, j) => {
      const source = j % SHAPE_COUNT;
      if (j < SHAPE_COUNT) {
        // 第一輪不抖
        expect(out[slot * 4]).toBe(shape.positions[source * 3]);
        return;
      }
      expect(dist3(out, slot * 4, shape.positions, source * 3)).toBeLessThanOrEqual(limit);
      expect(out[slot * 4 + 3]).toBe(Math.fround(kindToW(shape.kinds[source]!)));
      for (let a = 0; a < 3; a++) {
        const d = Math.abs(out[slot * 4 + a]! - shape.positions[source * 3 + a]!);
        expect(d).toBeLessThanOrEqual(0.006 + 1e-6);
        maxAxis = Math.max(maxAxis, d);
      }
      if (dist3(out, slot * 4, shape.positions, source * 3) > 0) jittered++;
    });
    expect(jittered).toBeGreaterThan((slots.length - SHAPE_COUNT) * 0.99);
    expect(maxAxis).toBeGreaterThan(0.005); // 抖動幅度是 0.006 的量級，不是一個趨近 0 的小數
  });

  it('不同姿勢在環境煙索引上的位置完全相同（連 w 也一樣）', () => {
    const ambient = ambientField(192 * 192);
    const a = expandTargets(synthShape(6), 192, ambient);
    const b = expandTargets(synthShape(7), 192, ambient);
    const c = expandTargets(synthShape(8), 192, ambient, weaponLayout('miaodao', true));
    for (let i = 0; i < ambient.mask.length; i++) {
      if (!ambient.mask[i]) continue;
      for (let k = 0; k < 4; k++) {
        expect(b[i * 4 + k]).toBe(a[i * 4 + k]);
        expect(c[i * 4 + k]).toBe(a[i * 4 + k]);
      }
    }
  });

  it('同輸入逐位元相同（含抖動）', () => {
    const shape = synthShape(9);
    const ambient = ambientField(256 * 256);
    const a = expandTargets(shape, 256, ambient);
    const b = expandTargets(shape, 256, ambient);
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
  });

  it('第 j 個點的抖動只取決於 j，不受姿勢影響', () => {
    // 兩個形體取同一批座標、只差 kind：抖動後的座標必須相同
    const base = synthShape(10);
    const other: Shape = { ...base, kinds: new Uint8Array(base.count).fill(KIND.STEEL) };
    const ambient = ambientField(256 * 256);
    const a = expandTargets(base, 256, ambient);
    const b = expandTargets(other, 256, ambient);
    for (let i = 0; i < ambient.mask.length; i++) {
      expect([a[i * 4], a[i * 4 + 1], a[i * 4 + 2]]).toEqual([b[i * 4], b[i * 4 + 1], b[i * 4 + 2]]);
    }
  });

  it('不在 shape.count 的整數倍時也正確循環（count = 1000，size = 112）', () => {
    const shape = synthShape(11, 1000);
    const ambient = ambientField(112 * 112);
    const out = expandTargets(shape, 112, ambient);
    const slots = solidSlots(ambient);
    const limit = 0.006 * Math.sqrt(3) + 1e-6;
    slots.forEach((slot, j) => {
      expect(dist3(out, slot * 4, shape.positions, (j % 1000) * 3)).toBeLessThanOrEqual(limit);
    });
  });

  it('輸入不合法 → RangeError：size 非正整數、mask／positions 長度不符、空形體', () => {
    const shape = synthShape(12);
    const ambient = ambientField(112 * 112);
    expect(() => expandTargets(shape, 0, ambient)).toThrow(RangeError);
    expect(() => expandTargets(shape, 1.5, ambient)).toThrow(RangeError);
    expect(() => expandTargets(shape, 144, ambient)).toThrow(RangeError); // 煙場是 112² 的
    expect(() => expandTargets(shape, 112, { mask: ambient.mask, positions: new Float32Array(3) })).toThrow(RangeError);
    expect(() => expandTargets({ ...shape, count: 0, positions: new Float32Array(0), kinds: new Uint8Array(0) }, 112, ambient)).toThrow(RangeError);
  });
});

/**
 * 跨 tier 前綴：同一批光點在各 tier 的目標互為前綴（煙格的挑選、位置與重複點的抖動都依序取亂數），
 * 所以降級（重建成較小的貼圖）時人形的形狀不變、只是少了尾巴那一段點。
 */
describe('跨 tier 前綴：較小 tier 的目標逐位元等於 256² 版的前 size² × 4 個 float', () => {
  const sizes = [112, 144, 192];
  const prefix = (small: Float32Array, big: Float32Array) => Buffer.from(small.buffer).equals(Buffer.from(big.buffer, 0, small.byteLength));

  it.each(sizes)('expandTargets（人形）size = %i', (size) => {
    const shape = synthShape(20);
    const small = expandTargets(shape, size, ambientField(size * size));
    const big = expandTargets(shape, 256, ambientField(256 * 256));
    expect(small).toHaveLength(size * size * 4);
    expect(prefix(small, big)).toBe(true);
  });

  it.each(sizes)('expandTargets（兵器 layout）size = %i', (size) => {
    const shape = synthShape(21);
    const layout = weaponLayout('spear', true);
    expect(prefix(expandTargets(shape, size, ambientField(size * size), layout), expandTargets(shape, 256, ambientField(256 * 256), layout))).toBe(true);
  });

  it.each(sizes)('flowTargets size = %i', (size) => {
    expect(prefix(flowTargets(size, ambientField(size * size)), flowTargets(256, ambientField(256 * 256)))).toBe(true);
  });

  it('這個檢查是真的在比：換一個 seed 的環境煙，前綴就不再相等', () => {
    const shape = synthShape(22);
    const small = expandTargets(shape, 144, ambientField(144 * 144, 8));
    expect(prefix(small, expandTargets(shape, 256, ambientField(256 * 256)))).toBe(false);
  });
});

describe('weaponLayout（D13：寬／窄的長度與傾角；中點高度 1.05）', () => {
  it.each([
    ['jian', true, 2.9, 0.16],
    ['miaodao', true, 3.2, 0.22],
    ['spear', true, 3.8, 0.05],
    ['jian', false, 1.9, 0.5],
    ['miaodao', false, 2.1, 0.55],
    ['spear', false, 2.3, 0.45],
  ] as const)('%s wide=%s → scale %s、rotZ %s、offset [0, 1.05, 0]', (name, wide, scale, rotZ) => {
    expect(weaponLayout(name, wide)).toEqual({ scale, rotZ, offset: [0, 1.05, 0] });
  });

  it('未知的兵器名 → RangeError（含原型鏈名稱）', () => {
    expect(() => weaponLayout('halberd' as never, true)).toThrow(RangeError);
    expect(() => weaponLayout('constructor' as never, true)).toThrow(RangeError);
  });

  /** 單位形：第 0 個點是鋒尖（+0.5, 0, 0），第 1 個是尾端（−0.5, 0, 0）。 */
  function unitWeapon(): Shape {
    const shape = synthShape(13);
    shape.positions[0] = 0.5;
    shape.positions[1] = 0;
    shape.positions[2] = 0;
    shape.positions[3] = -0.5;
    shape.positions[4] = 0;
    shape.positions[5] = 0;
    shape.kinds[0] = shape.kinds[1] = KIND.STEEL;
    return shape;
  }

  it('寬版長槍：鋒尖 x ≈ 3.8/2·cos(0.05)，高度中點 1.05', () => {
    const ambient = ambientField(112 * 112);
    const out = expandTargets(unitWeapon(), 112, ambient, weaponLayout('spear', true));
    const [tip, butt] = solidSlots(ambient);
    const tipX = out[tip! * 4]!;
    const tipY = out[tip! * 4 + 1]!;
    const buttY = out[butt! * 4 + 1]!;
    expect(tipX).toBeCloseTo((3.8 / 2) * Math.cos(0.05), 5);
    expect(tipY).toBeCloseTo(1.05 + (3.8 / 2) * Math.sin(0.05), 5);
    expect((tipY + buttY) / 2).toBeCloseTo(1.05, 5);
    expect((tipX + out[butt! * 4]!) / 2).toBeCloseTo(0, 5);
    expect(Math.hypot(tipX - out[butt! * 4]!, tipY - buttY)).toBeCloseTo(3.8, 5); // 全長 = scale
  });

  it('窄版長槍改用窄版數值：鋒尖 x ≈ 2.3/2·cos(0.45)，鋒尖抬高 2.3/2·sin(0.45)', () => {
    const ambient = ambientField(112 * 112);
    const out = expandTargets(unitWeapon(), 112, ambient, weaponLayout('spear', false));
    const tip = solidSlots(ambient)[0]!;
    expect(out[tip * 4]).toBeCloseTo((2.3 / 2) * Math.cos(0.45), 5);
    expect(out[tip * 4 + 1]).toBeCloseTo(1.05 + (2.3 / 2) * Math.sin(0.45), 5);
  });

  it('沒給 layout 時座標原樣（不動）；給 layout 時 z 只乘 scale，不被旋轉混進 xy', () => {
    const shape = unitWeapon();
    shape.positions[6] = 0;
    shape.positions[7] = 0;
    shape.positions[8] = 0.25;
    const ambient = ambientField(112 * 112);
    const plain = expandTargets(shape, 112, ambient);
    const laid = expandTargets(shape, 112, ambient, { scale: 2, rotZ: Math.PI / 2, offset: [1, 2, 3] });
    const third = solidSlots(ambient)[2]!;
    expect(plain[third * 4 + 2]).toBe(0.25);
    // (0, 0, 0.25) → ×2 → (0, 0, 0.5)；繞 z 轉 90° 不動它；再平移 (1, 2, 3)
    expect([laid[third * 4], laid[third * 4 + 1], laid[third * 4 + 2]].map((v) => Math.round(v! * 1e5) / 1e5)).toEqual([1, 2, 3.5]);
    // 鋒尖 (0.5, 0, 0) → ×2 → (1, 0, 0) → 轉 90° → (0, 1, 0) → 平移
    const tip = solidSlots(ambient)[0]!;
    expect([laid[tip * 4], laid[tip * 4 + 1], laid[tip * 4 + 2]].map((v) => Math.round(v! * 1e5) / 1e5)).toEqual([1, 3, 3]);
  });
});

describe('纓穗（RED）：套 layout 後仍朝下垂（試作：pendulum 反向旋轉，Task 16）', () => {
  /**
   * 單位形：鋒尖 (0.5, 0, 0)、尾端 (−0.5, 0, 0)；紅纓掛在長軸的 x = 0.4 那一點，往 −y 垂 0.08（兩束，z 前後 ±0.01）。
   * 其餘取樣點是鋼，落在長軸上。
   */
  function tasselWeapon(withTassel = true): Shape {
    const count = 64;
    const positions = new Float32Array(count * 3);
    const kinds = new Uint8Array(count).fill(KIND.STEEL);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = -0.4 + (i / count) * 0.8; // 鋼：沿長軸
    }
    positions.set([0.5, 0, 0, -0.5, 0, 0], 0);
    if (withTassel) {
      for (let i = 2; i < 26; i++) {
        const k = i - 2;
        positions[i * 3] = 0.4 + ((k % 3) - 1) * 0.004; // 紮點 x = 0.4（三條線的中間）
        positions[i * 3 + 1] = -0.003 * (k + 1); // 往下垂，最長 0.072
        positions[i * 3 + 2] = k % 2 === 0 ? 0.01 : -0.01;
        kinds[i] = KIND.RED;
      }
    }
    return { count, positions, kinds, min: [-0.5, -0.1, -0.02], max: [0.5, 0, 0.02] };
  }
  const reds = (ambient: AmbientField, shape: Shape): number[] => {
    const slots = solidSlots(ambient);
    const found: number[] = [];
    for (let k = 0; k < shape.count; k++) if (shape.kinds[k] === KIND.RED) found.push(slots[k]!);
    return found;
  };

  it('窄版（傾角 0.45）：紅點相對紮點的位置與不傾斜時完全相同（只受 scale 影響），所以仍然垂直朝下', () => {
    const shape = tasselWeapon();
    const ambient = ambientField(112 * 112);
    const tilted = expandTargets(shape, 112, ambient, weaponLayout('spear', false)); // rotZ 0.45
    const level = expandTargets(shape, 112, ambient, { scale: 2.3, rotZ: 0, offset: [0, 1.05, 0] });
    const slots = reds(ambient, shape);
    expect(slots).toHaveLength(24);
    // 紮點：紅點 x 的平均（0.4）在長軸上；傾斜後的世界位置
    const pivotTilted = [0.4 * 2.3 * Math.cos(0.45), 1.05 + 0.4 * 2.3 * Math.sin(0.45)];
    const pivotLevel = [0.4 * 2.3, 1.05];
    for (const slot of slots) {
      const relTilted = [tilted[slot * 4]! - pivotTilted[0]!, tilted[slot * 4 + 1]! - pivotTilted[1]!];
      const relLevel = [level[slot * 4]! - pivotLevel[0]!, level[slot * 4 + 1]! - pivotLevel[1]!];
      expect(relTilted[0]).toBeCloseTo(relLevel[0]!, 5);
      expect(relTilted[1]).toBeCloseTo(relLevel[1]!, 5);
      expect(relTilted[1]!).toBeLessThanOrEqual(1e-6); // 在紮點之下
      expect(tilted[slot * 4 + 2]).toBeCloseTo(level[slot * 4 + 2]!, 5); // z 不受影響
    }
  });

  it('纓穗的主軸是鉛直的：最低點與最高點的世界 x 差很小（只剩原本 ±0.004 的細微散開），不是跟著槍傾斜 26°', () => {
    const shape = tasselWeapon();
    const ambient = ambientField(112 * 112);
    const out = expandTargets(shape, 112, ambient, weaponLayout('spear', false));
    const slots = reds(ambient, shape);
    const byY = [...slots].sort((a, b) => out[a * 4 + 1]! - out[b * 4 + 1]!);
    const lowest = byY[0]!;
    const highest = byY[byY.length - 1]!;
    const dy = out[highest * 4 + 1]! - out[lowest * 4 + 1]!;
    const dx = out[highest * 4]! - out[lowest * 4]!;
    expect(dy).toBeGreaterThan(0.1); // 0.069 × 2.3 ≈ 0.16
    expect(Math.abs(dx) / dy).toBeLessThan(0.2); // 傾斜 0.45 rad 時會是 tan(0.45) ≈ 0.48
  });

  it('其他點（鋼）照舊套 layout：鋒尖位置不變；寬版（傾角 0.05）紅纓的紮點也跟著兵器走', () => {
    const shape = tasselWeapon();
    const ambient = ambientField(112 * 112);
    const wide = expandTargets(shape, 112, ambient, weaponLayout('spear', true));
    const tip = solidSlots(ambient)[0]!;
    expect(wide[tip * 4]).toBeCloseTo((3.8 / 2) * Math.cos(0.05), 5);
    expect(wide[tip * 4 + 1]).toBeCloseTo(1.05 + (3.8 / 2) * Math.sin(0.05), 5);
    // 紮點 (0.4, 0) 在世界的位置：(0.4·3.8·cos, 1.05 + 0.4·3.8·sin)；紅點平均 x 就在它附近
    const slots = reds(ambient, shape);
    const meanX = slots.reduce((s, i) => s + wide[i * 4]!, 0) / slots.length;
    expect(meanX).toBeCloseTo(0.4 * 3.8 * Math.cos(0.05), 2);
  });

  it('沒有紅纓的兵器（苗刀）不受影響，也不丟錯；沒給 layout 時紅點座標原樣', () => {
    const none = tasselWeapon(false);
    const ambient = ambientField(112 * 112);
    expect(() => expandTargets(none, 112, ambient, weaponLayout('miaodao', false))).not.toThrow();
    const shape = tasselWeapon();
    const plain = expandTargets(shape, 112, ambient);
    const slot = reds(ambient, shape)[0]!;
    expect([plain[slot * 4], plain[slot * 4 + 1], plain[slot * 4 + 2]]).toEqual([shape.positions[6], shape.positions[7], shape.positions[8]]);
  });
});

describe('flowTargets（收費段的氣流：全部點緩流，範圍比環境煙大）', () => {
  it('輸出長度 size × size × 4，每一格 w === -1，座標全為有限值', () => {
    const ambient = ambientField(112 * 112);
    const out = flowTargets(112, ambient);
    expect(out).toHaveLength(112 * 112 * 4);
    for (let i = 0; i < 112 * 112; i++) {
      expect(out[i * 4 + 3]).toBe(-1);
      expect(Number.isFinite(out[i * 4]! + out[i * 4 + 1]! + out[i * 4 + 2]!)).toBe(true);
    }
  });

  it('環境煙索引沿用共用的那批位置（所有姿勢，含 flow，煙都不動）', () => {
    const ambient = ambientField(144 * 144);
    const flow = flowTargets(144, ambient);
    const pose = expandTargets(synthShape(14), 144, ambient);
    for (let i = 0; i < ambient.mask.length; i++) {
      if (!ambient.mask[i]) continue;
      for (let k = 0; k < 4; k++) expect(flow[i * 4 + k]).toBe(pose[i * 4 + k]);
    }
  });

  it('其餘的點散得比環境煙寬：每個軸的範圍都包住環境煙的範圍', () => {
    const ambient = ambientField(256 * 256);
    const flow = flowTargets(256, ambient);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const alo = [Infinity, Infinity, Infinity];
    const ahi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < ambient.mask.length; i++) {
      for (let a = 0; a < 3; a++) {
        const v = flow[i * 4 + a]!;
        const [l, h] = ambient.mask[i] ? [alo, ahi] : [lo, hi];
        l[a] = Math.min(l[a]!, v);
        h[a] = Math.max(h[a]!, v);
      }
    }
    for (let a = 0; a < 3; a++) {
      expect(lo[a]).toBeLessThan(alo[a]!);
      expect(hi[a]).toBeGreaterThan(ahi[a]!);
    }
  });

  it('同輸入逐位元相同；跟人形姿勢不同（不是把形體塞進來）', () => {
    const ambient = ambientField(112 * 112);
    const a = flowTargets(112, ambient);
    const b = flowTargets(112, ambient);
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    const pose = expandTargets(synthShape(15), 112, ambient);
    expect(Buffer.from(a.buffer).equals(Buffer.from(pose.buffer))).toBe(false);
  });

  it('輸入不合法 → RangeError', () => {
    const ambient = ambientField(112 * 112);
    expect(() => flowTargets(0, ambient)).toThrow(RangeError);
    expect(() => flowTargets(144, ambient)).toThrow(RangeError);
  });
});
