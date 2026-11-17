import { describe, expect, it } from 'vitest';
import { SCROLL, SHAPES } from '../../src/qi/config/shapes';
import { KIND } from '../../src/qi/shapes/format';
import { sampleScroll, slatIntervals } from '../../src/qi/shapes/sample-scroll';

// 竹簡形體（Task 25）：程序化的攤開竹簡——九到十三根直立竹片並排、上下兩道綁繩橫穿、兩端略捲，不含任何字。
// 這裡驗幾何本身（竹片數、縫、綁繩、外框比例、捲曲）；建置成 .bin 與靜態圖由 qi-build-shapes／qi-stills 驗。
const COUNT = 16_384;
const SEED = 12345;
const flat = () => sampleScroll({ count: COUNT, seed: SEED, curl: 0 });
const curled = () => sampleScroll({ count: COUNT, seed: SEED });

const pitch = SCROLL.width / SCROLL.slats;
const gap = pitch * (1 - SCROLL.fill);

/** 把排序後的數列依「相鄰差超過門檻」切成群。 */
function clusters(values: number[], threshold: number): number[][] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const v of sorted) {
    const last = out.at(-1);
    if (last && v - last[last.length - 1]! <= threshold) last.push(v);
    else out.push([v]);
  }
  return out;
}

function pointsOf(shape: ReturnType<typeof flat>, kind: number): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < shape.count; i++) {
    if (shape.kinds[i] === kind) out.push({ x: shape.positions[i * 3]!, y: shape.positions[i * 3 + 1]!, z: shape.positions[i * 3 + 2]! });
  }
  return out;
}

describe('SCROLL 設定與配方', () => {
  it('竹片數在 9–13 之間；配方是程序化的 scroll（沒有任何輸入檔欄位，所以不可能帶字）', () => {
    expect(SCROLL.slats).toBeGreaterThanOrEqual(9);
    expect(SCROLL.slats).toBeLessThanOrEqual(13);
    expect(SHAPES.scroll).toEqual({ kind: 'scroll' });
  });

  it('slatIntervals：每片的寬度＝間距 × fill、片與片之間是縫、整體置中於 x = 0', () => {
    const slats = slatIntervals();
    expect(slats).toHaveLength(SCROLL.slats);
    for (const { left, right } of slats) expect(right - left).toBeCloseTo(pitch * SCROLL.fill, 6);
    for (let i = 1; i < slats.length; i++) expect(slats[i]!.left - slats[i - 1]!.right).toBeCloseTo(gap, 6);
    expect(slats[0]!.left + slats.at(-1)!.right).toBeCloseTo(0, 6);
  });
});

describe('sampleScroll（攤平，curl = 0）', () => {
  it('點數與種類：固定 count、只有 BAMBOO 與 DARK（綁繩），綁繩占 5%–18%', () => {
    const s = flat();
    expect(s.count).toBe(COUNT);
    expect(s.positions).toHaveLength(COUNT * 3);
    const kinds = new Set(s.kinds);
    expect([...kinds].sort()).toEqual([KIND.DARK, KIND.BAMBOO].sort());
    const cord = pointsOf(s, KIND.DARK).length / COUNT;
    expect(cord).toBeGreaterThan(0.05);
    expect(cord).toBeLessThan(0.18);
  });

  it('同種子逐位元相同；不同種子不同', () => {
    const a = sampleScroll({ count: 2000, seed: 7 });
    const b = sampleScroll({ count: 2000, seed: 7 });
    const c = sampleScroll({ count: 2000, seed: 8 });
    expect([...a.positions]).toEqual([...b.positions]);
    expect([...a.positions]).not.toEqual([...c.positions]);
  });

  it('竹片數：竹片點的 x 恰好分成 SCROLL.slats 群，每群落在自己那一片的區間內（群與群之間是縫）', () => {
    const s = flat();
    const xs = pointsOf(s, KIND.BAMBOO).map((p) => p.x);
    const groups = clusters(xs, gap * 0.4);
    expect(groups).toHaveLength(SCROLL.slats);
    const slats = slatIntervals();
    groups.forEach((group, i) => {
      expect(group[0]!, `第 ${i} 片左緣`).toBeGreaterThanOrEqual(slats[i]!.left - 1e-6);
      expect(group.at(-1)!, `第 ${i} 片右緣`).toBeLessThanOrEqual(slats[i]!.right + 1e-6);
    });
  });

  it('每片竹片都是「實心的長條」：把每片切成 6×40 的格子，90% 以上有點（沒有鏤空，所以不可能是字的筆畫）', () => {
    const s = flat();
    const bamboo = pointsOf(s, KIND.BAMBOO);
    const top = SCROLL.centerY + SCROLL.height / 2;
    slatIntervals().forEach(({ left, right }, i) => {
      const cells = new Set<number>();
      for (const p of bamboo) {
        if (p.x < left || p.x > right) continue;
        const cx = Math.min(5, Math.floor(((p.x - left) / (right - left)) * 6));
        const cy = Math.min(39, Math.max(0, Math.floor(((top - p.y) / SCROLL.height) * 40)));
        cells.add(cy * 6 + cx);
      }
      expect(cells.size / 240, `第 ${i} 片的填滿率`).toBeGreaterThan(0.9);
    });
  });

  it('綁繩：恰兩道、離中線 ±cordAt × height、橫跨整個竹簡', () => {
    const s = flat();
    const cord = pointsOf(s, KIND.DARK);
    const rows = clusters(cord.map((p) => p.y), SCROLL.cordThickness);
    expect(rows).toHaveLength(2);
    const [low, high] = rows as [number[], number[]];
    const mid = (g: number[]) => (g[0]! + g.at(-1)!) / 2;
    expect(mid(high) - SCROLL.centerY).toBeCloseTo(SCROLL.cordAt * SCROLL.height, 1);
    expect(SCROLL.centerY - mid(low)).toBeCloseTo(SCROLL.cordAt * SCROLL.height, 1);
    for (const row of rows) expect(row.at(-1)! - row[0]!).toBeLessThan(SCROLL.cordThickness * 1.5);
    const xs = cord.map((p) => p.x);
    expect(Math.min(...xs)).toBeLessThan(-SCROLL.width / 2 + pitch * 0.5);
    expect(Math.max(...xs)).toBeGreaterThan(SCROLL.width / 2 - pitch * 0.5);
  });

  it('攤平時幾乎沒有深度（薄薄一片）', () => {
    const s = flat();
    for (let i = 0; i < s.count; i++) expect(Math.abs(s.positions[i * 3 + 2]!)).toBeLessThanOrEqual(0.05);
  });
});

describe('sampleScroll（預設：兩端略捲）', () => {
  it('外框：寬高比 1.2–1.9（橫的竹簡）、左右對稱、置中於 centerY，竹簡高度約 SCROLL.height', () => {
    const s = curled();
    const w = s.max[0] - s.min[0];
    const h = s.max[1] - s.min[1];
    expect(w / h).toBeGreaterThan(1.2);
    expect(w / h).toBeLessThan(1.9);
    expect(Math.abs(s.min[0] + s.max[0])).toBeLessThan(0.05);
    expect((s.min[1] + s.max[1]) / 2).toBeCloseTo(SCROLL.centerY, 1);
    expect(h).toBeGreaterThan(SCROLL.height * 0.95);
    expect(h).toBeLessThan(SCROLL.height * 1.1);
  });

  it('捲曲：兩端往鏡頭凸出（z 最大 ≥ 0.15）、正面看寬度比攤平時窄 ≥ 5%；中央仍是平的', () => {
    const a = flat();
    const b = curled();
    expect(Math.max(...Array.from({ length: b.count }, (_, i) => b.positions[i * 3 + 2]!))).toBeGreaterThanOrEqual(0.15);
    expect(b.max[0] - b.min[0]).toBeLessThan((a.max[0] - a.min[0]) * 0.95);
    // 中央（|x| < 0.5）的點仍是薄薄一片
    for (let i = 0; i < b.count; i++) {
      if (Math.abs(b.positions[i * 3]!) < 0.5) expect(Math.abs(b.positions[i * 3 + 2]!)).toBeLessThanOrEqual(0.05);
    }
  });

  it('左右對稱：左端與右端的凸出一樣多', () => {
    const b = curled();
    let left = 0;
    let right = 0;
    for (let i = 0; i < b.count; i++) {
      const x = b.positions[i * 3]!;
      const z = b.positions[i * 3 + 2]!;
      if (x < 0) left = Math.max(left, z);
      else right = Math.max(right, z);
    }
    expect(Math.abs(left - right)).toBeLessThan(0.05);
  });
});

describe('sampleScroll 的參數檢查', () => {
  it('count 不是正整數就丟 RangeError；curl 不是有限的非負數也丟', () => {
    for (const count of [0, -1, 1.5, Number.NaN]) expect(() => sampleScroll({ count, seed: 1 })).toThrow(RangeError);
    for (const curl of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => sampleScroll({ count: 100, seed: 1, curl })).toThrow(RangeError);
  });
});
