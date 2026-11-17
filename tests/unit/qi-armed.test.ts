import { describe, expect, it } from 'vitest';
import { KIND, SHAPE_COUNT, type Shape } from '../../src/qi/shapes/format';
import { figureFrame, sampleFigure, type FigureImage } from '../../src/qi/shapes/sample-figure';
import type { ArmedSpec } from '../../src/qi/config/armed';
import { armedAxis, eraseWeapon, sampleArmed } from '../../src/qi/shapes/sample-armed';
import { WORLD_UNIT_PER_LAND_PX } from '../../src/qi/config/figures';
import type { WeaponPart, WeaponSnapshot } from '../../src/qi/shapes/weapon-snapshot';

// 持械形體（Task 27）：拳師持械的光點形體 ＝ 剪影取樣（把剪影自己畫的細兵器剔掉）＋兵器幾何，兵器落在剪影的手上、方向與握法和剪影一致。
// 這裡用合成的小圖與合成的兵器驗取樣的規則；真素材的握點與兵器軸在 qi-armed-assets.test.ts 驗。

/** 合成的剪影：身體是右側的一塊（x 120–180、y 20–120），細兵器從身體往左伸到 x = 5（y 28–34，6 px 粗），手在 (118, 31) 附近的一個突起。 */
function syntheticFigure(): FigureImage {
  const width = 200;
  const height = 120;
  const alpha = new Uint8Array(width * height);
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) alpha[y * width + x] = 255;
  };
  fill(120, 20, 180, 119); // 身體
  fill(5, 28, 119, 34); // 兵器（從手往左）
  fill(106, 24, 126, 40); // 手（比兵器粗）
  return { alpha, width, height };
}

const SPEC: ArmedSpec = {
  tip: [5, 31],
  butt: [140, 31],
  erase: { rects: [[0, 20, 100, 45]], keep: [[116, 32, 14]] },
  weaponShare: 0.3,
};

/** 合成的兵器：沿 +Y 的細管（鋼），加一束朝 −x 垂下的紅纓（三角形，紮在尾端）。 */
function tube(cls: WeaponPart['cls'], radius: number, y0: number, y1: number, segments = 10): WeaponPart {
  const positions = new Float32Array(segments * 2 * 3);
  const indices: number[] = [];
  for (let k = 0; k < segments; k++) {
    const a = (k / segments) * Math.PI * 2;
    positions.set([Math.cos(a) * radius, y0, Math.sin(a) * radius], k * 3);
    positions.set([Math.cos(a) * radius, y1, Math.sin(a) * radius], (segments + k) * 3);
    const next = (k + 1) % segments;
    indices.push(k, next, segments + k, next, segments + next, segments + k);
  }
  return { cls, positions, indices: new Uint32Array(indices) };
}
const SNAPSHOT: WeaponSnapshot = {
  name: 'jian',
  tip: 0.5,
  butt: -0.5,
  parts: [
    tube(2, 0.01, -0.35, 0.5),
    tube(5, 0.02, -0.5, -0.35),
    // 紅纓：紮在尾端（y = −0.5），朝 +X 垂下（快照的慣例：轉到單位形後朝下）
    { cls: 4, positions: new Float32Array([0, -0.5, 0, 0.12, -0.5, 0, 0.12, -0.46, 0]), indices: new Uint32Array([0, 1, 2]) },
  ],
};

const COUNT = 4096;
const SEED = 77;
const sample = (spec: ArmedSpec = SPEC) => sampleArmed(syntheticFigure(), 1, SNAPSHOT, spec, { count: COUNT, seed: SEED });
const unit = WORLD_UNIT_PER_LAND_PX; // scale = 1

describe('eraseWeapon', () => {
  it('膠囊與矩形內的像素清成透明，保留圈內的不清，其餘不動；回傳新圖、不改原圖', () => {
    const base = syntheticFigure();
    const before = Uint8Array.from(base.alpha);
    const { image, erased } = eraseWeapon(base, { capsules: [{ a: [10, 31], b: [90, 31], r: 5 }], rects: [[0, 100, 4, 105]], keep: [[50, 31, 6]] });
    const at = (img: FigureImage, x: number, y: number) => img.alpha[y * img.width + x]!;
    expect(at(image, 20, 31), '膠囊中線').toBe(0);
    expect(at(image, 20, 33), '膠囊內').toBe(0);
    expect(at(image, 50, 31), '保留圈中心').toBe(255);
    expect(at(image, 52, 29), '保留圈內').toBe(255);
    expect(at(image, 70, 31), '膠囊另一段').toBe(0);
    expect(at(image, 20, 40), '膠囊外的像素不動（那裡本來就是透明的，換一個不透明的位置驗）').toBe(before[40 * 200 + 20]);
    expect(at(image, 150, 60), '身體不動').toBe(255);
    expect(erased).toBeGreaterThan(300);
    expect(Buffer.from(base.alpha).equals(Buffer.from(before)), '原圖沒被改').toBe(true);
    expect(image.alpha).not.toBe(base.alpha);
  });

  it('矩形含邊界；矩形與保留圈互不干擾', () => {
    const { image } = eraseWeapon(syntheticFigure(), { rects: [[5, 28, 100, 34]], keep: [[50, 31, 3]] });
    expect(image.alpha[28 * 200 + 5]).toBe(0);
    expect(image.alpha[34 * 200 + 100]).toBe(0);
    expect(image.alpha[31 * 200 + 50]).toBe(255);
  });

  it('什麼都不給（沒有膠囊、矩形）：原樣回傳內容、erased 是 0', () => {
    const { image, erased } = eraseWeapon(syntheticFigure(), {});
    expect(erased).toBe(0);
    expect(Buffer.from(image.alpha).equals(Buffer.from(syntheticFigure().alpha))).toBe(true);
  });
});

describe('figureFrame（取樣的參考框：中線與腳底）', () => {
  it('與 sampleFigure 一致：腳底在不透明外框底、中線在外框中間；剔掉兵器之前的外框', () => {
    const img = syntheticFigure();
    expect(figureFrame(img)).toEqual({ centerPx: (5 + 180 + 1) / 2, footPx: 120 });
  });

  it('sampleFigure 給了 frame 就用它（剔掉兵器後的圖仍以原本的框取座標）', () => {
    const original = syntheticFigure();
    const frame = figureFrame(original);
    const erased = eraseWeapon(original, SPEC.erase).image;
    const withFrame = sampleFigure(erased, 1, { count: 500, seed: 1, frame });
    const without = sampleFigure(erased, 1, { count: 500, seed: 1 });
    // 剔掉後外框變窄，不給 frame 時中線會變；給了就保持原本的中線（身體在右側，所以 x 平均為正）
    const meanX = (s: { positions: Float32Array; count: number }) => Array.from({ length: s.count }, (_, i) => s.positions[i * 3]!).reduce((a, b) => a + b, 0) / s.count;
    expect(meanX(withFrame)).toBeGreaterThan(meanX(without) + 20 * unit);
    expect(withFrame.min[1]).toBeGreaterThanOrEqual(-1e-6); // 腳底仍在 y = 0
  });
});

describe('armedAxis（兵器軸在世界座標的位置）', () => {
  it('鋒尖與尾端用原圖的像素座標換算：x 以原圖外框中線為 0、y 以腳底為 0、向上為正', () => {
    const axis = armedAxis(syntheticFigure(), 1, SPEC);
    const centerPx = (5 + 180 + 1) / 2;
    expect(axis.tip.x).toBeCloseTo((5 - centerPx) * unit, 8);
    expect(axis.tip.y).toBeCloseTo((120 - 31) * unit, 8);
    expect(axis.butt.x).toBeCloseTo((140 - centerPx) * unit, 8);
    expect(axis.length).toBeCloseTo(135 * unit, 8);
    expect(axis.angle).toBeCloseTo(Math.PI, 6); // 鋒尖朝 −x
  });

  it('尺度（scale）等比放大：長度與座標都乘 scale', () => {
    const a = armedAxis(syntheticFigure(), 1, SPEC);
    const b = armedAxis(syntheticFigure(), 2, SPEC);
    expect(b.length).toBeCloseTo(a.length * 2, 8);
    expect(b.tip.x).toBeCloseTo(a.tip.x * 2, 8);
  });
});

describe('sampleArmed', () => {
  const shape = sample();
  const bodyIdx = Array.from({ length: shape.count }, (_, i) => i).filter((i) => shape.kinds[i]! < 100);
  const weaponIdx = Array.from({ length: shape.count }, (_, i) => i).filter((i) => shape.kinds[i]! >= 100);

  it('點數正確，種類只有人形（0–99）與兵器（STEEL／BRASS／RED／DARK／AURA）', () => {
    expect(shape.count).toBe(COUNT);
    expect(shape.positions.length).toBe(COUNT * 3);
    expect(shape.kinds.length).toBe(COUNT);
    for (const kind of new Set(shape.kinds)) expect(kind <= 99 || (kind >= KIND.STEEL && kind <= KIND.AURA), `kind ${kind}`).toBe(true);
    expect(weaponIdx.length + bodyIdx.length).toBe(COUNT);
  });

  it('兵器點占比 ＝ weaponShare（±1 個點），而且任何前綴都是同一個比例（載入時依 tier 取前綴）', () => {
    expect(weaponIdx.length).toBeGreaterThanOrEqual(Math.round(COUNT * SPEC.weaponShare) - 1);
    expect(weaponIdx.length).toBeLessThanOrEqual(Math.round(COUNT * SPEC.weaponShare) + 1);
    for (const prefix of [4096, 2048, 1024, 256]) {
      let weapon = 0;
      for (let i = 0; i < prefix; i++) if (shape.kinds[i]! >= 100) weapon++;
      expect(Math.abs(weapon / prefix - SPEC.weaponShare), `前綴 ${prefix}`).toBeLessThanOrEqual(2 / prefix + 0.005);
    }
  });

  it('人形的點都落在剔掉兵器之後的不透明像素上：細兵器的位置（保留圈之外）沒有人形點', () => {
    // 世界座標換回原圖像素：x = center + wx/unit，y = foot − wy/unit
    const { centerPx, footPx } = figureFrame(syntheticFigure());
    const erased = eraseWeapon(syntheticFigure(), SPEC.erase).image;
    for (const i of bodyIdx) {
      const px = Math.floor(centerPx + shape.positions[i * 3]! / unit);
      const py = Math.floor(footPx - shape.positions[i * 3 + 1]! / unit);
      expect(erased.alpha[py * erased.width + px], `人形點 ${i} (${px}, ${py}) 要在不透明像素上`).toBeGreaterThanOrEqual(128);
      expect(px < 100 && py >= 20 && py <= 45, `人形點 ${i} (${px}, ${py}) 落在被剔掉的兵器上`).toBe(false);
    }
  });

  it('兵器的點落在剪影的兵器軸上：非 AURA 點的軸向範圍 ＝ 鋒尖到尾端、離軸的距離很小', () => {
    const axis = armedAxis(syntheticFigure(), 1, SPEC);
    const surface = weaponIdx.filter((i) => shape.kinds[i] !== KIND.AURA && shape.kinds[i] !== KIND.RED);
    expect(surface.length).toBeGreaterThan(100);
    let lo = Infinity;
    let hi = -Infinity;
    let maxOff = 0;
    const ux = Math.cos(axis.angle);
    const uy = Math.sin(axis.angle);
    for (const i of surface) {
      const dx = shape.positions[i * 3]! - axis.butt.x;
      const dy = shape.positions[i * 3 + 1]! - axis.butt.y;
      const along = (dx * ux + dy * uy) / axis.length; // butt 為 0、tip 為 1（axis.angle 是 butt→tip 的方向）
      const across = Math.abs(dx * uy - dy * ux);
      lo = Math.min(lo, along);
      hi = Math.max(hi, along);
      maxOff = Math.max(maxOff, across);
    }
    // 沿軸向 0 → 1（butt → tip）；單位形是長度 1，所以範圍涵蓋整把兵器
    expect(hi - lo).toBeGreaterThan(0.97);
    expect(hi - lo).toBeLessThan(1.03);
    expect(lo, '尾端在 0').toBeCloseTo(0, 1);
    expect(hi, '鋒尖在 1').toBeCloseTo(1, 1);
    expect(maxOff / axis.length, '離軸距離占兵器長度的比例').toBeLessThan(0.08);
  });

  it('兵器傾斜（鋒尖朝左上）：沿著斜軸；紅纓不跟著轉，纓穗的形狀（相對紮點、除以兵器長度）與水平時一樣，仍朝下', () => {
    const tiltedSpec = { ...SPEC, tip: [60, 10] as [number, number], butt: [140, 60] as [number, number] };
    const tilted = sampleArmed(syntheticFigure(), 1, SNAPSHOT, tiltedSpec, { count: COUNT, seed: SEED });
    const flat = shape;
    const axisTilted = armedAxis(syntheticFigure(), 1, tiltedSpec);
    const axisFlat = armedAxis(syntheticFigure(), 1, SPEC);
    expect(axisTilted.angle).toBeGreaterThan(Math.PI / 2); // 鋒尖在左上
    expect(axisTilted.angle).toBeLessThan(Math.PI);
    /** 紅纓點相對「紅點 x 的平均、y 的最高處（紮點那一側）」的 [x 範圍, y 範圍]，除以兵器長度。 */
    const tassel = (s: Shape, length: number) => {
      const idx = Array.from({ length: s.count }, (_, i) => i).filter((i) => s.kinds[i] === KIND.RED);
      expect(idx.length).toBeGreaterThan(10);
      const xs = idx.map((i) => s.positions[i * 3]!);
      const ys = idx.map((i) => s.positions[i * 3 + 1]!);
      return { w: (Math.max(...xs) - Math.min(...xs)) / length, h: (Math.max(...ys) - Math.min(...ys)) / length, down: (Math.max(...ys) - ys.reduce((a, b) => a + b, 0) / ys.length) / length };
    };
    const t = tassel(tilted, axisTilted.length);
    const f = tassel(flat, axisFlat.length);
    expect(t.w).toBeCloseTo(f.w, 2);
    expect(t.h).toBeCloseTo(f.h, 2);
    expect(t.down, '纓穗的質心在最高點之下（朝下）').toBeGreaterThan(0);
    // 兵器本體沿斜軸：非 AURA／RED 點離軸很近
    const ux = Math.cos(axisTilted.angle);
    const uy = Math.sin(axisTilted.angle);
    let maxOff = 0;
    for (let i = 0; i < tilted.count; i++) {
      if (tilted.kinds[i]! < 100 || tilted.kinds[i] === KIND.AURA || tilted.kinds[i] === KIND.RED) continue;
      const dx = tilted.positions[i * 3]! - axisTilted.butt.x;
      const dy = tilted.positions[i * 3 + 1]! - axisTilted.butt.y;
      maxOff = Math.max(maxOff, Math.abs(dx * uy - dy * ux));
    }
    expect(maxOff / axisTilted.length).toBeLessThan(0.08);
  });

  it('決定性：同輸入逐位元相同，換種子不同', () => {
    const again = sample();
    expect(Buffer.from(again.positions.buffer).equals(Buffer.from(shape.positions.buffer))).toBe(true);
    expect(Buffer.from(again.kinds).equals(Buffer.from(shape.kinds))).toBe(true);
    const other = sampleArmed(syntheticFigure(), 1, SNAPSHOT, SPEC, { count: COUNT, seed: SEED + 1 });
    expect(Buffer.from(other.positions.buffer).equals(Buffer.from(shape.positions.buffer))).toBe(false);
  });

  it('min／max 就是全部點的外框；z 在 ±0.3 之內（與其他形體一致的厚度）', () => {
    for (let a = 0; a < 3; a++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < shape.count; i++) {
        lo = Math.min(lo, shape.positions[i * 3 + a]!);
        hi = Math.max(hi, shape.positions[i * 3 + a]!);
      }
      expect(shape.min[a]).toBe(lo);
      expect(shape.max[a]).toBe(hi);
    }
    expect(Math.max(Math.abs(shape.min[2]), Math.abs(shape.max[2]))).toBeLessThanOrEqual(0.3);
  });

  it('參數不合法就丟錯：weaponShare 不在 (0,1)、兵器長度為 0、count 不是正整數', () => {
    expect(() => sampleArmed(syntheticFigure(), 1, SNAPSHOT, { ...SPEC, weaponShare: 0 }, { count: 100, seed: 1 })).toThrow(RangeError);
    expect(() => sampleArmed(syntheticFigure(), 1, SNAPSHOT, { ...SPEC, weaponShare: 1 }, { count: 100, seed: 1 })).toThrow(RangeError);
    expect(() => sampleArmed(syntheticFigure(), 1, SNAPSHOT, { ...SPEC, tip: [10, 10], butt: [10, 10] }, { count: 100, seed: 1 })).toThrow(RangeError);
    expect(() => sampleArmed(syntheticFigure(), 1, SNAPSHOT, SPEC, { count: 0, seed: 1 })).toThrow(RangeError);
    expect(SHAPE_COUNT).toBe(16384);
  });
});
