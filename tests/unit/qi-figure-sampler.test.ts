import { describe, expect, it } from 'vitest';
import { figureScale, WORLD_UNIT_PER_LAND_PX, type FigureDef } from '../../src/qi/config/figures';
import { SHAPE_COUNT } from '../../src/qi/shapes/format';
import { measureHeadHeight } from '../../src/qi/shapes/head';
import { sampleFigure } from '../../src/qi/shapes/sample-figure';

// 合成遮罩：圓頭＋細頸＋矩形軀幹（右側伸出一條手臂），可選軀幹中的圓孔（鏤空的負形）。
interface Spec {
  headD: number;
  neckW: number;
  neckL: number;
  torsoW: number;
  torsoH: number;
  armLen: number;
  armT: number;
  hole?: number; // 孔半徑
}
interface Synthetic {
  alpha: Uint8Array;
  width: number;
  height: number;
  /** 頭高真值：圓頭直徑。 */
  headTruth: number;
  /** 主體外框（px）。 */
  minX: number;
  maxX: number;
  maxY: number;
}

const PAD = 12;

function drawFigure(s: Spec): Synthetic {
  const width = PAD * 2 + s.torsoW + s.armLen;
  const height = PAD * 2 + s.headD + s.neckL + s.torsoH;
  const cx = PAD + s.torsoW / 2;
  const headCy = PAD + s.headD / 2;
  const neckTop = PAD + s.headD;
  const torsoTop = neckTop + s.neckL;
  const holeCy = torsoTop + s.torsoH / 2;
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const inHead = (px - cx) ** 2 + (py - headCy) ** 2 <= (s.headD / 2) ** 2;
      const inNeck = Math.abs(px - cx) <= s.neckW / 2 && py >= neckTop && py < torsoTop;
      const inTorso = Math.abs(px - cx) <= s.torsoW / 2 && py >= torsoTop && py < torsoTop + s.torsoH;
      const inArm =
        px > cx + s.torsoW / 2 && px <= cx + s.torsoW / 2 + s.armLen && py >= torsoTop + 10 && py < torsoTop + 10 + s.armT;
      const inHole = s.hole !== undefined && (px - cx) ** 2 + (py - holeCy) ** 2 <= s.hole ** 2;
      if ((inHead || inNeck || inTorso || inArm) && !inHole) alpha[y * width + x] = 255;
    }
  }
  return {
    alpha,
    width,
    height,
    headTruth: s.headD,
    minX: PAD,
    maxX: PAD + s.torsoW + s.armLen - 1,
    maxY: PAD + s.headD + s.neckL + s.torsoH - 1,
  };
}

// 成人（約 7 頭身）與兒童（約 6 頭身、頭相對較大）各一。
const ADULT: Spec = { headD: 60, neckW: 24, neckL: 16, torsoW: 150, torsoH: 345, armLen: 90, armT: 30 };
const KID: Spec = { headD: 104, neckW: 40, neckL: 20, torsoW: 220, torsoH: 500, armLen: 120, armT: 44 };

const def = (id: string, headPx: number, override?: number): FigureDef => ({
  id,
  src: `fig-${id}`,
  headPx,
  ...(override === undefined ? {} : { scaleOverride: override }),
  audience: 'both',
});

const percentile = (values: Float32Array | number[], p: number) => {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
};

function column(positions: Float32Array, axis: number): number[] {
  const out: number[] = [];
  for (let i = axis; i < positions.length; i += 3) out.push(positions[i]!);
  return out;
}

describe('measureHeadHeight（合成遮罩）', () => {
  it.each([
    ['成人', ADULT],
    ['兒童', KID],
  ] as const)('%s：回傳值在頭高真值 ±10% 內', (_name, spec) => {
    const m = drawFigure(spec);
    const head = measureHeadHeight(m.alpha, m.width, m.height);
    expect(head).toBeGreaterThan(m.headTruth * 0.9);
    expect(head).toBeLessThan(m.headTruth * 1.1);
  });

  it('整張縮放（同形狀不同解析度），頭高跟著等比', () => {
    const small = drawFigure(ADULT);
    const big = drawFigure({
      headD: ADULT.headD * 2,
      neckW: ADULT.neckW * 2,
      neckL: ADULT.neckL * 2,
      torsoW: ADULT.torsoW * 2,
      torsoH: ADULT.torsoH * 2,
      armLen: ADULT.armLen * 2,
      armT: ADULT.armT * 2,
    });
    const a = measureHeadHeight(small.alpha, small.width, small.height);
    const b = measureHeadHeight(big.alpha, big.width, big.height);
    expect(b / a).toBeGreaterThan(1.85);
    expect(b / a).toBeLessThan(2.15);
  });

  it('上方有空白邊也沒關係（從主體最上列起算）', () => {
    const m = drawFigure(ADULT);
    const extra = 50;
    const padded = new Uint8Array(m.width * (m.height + extra));
    padded.set(m.alpha, m.width * extra);
    const plain = measureHeadHeight(m.alpha, m.width, m.height);
    const shifted = measureHeadHeight(padded, m.width, m.height + extra);
    expect(Math.abs(shifted - plain)).toBeLessThanOrEqual(1);
  });

  it('空遮罩或尺寸對不上時 throw', () => {
    expect(() => measureHeadHeight(new Uint8Array(100), 10, 10)).toThrow();
    expect(() => measureHeadHeight(new Uint8Array(99), 10, 10)).toThrow();
  });
});

describe('sampleFigure（合成遮罩）', () => {
  const adult = drawFigure(ADULT);
  const kid = drawFigure(KID);
  const opts = { count: SHAPE_COUNT, seed: 101 };
  const adultShape = sampleFigure(adult, 1, opts);
  const kidShape = sampleFigure(kid, 1, opts);

  it('回傳 count 個點，positions／kinds 長度相符', () => {
    expect(adultShape.count).toBe(SHAPE_COUNT);
    expect(adultShape.positions.length).toBe(SHAPE_COUNT * 3);
    expect(adultShape.kinds.length).toBe(SHAPE_COUNT);
  });

  it.each([
    ['成人', adultShape],
    ['兒童', kidShape],
  ] as const)('%s：腳底在 y = 0（最低點 ≥ −1e-6，0.5 百分位 < 0.02）', (_name, shape) => {
    const ys = column(shape.positions, 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-1e-6);
    expect(percentile(ys, 0.005)).toBeLessThan(0.02);
    expect(shape.min[1]).toBeGreaterThanOrEqual(-1e-6);
  });

  it.each([
    ['成人', adultShape],
    ['兒童', kidShape],
  ] as const)('%s：外框中線在 x = 0（(min.x+max.x)/2 的絕對值 < 0.02）', (_name, shape) => {
    expect(Math.abs((shape.min[0] + shape.max[0]) / 2)).toBeLessThan(0.02);
  });

  it('min／max 與實際點雲外框一致', () => {
    for (let a = 0; a < 3; a++) {
      const values = column(adultShape.positions, a);
      expect(adultShape.min[a]).toBeCloseTo(Math.min(...values), 5);
      expect(adultShape.max[a]).toBeCloseTo(Math.max(...values), 5);
    }
  });

  it('兩種尺寸、不同 headPx：套用 figureScale 後世界頭高相差 ≤ 3%', () => {
    const headA = measureHeadHeight(adult.alpha, adult.width, adult.height);
    const headB = measureHeadHeight(kid.alpha, kid.width, kid.height);
    expect(headA).not.toBe(headB);
    const land = def('land', headA);
    const other = def('kid', headB);
    const scaleA = figureScale(land, land);
    const scaleB = figureScale(other, land);
    const worldHeadA = headA * WORLD_UNIT_PER_LAND_PX * scaleA;
    const worldHeadB = headB * WORLD_UNIT_PER_LAND_PX * scaleB;
    expect(Math.abs(worldHeadA - worldHeadB) / worldHeadA).toBeLessThanOrEqual(0.03);

    // 取樣出來的點雲也要照這個比例：身高＝像素身高 × 單位 × scale
    const a = sampleFigure(adult, scaleA, opts);
    const b = sampleFigure(kid, scaleB, opts);
    const bodyA = (adult.maxY + 1 - PAD) * WORLD_UNIT_PER_LAND_PX * scaleA;
    const bodyB = (kid.maxY + 1 - PAD) * WORLD_UNIT_PER_LAND_PX * scaleB;
    expect(Math.abs(a.max[1] / bodyA - 1)).toBeLessThan(0.02);
    expect(Math.abs(b.max[1] / bodyB - 1)).toBeLessThan(0.02);
  });

  it('scale 是線性的：兩倍 scale → 外框兩倍', () => {
    const doubled = sampleFigure(adult, 2, opts);
    expect(doubled.max[1] / adultShape.max[1]).toBeGreaterThan(1.95);
    expect(doubled.max[1] / adultShape.max[1]).toBeLessThan(2.05);
    expect(doubled.max[0] - doubled.min[0]).toBeGreaterThan(1.95 * (adultShape.max[0] - adultShape.min[0]));
  });

  it.each([
    ['成人', adultShape],
    ['兒童', kidShape],
  ] as const)('%s：z 厚度絕對值 ≤ 0.30，且軀幹有體積（不是貼平）', (_name, shape) => {
    const zs = column(shape.positions, 2).map(Math.abs);
    expect(Math.max(...zs)).toBeLessThanOrEqual(0.3);
    expect(percentile(zs, 0.9)).toBeGreaterThan(0.1);
  });

  it('kind 全在 0–99；輪廓帶（kind 99）占比 ≈ 22% ± 3%', () => {
    for (const shape of [adultShape, kidShape]) {
      let rim = 0;
      for (const k of shape.kinds) {
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThanOrEqual(99);
        if (k === 99) rim++;
      }
      expect(rim / shape.count).toBeGreaterThan(0.19);
      expect(rim / shape.count).toBeLessThan(0.25);
    }
  });

  it('輪廓帶的點真的貼著輪廓：軀幹中段、kind 99 的點離左右邊緣 ≤ 10 px', () => {
    const u = WORLD_UNIT_PER_LAND_PX;
    const centerPx = (adult.minX + adult.maxX + 1) / 2;
    const torsoCx = PAD + ADULT.torsoW / 2;
    const footPx = adult.maxY + 1;
    const torsoTop = PAD + ADULT.headD + ADULT.neckL;
    let checked = 0;
    for (let i = 0; i < adultShape.count; i++) {
      if (adultShape.kinds[i] !== 99) continue;
      const px = adultShape.positions[i * 3]! / u + centerPx;
      const py = footPx - adultShape.positions[i * 3 + 1]! / u;
      // 軀幹左側中段（右側有手臂接著，不看）
      if (py < torsoTop + 60 || py > torsoTop + ADULT.torsoH - 60 || px > torsoCx) continue;
      checked++;
      expect(px - (torsoCx - ADULT.torsoW / 2)).toBeLessThanOrEqual(10);
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('同 seed 逐位元相同；不同 seed 不同', () => {
    const again = sampleFigure(adult, 1, opts);
    expect(Buffer.from(again.positions.buffer).equals(Buffer.from(adultShape.positions.buffer))).toBe(true);
    expect(Buffer.from(again.kinds).equals(Buffer.from(adultShape.kinds))).toBe(true);
    const other = sampleFigure(adult, 1, { count: SHAPE_COUNT, seed: 102 });
    expect(Buffer.from(other.positions.buffer).equals(Buffer.from(adultShape.positions.buffer))).toBe(false);
  });

  it('打散序：前綴一樣是整個形體的代表（前 1/4 的外框與全體相近）', () => {
    const quarter = SHAPE_COUNT / 4;
    const ys = column(adultShape.positions, 1).slice(0, quarter);
    expect(Math.max(...ys) / adultShape.max[1]).toBeGreaterThan(0.97);
    const xs = column(adultShape.positions, 0).slice(0, quarter);
    expect(Math.max(...xs) / adultShape.max[0]).toBeGreaterThan(0.95);
  });

  it('每個點都落在原圖不透明的像素上（含邊界格），不會溢出輪廓', () => {
    const u = WORLD_UNIT_PER_LAND_PX;
    const centerPx = (adult.minX + adult.maxX + 1) / 2;
    const footPx = adult.maxY + 1;
    for (let i = 0; i < adultShape.count; i++) {
      const px = Math.floor(adultShape.positions[i * 3]! / u + centerPx);
      const py = Math.floor(footPx - adultShape.positions[i * 3 + 1]! / u);
      expect(adult.alpha[py * adult.width + px], `點 ${i} (${px}, ${py})`).toBeGreaterThanOrEqual(128);
    }
  });

  it('鏤空的負形（孔洞）內不落點', () => {
    const holed = drawFigure({ ...ADULT, hole: 55 });
    const shape = sampleFigure(holed, 1, opts);
    const u = WORLD_UNIT_PER_LAND_PX;
    const centerPx = (holed.minX + holed.maxX + 1) / 2;
    const footPx = holed.maxY + 1;
    const torsoCx = PAD + ADULT.torsoW / 2;
    const holeCy = PAD + ADULT.headD + ADULT.neckL + ADULT.torsoH / 2;
    let insideHole = 0;
    let nearHole = 0;
    let onTransparentPixel = 0;
    for (let i = 0; i < shape.count; i++) {
      const px = shape.positions[i * 3]! / u + centerPx;
      const py = footPx - shape.positions[i * 3 + 1]! / u;
      const d = Math.hypot(px - torsoCx, py - holeCy);
      // 孔的邊緣是像素階梯：點在最外圈像素的角上時離孔心可能略小於 55，留 1.5 px 的邊
      if (d < 55 - 1.5) insideHole++;
      if (d < 70) nearHole++;
      if (holed.alpha[Math.floor(py) * holed.width + Math.floor(px)]! < 128) onTransparentPixel++;
    }
    expect(insideHole).toBe(0);
    expect(onTransparentPixel).toBe(0);
    // 孔周圍有點（孔邊也是輪廓），表示不是整片被挖空
    expect(nearHole).toBeGreaterThan(100);
  });

  it('輸入不合法時 throw：空遮罩、長度對不上、scale ≤ 0、count ≤ 0', () => {
    expect(() => sampleFigure({ alpha: new Uint8Array(100), width: 10, height: 10 }, 1, opts)).toThrow();
    expect(() => sampleFigure({ alpha: new Uint8Array(99).fill(255), width: 10, height: 10 }, 1, opts)).toThrow();
    expect(() => sampleFigure(adult, 0, opts)).toThrow();
    expect(() => sampleFigure(adult, -1, opts)).toThrow();
    expect(() => sampleFigure(adult, 1, { count: 0, seed: 1 })).toThrow();
  });

  it('count 可以比預設小（執行時取前綴用）', () => {
    const small = sampleFigure(adult, 1, { count: 500, seed: 9 });
    expect(small.count).toBe(500);
    expect(small.positions.length).toBe(1500);
  });
});
