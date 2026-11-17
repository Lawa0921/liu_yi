import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CREST_ASPECT, CREST_CENTER_Y, CREST_WORLD_HEIGHT, CREST_WORLD_WIDTH, SHAPES } from '../../src/qi/config/shapes';
import { KIND } from '../../src/qi/shapes/format';
import { sampleCrest, type CrestImage } from '../../src/qi/shapes/sample-crest';

// 光點館徽（Task 25，預約段）：由 Task 24 的透明底館徽依亮度取樣——金線輪廓清楚（亮線多取、暗面少取），全部是金（KIND.CREST）。
const ASSET = fileURLToPath(new URL('../../src/assets/images/crest-lion.png', import.meta.url));

/** 合成的小圖：左半是亮（alpha 255）、右半是暗（alpha 64），中間挖一個透明的洞。 */
function synthetic(): CrestImage {
  const width = 64;
  const height = 48;
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const hole = Math.hypot(x + 0.5 - 16, y + 0.5 - 24) < 6; // 以像素中心量；洞心在連續座標 (16, 24)
      alpha[y * width + x] = hole ? 0 : x < 32 ? 255 : 64;
    }
  }
  return { alpha, width, height };
}

describe('crest 配方與尺寸常數', () => {
  it('配方是 crest（吃館徽圖）；世界尺寸的寬高比與圖一致（960×920）', () => {
    expect(SHAPES.crest).toEqual({ kind: 'crest' });
    expect(CREST_ASPECT).toBeCloseTo(920 / 960, 9);
    expect(CREST_WORLD_HEIGHT).toBeCloseTo(CREST_WORLD_WIDTH * CREST_ASPECT, 9);
  });

  it('館徽圖本身是 960×920（常數與素材一致；換了圖要同步改 CREST_ASPECT）', async () => {
    const meta = await sharp(ASSET).metadata();
    expect(meta.width! / meta.height!).toBeCloseTo(960 / 920, 6);
    expect(CREST_ASPECT).toBeCloseTo(meta.height! / meta.width!, 6);
    expect(readFileSync(ASSET).byteLength).toBeGreaterThan(1000);
  });
});

describe('sampleCrest（合成圖）', () => {
  const opts = { count: 8000, seed: 99 };

  it('點數、種類（全部 CREST）、同種子逐位元相同', () => {
    const a = sampleCrest(synthetic(), opts);
    const b = sampleCrest(synthetic(), opts);
    expect(a.count).toBe(8000);
    expect(a.positions).toHaveLength(8000 * 3);
    expect(new Set(a.kinds)).toEqual(new Set([KIND.CREST]));
    expect([...a.positions]).toEqual([...b.positions]);
    expect([...sampleCrest(synthetic(), { ...opts, seed: 100 }).positions]).not.toEqual([...a.positions]);
  });

  it('亮的地方多取、暗的地方少取：左半（亮）的點遠多於右半（暗）', () => {
    const s = sampleCrest(synthetic(), opts);
    let left = 0;
    for (let i = 0; i < s.count; i++) if (s.positions[i * 3]! < 0) left++;
    expect(left / s.count, '亮面的點數占比').toBeGreaterThan(0.85);
  });

  it('透明的地方沒有點：挖掉的洞裡一個點都沒有', () => {
    const s = sampleCrest(synthetic(), opts);
    const unit = CREST_WORLD_WIDTH / 64;
    // 洞的圓心 (16, 24) 像素 → 世界座標；洞半徑 6 像素，邊緣像素內的點最多再往洞靠 √2/2 像素，所以門檻是 5.2
    const cx = (16 - 32) * unit;
    const cy = CREST_CENTER_Y + (24 - 24) * unit;
    for (let i = 0; i < s.count; i++) {
      const d = Math.hypot(s.positions[i * 3]! - cx, s.positions[i * 3 + 1]! - cy) / unit;
      expect(d, `第 ${i} 點在洞裡`).toBeGreaterThanOrEqual(5.2);
    }
  });

  it('座標：x 向右、y 向上，圖中心在 (0, CREST_CENTER_Y)，全寬 CREST_WORLD_WIDTH；很薄（|z| ≤ 0.03）', () => {
    const s = sampleCrest(synthetic(), opts);
    expect(s.max[0] - s.min[0]).toBeLessThanOrEqual(CREST_WORLD_WIDTH + 1e-6);
    expect(s.max[0] - s.min[0]).toBeGreaterThan(CREST_WORLD_WIDTH * 0.95);
    expect(Math.abs(s.min[0] + s.max[0])).toBeLessThan(0.05);
    expect((s.min[1] + s.max[1]) / 2).toBeCloseTo(CREST_CENTER_Y, 1);
    for (let i = 0; i < s.count; i++) expect(Math.abs(s.positions[i * 3 + 2]!)).toBeLessThanOrEqual(0.03);
    // 圖的上方在世界的上方
    let upper = 0;
    for (let i = 0; i < s.count; i++) if (s.positions[i * 3 + 1]! > CREST_CENTER_Y) upper++;
    expect(upper / s.count).toBeGreaterThan(0.4);
    expect(upper / s.count).toBeLessThan(0.6);
  });

  it('整張圖都是透明的：丟 RangeError（沒有東西可取樣）', () => {
    const empty: CrestImage = { alpha: new Uint8Array(100), width: 10, height: 10 };
    expect(() => sampleCrest(empty, opts)).toThrow(RangeError);
  });

  it('參數檢查：count 不是正整數、圖的長度與寬高不符都丟 RangeError', () => {
    for (const count of [0, -1, 1.5]) expect(() => sampleCrest(synthetic(), { count, seed: 1 })).toThrow(RangeError);
    expect(() => sampleCrest({ alpha: new Uint8Array(10), width: 4, height: 4 }, opts)).toThrow(RangeError);
  });
});

describe('sampleCrest（真實的館徽圖）', () => {
  it('每個點都落在館徽的亮線上（alpha ≥ 64）；點的平均 alpha 明顯高於全圖不透明部分的平均', async () => {
    const { data, info } = await sharp(ASSET).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = new Uint8Array(info.width * info.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
    const s = sampleCrest({ alpha, width: info.width, height: info.height }, { count: 16384, seed: 5 });
    const unit = CREST_WORLD_WIDTH / info.width;
    let sum = 0;
    let weak = 0;
    for (let i = 0; i < s.count; i++) {
      const px = Math.min(info.width - 1, Math.max(0, Math.floor(s.positions[i * 3]! / unit + info.width / 2)));
      const py = Math.min(info.height - 1, Math.max(0, Math.floor(info.height / 2 - (s.positions[i * 3 + 1]! - CREST_CENTER_Y) / unit)));
      const a = alpha[py * info.width + px]!;
      sum += a;
      if (a < 64) weak++;
    }
    let all = 0;
    let n = 0;
    for (const a of alpha) {
      if (a > 0) {
        all += a;
        n++;
      }
    }
    expect(weak / s.count, '落在暗面或透明處的點').toBeLessThan(0.02);
    expect(sum / s.count, '取樣點的平均 alpha').toBeGreaterThan(all / n);
    const w = s.max[0] - s.min[0];
    const h = s.max[1] - s.min[1];
    expect(w / h, '外框寬高比接近館徽（獅子）').toBeGreaterThan(0.95);
    expect(w / h).toBeLessThan(1.25);
  });
});
