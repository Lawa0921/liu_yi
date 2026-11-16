import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeShape, encodeShape, KIND, SHAPE_COUNT, type Shape } from '../../src/qi/shapes/format';
import { sampleWeapon } from '../../src/qi/shapes/sample-weapon';
import { decodeSnapshot, type WeaponSnapshot } from '../../src/qi/shapes/weapon-snapshot';

const NAMES = ['jian', 'miaodao', 'spear'] as const;
const SEED: Record<(typeof NAMES)[number], number> = { jian: 301, miaodao: 302, spear: 303 };

const snapshots = Object.fromEntries(
  NAMES.map((name) => [name, decodeSnapshot(new Uint8Array(readFileSync(new URL(`../../src/qi/data/weapons/${name}.geo`, import.meta.url))))]),
) as Record<(typeof NAMES)[number], WeaponSnapshot>;

const shapes = Object.fromEntries(NAMES.map((name) => [name, sampleWeapon(snapshots[name], { count: SHAPE_COUNT, seed: SEED[name] })])) as Record<
  (typeof NAMES)[number],
  Shape
>;

const ALLOWED = new Set<number>([KIND.STEEL, KIND.BRASS, KIND.RED, KIND.DARK, KIND.AURA]);

/** 某種類的點數占比（分母預設是全部點）。 */
function share(shape: Shape, kind: number, among?: (k: number) => boolean): number {
  let hit = 0;
  let all = 0;
  for (const k of shape.kinds) {
    if (among && !among(k)) continue;
    all++;
    if (k === kind) hit++;
  }
  return hit / all;
}

/** 非 AURA 點（貼在兵器表面的點）在某一軸上的 [min, max]。 */
function surfaceRange(shape: Shape, axis: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < shape.count; i++) {
    if (shape.kinds[i] === KIND.AURA) continue;
    const v = shape.positions[i * 3 + axis]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

describe.each(NAMES)('sampleWeapon（真快照）：%s', (name) => {
  const shape = shapes[name];

  it('N = 16 384，positions／kinds 長度對，kinds 只含 STEEL／BRASS／RED／DARK／AURA', () => {
    expect(shape.count).toBe(SHAPE_COUNT);
    expect(shape.positions.length).toBe(SHAPE_COUNT * 3);
    expect(shape.kinds.length).toBe(SHAPE_COUNT);
    for (const kind of new Set(shape.kinds)) expect(ALLOWED.has(kind), `kind ${kind}`).toBe(true);
    expect(shape.kinds.includes(KIND.STEEL)).toBe(true);
    expect(shape.kinds.includes(KIND.AURA)).toBe(true);
  });

  it('決定性：同 seed 逐位元相同，換 seed 不同', () => {
    const again = sampleWeapon(snapshots[name], { count: SHAPE_COUNT, seed: SEED[name] });
    expect(Buffer.from(again.positions.buffer).equals(Buffer.from(shape.positions.buffer))).toBe(true);
    expect(Buffer.from(again.kinds).equals(Buffer.from(shape.kinds))).toBe(true);
    const other = sampleWeapon(snapshots[name], { count: SHAPE_COUNT, seed: SEED[name] + 1 });
    expect(Buffer.from(other.positions.buffer).equals(Buffer.from(shape.positions.buffer))).toBe(false);
  });

  it('單位形：長軸 +x、非 AURA 點的 x 範圍 max−min ＝ 1 ± 0.005 且置中', () => {
    const [lo, hi] = surfaceRange(shape, 0);
    expect(hi - lo).toBeGreaterThanOrEqual(0.995);
    expect(hi - lo).toBeLessThanOrEqual(1.005);
    expect(Math.abs((hi + lo) / 2)).toBeLessThanOrEqual(0.005);
    // 長軸才是最長的一軸：y、z 的範圍遠小於 x（苗刀的弧與纓穗都在這個範圍內）
    const [ylo, yhi] = surfaceRange(shape, 1);
    const [zlo, zhi] = surfaceRange(shape, 2);
    expect(yhi - ylo).toBeLessThan(0.3);
    expect(zhi - zlo).toBeLessThan(0.1);
  });

  it('shape 的 min／max 就是全部點的外框，可直接丟給 encodeShape 編成 114 728 B', () => {
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
    const bytes = encodeShape(shape);
    expect(bytes.byteLength).toBe(114_728);
    expect(Array.from(decodeShape(bytes).kinds)).toEqual(Array.from(shape.kinds));
  });

  it('表面點占約 30%（其餘是貼著兵器的氣，AURA ≤ 72%）；打散序：前 25% 的組成與全體相近', () => {
    expect(share(shape, KIND.AURA)).toBeLessThanOrEqual(0.72);
    expect(share(shape, KIND.AURA)).toBeGreaterThanOrEqual(0.68);
    const head: Shape = { ...shape, count: SHAPE_COUNT / 4, kinds: shape.kinds.subarray(0, SHAPE_COUNT / 4), positions: shape.positions };
    for (const kind of [KIND.STEEL, KIND.AURA]) {
      expect(Math.abs(share(head, kind) - share(shape, kind))).toBeLessThan(0.03);
    }
  });

  it('氣的延伸只在兵器附近：離最近表面點不遠（單位長度內）', () => {
    // 每個 AURA 點到最近表面點的距離：延伸上限是試作的 0.35 世界單位 ÷ 試作擺放長度（最短 2.9）≈ 0.12
    const surface: [number, number, number][] = [];
    for (let i = 0; i < shape.count; i++) {
      if (shape.kinds[i] === KIND.AURA) continue;
      surface.push([shape.positions[i * 3]!, shape.positions[i * 3 + 1]!, shape.positions[i * 3 + 2]!]);
    }
    let far = 0;
    let checked = 0;
    for (let i = 0; i < shape.count; i += 16) {
      if (shape.kinds[i] !== KIND.AURA) continue;
      checked++;
      const p = [shape.positions[i * 3]!, shape.positions[i * 3 + 1]!, shape.positions[i * 3 + 2]!];
      let best = Infinity;
      for (const s of surface) {
        const d = Math.hypot(p[0]! - s[0], p[1]! - s[1], p[2]! - s[2]);
        if (d < best) best = d;
      }
      if (best > 0.125) far++;
    }
    expect(checked).toBeGreaterThan(500);
    expect(far).toBe(0);
  });
});

describe('sampleWeapon：大槍（補強桿身與紅纓）', () => {
  const spear = shapes.spear;

  it('紅（KIND.RED）≥ 全部點的 3.5%，暗色（KIND.DARK，桿）≥ 10%', () => {
    expect(share(spear, KIND.RED)).toBeGreaterThanOrEqual(0.035);
    expect(share(spear, KIND.DARK)).toBeGreaterThanOrEqual(0.1);
  });

  it('桿身看得出粗細：暗色點到長軸的距離 p95 ∈ [0.005, 0.012]（單位長度）', () => {
    const distances: number[] = [];
    for (let i = 0; i < spear.count; i++) {
      if (spear.kinds[i] !== KIND.DARK) continue;
      distances.push(Math.hypot(spear.positions[i * 3 + 1]!, spear.positions[i * 3 + 2]!));
    }
    distances.sort((a, b) => a - b);
    const p95 = distances[Math.floor(distances.length * 0.95)]!;
    expect(p95).toBeGreaterThanOrEqual(0.005);
    expect(p95).toBeLessThanOrEqual(0.012);
  });

  it('桿身的散布沿整根桿都有（不是只在某一段）', () => {
    // 桿占 x ∈ [-0.5, 0.39]：把它切成四段，每段都該有暗色點
    const buckets = [0, 0, 0, 0];
    for (let i = 0; i < spear.count; i++) {
      if (spear.kinds[i] !== KIND.DARK) continue;
      const t = (spear.positions[i * 3]! + 0.5) / 0.89;
      if (t >= 0 && t < 1) buckets[Math.min(3, Math.floor(t * 4))]!++;
    }
    for (const n of buckets) expect(n).toBeGreaterThan(200);
  });
});

describe('sampleWeapon：劍與纓穗朝下', () => {
  it('劍：鋼點占表面點（非 AURA）≥ 40%', () => {
    expect(share(shapes.jian, KIND.STEEL, (k) => k !== KIND.AURA)).toBeGreaterThanOrEqual(0.4);
  });

  it.each(['jian', 'spear'] as const)('%s：紅纓垂在長軸下方（世界的下方，y < 0），且紅點不少於 3.5%%', (name) => {
    const shape = shapes[name];
    let sum = 0;
    let n = 0;
    for (let i = 0; i < shape.count; i++) {
      if (shape.kinds[i] !== KIND.RED) continue;
      sum += shape.positions[i * 3 + 1]!;
      n++;
    }
    expect(n / shape.count).toBeGreaterThanOrEqual(0.035);
    expect(sum / n).toBeLessThan(-0.015);
  });

  it('苗刀沒有纓：沒有紅點', () => {
    expect(shapes.miaodao.kinds.includes(KIND.RED)).toBe(false);
  });
});
