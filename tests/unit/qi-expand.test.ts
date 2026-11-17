import { describe, expect, it } from 'vitest';
import { ambientField, CREST_JITTER, expandTargets, flowTargets, JITTER, weaponLayout, type AmbientField } from '../../src/qi/shapes/expand';
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

describe('weaponLayout 的右端上限 maxRight（Task 22b：大槍不壓到右緣的段落導覽）', () => {
  /** 一條軸線上的兵器：x 從 −0.6 到 +0.6（比「全長 1」的單位形長一點，像真的形體檔），全是鋼。 */
  function axisWeapon(): Shape {
    const count = 64;
    const positions = new Float32Array(count * 3);
    const kinds = new Uint8Array(count).fill(KIND.STEEL);
    for (let k = 0; k < count; k++) positions[k * 3] = -0.6 + (1.2 * k) / (count - 1);
    return { count, positions, kinds, min: [-0.6, 0, 0], max: [0.6, 0, 0] };
  }
  /** 前 64 個點（形體的取樣各一次，還沒重複，所以沒有抖動）的最大 x。 */
  const maxX = (out: Float32Array, ambient: AmbientField): number => Math.max(...solidSlots(ambient).slice(0, 64).map((i) => out[i * 4]!));

  it('沒給 maxRight：layout 與試作一致（D13），expandTargets 不縮', () => {
    expect(weaponLayout('spear', true)).toEqual({ scale: 3.8, rotZ: 0.05, offset: [0, 1.05, 0] });
    const ambient = ambientField(112 * 112);
    const out = expandTargets(axisWeapon(), 112, ambient, weaponLayout('spear', true));
    expect(maxX(out, ambient)).toBeCloseTo(0.6 * 3.8 * Math.cos(0.05), 4);
  });

  it('給 maxRight 時 layout 帶著它（scale、rotZ、offset 不變）', () => {
    expect(weaponLayout('spear', true, 1.5)).toEqual({ scale: 3.8, rotZ: 0.05, offset: [0, 1.05, 0], maxRight: 1.5 });
  });

  it('寬版長槍超過上限：等比例縮小到最右的光點剛好落在 maxRight（用形體實際的最右點，不是「全長 1」的假設）', () => {
    const ambient = ambientField(112 * 112);
    const out = expandTargets(axisWeapon(), 112, ambient, weaponLayout('spear', true, 1.5));
    expect(maxX(out, ambient)).toBeCloseTo(1.5, 5);
    // 傾角與中點高度不變：鋒尖與尾端的中點仍在 (0, 1.05)
    const slots = solidSlots(ambient);
    const first = slots[0]!; // 尾端（x = −0.6）
    const last = slots[63]!; // 鋒尖（x = +0.6）：64 個取樣各一次，之後才開始重複
    expect((out[first * 4 + 1]! + out[last * 4 + 1]!) / 2).toBeCloseTo(1.05, 4);
    expect((out[first * 4]! + out[last * 4]!) / 2).toBeCloseTo(0, 4);
  });

  it('沒超過上限的不動：劍（2.9）在寬鬆的上限下維持原樣；只縮、不放大', () => {
    const ambient = ambientField(112 * 112);
    const out = expandTargets(axisWeapon(), 112, ambient, weaponLayout('jian', true, 5));
    expect(maxX(out, ambient)).toBeCloseTo(0.6 * 2.9 * Math.cos(0.16), 4);
  });

  it('紅纓隨整把兵器等比例縮（纓穗相對紮點的位移也乘縮小後的 scale）', () => {
    const count = 64;
    const positions = new Float32Array(count * 3);
    const kinds = new Uint8Array(count).fill(KIND.STEEL);
    for (let k = 0; k < count; k++) positions[k * 3] = -0.6 + (1.2 * k) / (count - 1);
    positions[0] = 0.3; // 紅纓：紮在 x = 0.3，往 −y 垂 0.1
    positions[1] = -0.1;
    kinds[0] = KIND.RED;
    const shape: Shape = { count, positions, kinds, min: [-0.6, -0.1, 0], max: [0.6, 0, 0] };
    const ambient = ambientField(112 * 112);
    const capped = expandTargets(shape, 112, ambient, weaponLayout('spear', true, 1.5));
    const slot = solidSlots(ambient)[0]!;
    const scale = 1.5 / (0.6 * Math.cos(0.05)); // 縮小後的長度（3.8 → 約 2.5）
    // 紅點：紮點 (0.3, 0) 隨兵器轉到位，纓穗從紮點往 −y 垂 0.1 × scale（不跟著傾斜）
    expect(capped[slot * 4]).toBeCloseTo(0.3 * Math.cos(0.05) * scale, 4);
    expect(capped[slot * 4 + 1]).toBeCloseTo(1.05 + 0.3 * Math.sin(0.05) * scale - 0.1 * scale, 4);
  });

  it('上限不是正數或不是有限值：RangeError（呼叫端算錯時不要悄悄擺出長度 0 的兵器）', () => {
    expect(() => weaponLayout('spear', true, 0)).toThrow(RangeError);
    expect(() => weaponLayout('spear', true, -1)).toThrow(RangeError);
    expect(() => weaponLayout('spear', true, Number.NaN)).toThrow(RangeError);
  });

  it('窄（直向）版面沒有段落導覽，不套上限：維持試作的窄版長度', () => {
    expect(weaponLayout('spear', false, 0.5)).toEqual({ scale: 2.3, rotZ: 0.45, offset: [0, 1.05, 0] });
  });

  // ── 左端：不得進入文字欄（Task 22b 修正輪）────────────────────────────
  // 橫向版面文字欄在左、兵器置中在人形的位置；近方形視窗（1000×1000）與窄的橫向視窗，文字欄之後只剩一小段，
  // 兵器的左端會伸進文字。minLeft 是左端的世界 x 下限：左端超過就整把往右推（不縮），推到右端也到上限、放不下才縮到剛好塞進去。
  const minX = (out: Float32Array, ambient: AmbientField): number => Math.min(...solidSlots(ambient).slice(0, 64).map((i) => out[i * 4]!));

  it('給 minLeft 時 layout 帶著它；沒給就沒有這個欄位', () => {
    expect(weaponLayout('spear', true, 1.5, -0.2)).toEqual({ scale: 3.8, rotZ: 0.05, offset: [0, 1.05, 0], maxRight: 1.5, minLeft: -0.2 });
    expect('minLeft' in weaponLayout('spear', true, 1.5)).toBe(false);
  });

  it('左端沒超過 minLeft：不動（對照組）', () => {
    const ambient = ambientField(112 * 112);
    const free = expandTargets(axisWeapon(), 112, ambient, weaponLayout('jian', true));
    const out = expandTargets(axisWeapon(), 112, ambient, weaponLayout('jian', true, undefined, -5));
    expect(Buffer.from(out.buffer).equals(Buffer.from(free.buffer))).toBe(true);
  });

  it('左端超過 minLeft、右邊放得下：整把往右推到左端剛好在 minLeft，長度不變', () => {
    const ambient = ambientField(112 * 112);
    const layout = weaponLayout('jian', true, 3, -0.5); // 試作長 2.9：左端 −0.6 × 2.9 × cos ≈ −1.72，要推到 −0.5
    const out = expandTargets(axisWeapon(), 112, ambient, layout);
    expect(minX(out, ambient)).toBeCloseTo(-0.5, 4);
    const width = maxX(out, ambient) - minX(out, ambient);
    expect(width).toBeCloseTo(1.2 * 2.9 * Math.cos(0.16), 4); // 長度沒變
    expect(maxX(out, ambient)).toBeLessThanOrEqual(3);
  });

  it('窗（minLeft 到 maxRight）比兵器窄：縮到剛好塞進窗裡（左端在 minLeft、右端在 maxRight）', () => {
    const ambient = ambientField(112 * 112);
    const out = expandTargets(axisWeapon(), 112, ambient, weaponLayout('spear', true, 1.0, -0.4));
    expect(minX(out, ambient)).toBeCloseTo(-0.4, 4);
    expect(maxX(out, ambient)).toBeCloseTo(1.0, 4);
  });

  it('右端先超過 maxRight（原本的上限）、左端又超過 minLeft：兩端都落在窗內，傾角與中點高度不變', () => {
    const ambient = ambientField(112 * 112);
    const out = expandTargets(axisWeapon(), 112, ambient, weaponLayout('spear', true, 1.5, -0.1));
    expect(minX(out, ambient)).toBeGreaterThanOrEqual(-0.1 - 1e-4);
    expect(maxX(out, ambient)).toBeLessThanOrEqual(1.5 + 1e-4);
    const slots = solidSlots(ambient);
    const dy = out[slots[63]! * 4 + 1]! - out[slots[0]! * 4 + 1]!;
    const dx = out[slots[63]! * 4]! - out[slots[0]! * 4]!;
    expect(Math.atan2(dy, dx)).toBeCloseTo(0.05, 4); // 傾角
    expect((out[slots[0]! * 4 + 1]! + out[slots[63]! * 4 + 1]!) / 2).toBeCloseTo(1.05, 4); // 中點高度（只推 x，不動 y）
  });

  it('紅纓跟著整把兵器一起被推：紮點右移同樣的量，纓穗仍從紮點往下垂', () => {
    const count = 64;
    const positions = new Float32Array(count * 3);
    const kinds = new Uint8Array(count).fill(KIND.STEEL);
    for (let k = 0; k < count; k++) positions[k * 3] = -0.6 + (1.2 * k) / (count - 1);
    positions[0] = 0.3;
    positions[1] = -0.1;
    kinds[0] = KIND.RED;
    const shape: Shape = { count, positions, kinds, min: [-0.6, -0.1, 0], max: [0.6, 0, 0] };
    const ambient = ambientField(112 * 112);
    const free = expandTargets(shape, 112, ambient, weaponLayout('jian', true));
    const pushed = expandTargets(shape, 112, ambient, weaponLayout('jian', true, 3, -0.5));
    const slot = solidSlots(ambient)[0]!;
    const shift = pushed[solidSlots(ambient)[1]! * 4]! - free[solidSlots(ambient)[1]! * 4]!; // 鋼點被推了多少
    expect(shift).toBeGreaterThan(0.5);
    expect(pushed[slot * 4]! - free[slot * 4]!).toBeCloseTo(shift, 4);
    expect(pushed[slot * 4 + 1]).toBeCloseTo(free[slot * 4 + 1]!, 5); // 高度不變
  });

  it('窄（直向）版面不套左端限制', () => {
    expect(weaponLayout('spear', false, undefined, 0.5)).toEqual({ scale: 2.3, rotZ: 0.45, offset: [0, 1.05, 0] });
  });

  it('minLeft 不是有限值：RangeError；窗太窄（< 1 個世界單位）時把 minLeft 往左放寬到剛好 1，不擺出長度接近 0 的兵器', () => {
    expect(() => weaponLayout('spear', true, 1.5, Number.NaN)).toThrow(RangeError);
    expect(() => weaponLayout('spear', true, 1.5, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(weaponLayout('spear', true, 1.5, 1.4).minLeft).toBeCloseTo(0.5, 10);
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

  it('紮點正好在單位形的 x = 0（紅點 x 平均為 0）時，紅纓仍掛在隨 layout 平移的紮點下（不能把 0 當成「沒有紮點」）', () => {
    const shape = tasselWeapon();
    for (let i = 2; i < 26; i++) shape.positions[i * 3] = ((i - 2) % 3 - 1) * 0.004; // 紅點 x 平均 0
    const ambient = ambientField(112 * 112);
    const layout = { scale: 2, rotZ: 0.4, offset: [1, 2, 3] as [number, number, number] };
    const out = expandTargets(shape, 112, ambient, layout);
    const slots = reds(ambient, shape);
    const meanX = slots.reduce((s, i) => s + out[i * 4]!, 0) / slots.length;
    const topY = Math.max(...slots.map((i) => out[i * 4 + 1]!));
    // 紮點 (0, 0) → 世界 (offset.x, offset.y)；紅點只受 scale、掛在它下面
    expect(meanX).toBeCloseTo(1, 2);
    expect(topY).toBeLessThanOrEqual(2 + 1e-6);
    expect(topY).toBeGreaterThan(2 - 0.01);
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

describe('光點館徽（KIND.CREST）的重複點抖動：細線條不能被抖散（Task 25 審查）', () => {
  /** 全部是 CREST 的假形體。 */
  function crestShape(seed: number): Shape {
    const base = synthShape(seed);
    return { ...base, kinds: new Uint8Array(base.count).fill(KIND.CREST) };
  }

  it('常數：CREST 的抖動 0.002，只有人形與其他形體的 0.006 的三分之一', () => {
    expect(CREST_JITTER).toBe(0.002);
    expect(JITTER).toBe(0.006);
  });

  it('size = 256：CREST 的重複點（第 N + k 個）離原點每軸 ≤ 0.002（仍有抖動，只是小得多）；第一輪不抖；w 為 9', () => {
    const shape = crestShape(11);
    const ambient = ambientField(256 * 256);
    const out = expandTargets(shape, 256, ambient);
    const slots = solidSlots(ambient);
    expect(slots.length).toBeGreaterThan(SHAPE_COUNT * 3);
    let jittered = 0;
    let maxAxis = 0;
    slots.forEach((slot, j) => {
      const source = j % SHAPE_COUNT;
      expect(out[slot * 4 + 3]).toBe(9);
      if (j < SHAPE_COUNT) {
        expect(out[slot * 4]).toBe(shape.positions[source * 3]);
        return;
      }
      for (let a = 0; a < 3; a++) {
        const d = Math.abs(out[slot * 4 + a]! - shape.positions[source * 3 + a]!);
        expect(d).toBeLessThanOrEqual(0.002 + 1e-6);
        maxAxis = Math.max(maxAxis, d);
      }
      if (dist3(out, slot * 4, shape.positions, source * 3) > 0) jittered++;
    });
    expect(jittered).toBeGreaterThan((slots.length - SHAPE_COUNT) * 0.99);
    expect(maxAxis, '仍有抖動（讓重疊的點散成一層），幅度是 0.002 的量級').toBeGreaterThan(0.0015);
  });

  it('非 CREST 不變：人形、兵器、朱印、竹簡的重複點仍用 0.006（幅度明顯大於 CREST 的上限）', () => {
    for (const kind of [10, 99, KIND.STEEL, KIND.AURA, KIND.SEAL, KIND.BAMBOO]) {
      const base = synthShape(12);
      const shape: Shape = { ...base, kinds: new Uint8Array(base.count).fill(kind) };
      const ambient = ambientField(192 * 192);
      const out = expandTargets(shape, 192, ambient);
      let maxAxis = 0;
      solidSlots(ambient).forEach((slot, j) => {
        if (j < SHAPE_COUNT) return;
        const source = j % SHAPE_COUNT;
        for (let a = 0; a < 3; a++) maxAxis = Math.max(maxAxis, Math.abs(out[slot * 4 + a]! - shape.positions[source * 3 + a]!));
      });
      expect(maxAxis, `kind ${kind}`).toBeGreaterThan(0.005);
      expect(maxAxis, `kind ${kind}`).toBeLessThanOrEqual(0.006 + 1e-6);
    }
  });

  it('混合形體（人形加 CREST）：每個點依自己的種類決定抖動幅度', () => {
    const base = synthShape(13, SHAPE_COUNT, 'figure');
    const kinds = new Uint8Array(base.count);
    for (let i = 0; i < base.count; i++) kinds[i] = i % 2 === 0 ? KIND.CREST : 40;
    const shape: Shape = { ...base, kinds };
    const ambient = ambientField(192 * 192);
    const out = expandTargets(shape, 192, ambient);
    let crestMax = 0;
    let figureMax = 0;
    solidSlots(ambient).forEach((slot, j) => {
      if (j < SHAPE_COUNT) return;
      const source = j % SHAPE_COUNT;
      for (let a = 0; a < 3; a++) {
        const d = Math.abs(out[slot * 4 + a]! - shape.positions[source * 3 + a]!);
        if (kinds[source] === KIND.CREST) crestMax = Math.max(crestMax, d);
        else figureMax = Math.max(figureMax, d);
      }
    });
    expect(crestMax).toBeLessThanOrEqual(0.002 + 1e-6);
    expect(figureMax).toBeGreaterThan(0.005);
  });
});
