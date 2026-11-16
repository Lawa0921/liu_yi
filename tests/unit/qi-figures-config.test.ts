import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SILHOUETTES_READY } from '../../src/qi/config/silhouettes';
import { FIGURES, figureScale, WORLD_UNIT_PER_LAND_PX, type FigureDef } from '../../src/qi/config/figures';
import { SHAPE_COUNT } from '../../src/qi/shapes/format';
import { measureHeadHeight } from '../../src/qi/shapes/head';
import { sampleFigure } from '../../src/qi/shapes/sample-figure';

const DIR = new URL('../../src/assets/silhouettes/', import.meta.url);

interface Mask {
  alpha: Uint8Array;
  width: number;
  height: number;
}

const cache = new Map<string, Promise<Mask>>();
/** 以 sharp 解碼剪影 .png，取 alpha 通道。 */
function loadMask(src: string): Promise<Mask> {
  let hit = cache.get(src);
  if (!hit) {
    hit = (async () => {
      const { data, info } = await sharp(fileURLToPath(new URL(`${src}.png`, DIR)))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const alpha = new Uint8Array(info.width * info.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
      return { alpha, width: info.width, height: info.height };
    })();
    cache.set(src, hit);
  }
  return hit;
}

const OVERRIDES = { lift: 1.02, land: 1, dingzhou: 1.25, chengchui: 1.18, kao: 1.12 } as const;
const OLD_FIVE = Object.keys(OVERRIDES) as (keyof typeof OVERRIDES)[];
const entries = Object.entries(FIGURES);

/**
 * 這四張的 headPx 是手填的（figures.ts 註解寫明依據），不是 measureHeadHeight 的輸出：
 * 前傾／縮肩／手臂貼頭的架勢讓列寬輪廓裡沒有可用的頸谷，量到的值與使用者核可的視覺比例差 20–70%，
 * 所以 headPx 由核可過的 scaleOverride 反推，不與量測值比對。其餘八張必須與量測值相差 ≤ 12%。
 */
const HAND_FILLED = ['lift', 'dingzhou', 'chengchui', 'kao'];

describe('FIGURES 設定', () => {
  it('SILHOUETTES_READY 的每個檔名恰被一個 FIGURES[*].src 使用，沒有多的也沒有少的', () => {
    const used = entries.map(([, d]) => d.src);
    expect(new Set(used).size).toBe(used.length);
    expect([...used].sort()).toEqual([...SILHOUETTES_READY].sort());
    expect(SILHOUETTES_READY.length).toBe(10);
  });

  it('鍵 = id；十個形體 id 齊全；audience 合法；headPx 為正整數', () => {
    expect(Object.keys(FIGURES).sort()).toEqual(
      ['chengchui', 'dingzhou', 'kao', 'kid-defense-a', 'kid-defense-b', 'kid-weapon', 'kid-wushu', 'land', 'lift', 'salute'].sort(),
    );
    for (const [key, d] of entries) {
      expect(d.id).toBe(key);
      expect(['adult', 'kid', 'both']).toContain(d.audience);
      expect(Number.isInteger(d.headPx) && d.headPx > 0, `${key}.headPx`).toBe(true);
    }
  });

  it('src 對應：lift → fig-zhenjiao、land → fig-zhenjiao-land，其餘同名 fig-*', () => {
    expect(FIGURES.lift!.src).toBe('fig-zhenjiao');
    expect(FIGURES.land!.src).toBe('fig-zhenjiao-land');
    expect(FIGURES.dingzhou!.src).toBe('fig-dingzhou');
    expect(FIGURES.chengchui!.src).toBe('fig-chengchui');
    expect(FIGURES.kao!.src).toBe('fig-kao');
    expect(FIGURES.salute!.src).toBe('fig-salute');
    expect(FIGURES['kid-wushu']!.src).toBe('fig-kid-wushu');
    expect(FIGURES['kid-defense-a']!.src).toBe('fig-kid-defense-a');
    expect(FIGURES['kid-defense-b']!.src).toBe('fig-kid-defense-b');
    expect(FIGURES['kid-weapon']!.src).toBe('fig-kid-weapon');
  });

  it('試作的 FIGURE_SCALE 原值搬進 scaleOverride（D12）：lift 1.02、land 1、dingzhou 1.25、chengchui 1.18、kao 1.12', () => {
    for (const id of OLD_FIVE) expect(FIGURES[id]!.scaleOverride, id).toBe(OVERRIDES[id]);
    const overridden = entries.filter(([, d]) => d.scaleOverride !== undefined).map(([k]) => k);
    expect(overridden.sort()).toEqual([...OLD_FIVE].sort());
  });

  it('WORLD_UNIT_PER_LAND_PX = 2/1161（落地那張主體高 1161 px ↔ 世界身高 2）', () => {
    expect(WORLD_UNIT_PER_LAND_PX).toBe(2 / 1161);
  });

  it('figureScale：有 scaleOverride 用它，否則 land.headPx / def.headPx', () => {
    const land: FigureDef = { id: 'land', src: 'a', headPx: 180, audience: 'both' };
    const withOverride: FigureDef = { id: 'x', src: 'b', headPx: 90, scaleOverride: 1.25, audience: 'adult' };
    const plain: FigureDef = { id: 'y', src: 'c', headPx: 150, audience: 'kid' };
    expect(figureScale(withOverride, land)).toBe(1.25);
    expect(figureScale(plain, land)).toBeCloseTo(1.2, 10);
    expect(figureScale(land, land)).toBe(1);
  });
});

describe('FIGURES 對真實剪影', () => {
  it.each(entries.filter(([k]) => !HAND_FILLED.includes(k)))('%s：measureHeadHeight 與設定的 headPx 相差 ≤ 12%', async (_key, d) => {
    const mask = await loadMask(d.src);
    const measured = measureHeadHeight(mask.alpha, mask.width, mask.height);
    expect(Math.abs(measured - d.headPx) / d.headPx).toBeLessThanOrEqual(0.12);
  });

  it.each(HAND_FILLED)('%s：手填豁免是真的需要（量測值與 headPx 差 > 12%，量得準了就該移出名單）', async (key) => {
    const d = FIGURES[key]!;
    expect(OLD_FIVE).toContain(key); // 只有試作的舊姿勢可以手填
    const mask = await loadMask(d.src);
    const measured = measureHeadHeight(mask.alpha, mask.width, mask.height);
    expect(Math.abs(measured - d.headPx) / d.headPx).toBeGreaterThan(0.12);
  });

  it('五個舊值與 land.headPx / def.headPx 相差 ≤ 15%（搬入的值與頭部對齊一致）', () => {
    const land = FIGURES.land!;
    for (const id of OLD_FIVE) {
      const d = FIGURES[id]!;
      const aligned = land.headPx / d.headPx;
      expect(Math.abs(aligned - OVERRIDES[id]) / OVERRIDES[id], id).toBeLessThanOrEqual(0.15);
    }
  });

  it.each(entries.filter(([, d]) => d.scaleOverride === undefined))(
    '%s（非 override）：取樣後世界身高 1.1–2.6、腳底 y ∈ [0, 0.03]',
    async (_key, d) => {
      const mask = await loadMask(d.src);
      const shape = sampleFigure(mask, figureScale(d, FIGURES.land!), { count: SHAPE_COUNT, seed: 7 });
      expect(shape.max[1]).toBeGreaterThanOrEqual(1.1);
      expect(shape.max[1]).toBeLessThanOrEqual(2.6);
      expect(shape.min[1]).toBeGreaterThanOrEqual(0);
      expect(shape.min[1]).toBeLessThanOrEqual(0.03);
    },
  );

  it.each(entries)('%s：取樣的每個點都落在原圖不透明像素上、z 厚度 ≤ 0.30、中線在 x = 0', async (_key, d) => {
    const mask = await loadMask(d.src);
    const scale = figureScale(d, FIGURES.land!);
    const shape = sampleFigure(mask, scale, { count: SHAPE_COUNT, seed: 11 });
    // 取樣的座標換算：外框中線 → x = 0，外框底 → y = 0，每 px = WORLD_UNIT_PER_LAND_PX × scale
    let minX = mask.width;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < mask.height; y++)
      for (let x = 0; x < mask.width; x++)
        if (mask.alpha[y * mask.width + x]! >= 128) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
    const u = WORLD_UNIT_PER_LAND_PX * scale;
    const centerPx = (minX + maxX + 1) / 2;
    const footPx = maxY + 1;
    let transparent = 0;
    let maxZ = 0;
    for (let i = 0; i < shape.count; i++) {
      const px = Math.floor(shape.positions[i * 3]! / u + centerPx);
      const py = Math.floor(footPx - shape.positions[i * 3 + 1]! / u);
      if (mask.alpha[py * mask.width + px]! < 128) transparent++;
      maxZ = Math.max(maxZ, Math.abs(shape.positions[i * 3 + 2]!));
    }
    expect(transparent).toBe(0);
    expect(maxZ).toBeLessThanOrEqual(0.3);
    expect(Math.abs((shape.min[0] + shape.max[0]) / 2)).toBeLessThan(0.03);
  });

  it('fig-salute：雙手是鏤空的負形（佔剪影約 3%），孔洞內一個點也不落', async () => {
    const mask = await loadMask(FIGURES.salute!.src);
    const { alpha, width, height } = mask;
    // 孔洞 = 不連到影像邊緣的透明連通區
    const outside = new Uint8Array(width * height);
    const queue: number[] = [];
    const push = (x: number, y: number) => {
      const i = y * width + x;
      if (alpha[i]! < 128 && !outside[i]) {
        outside[i] = 1;
        queue.push(i);
      }
    };
    for (let x = 0; x < width; x++) {
      push(x, 0);
      push(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      push(0, y);
      push(width - 1, y);
    }
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      if (x > 0) push(x - 1, y);
      if (x < width - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < height - 1) push(x, y + 1);
    }
    let solid = 0;
    let holes = 0;
    for (let i = 0; i < alpha.length; i++) {
      if (alpha[i]! >= 128) solid++;
      else if (!outside[i]) holes++;
    }
    expect(holes / (solid + holes)).toBeGreaterThan(0.02);
    expect(holes / (solid + holes)).toBeLessThan(0.05);

    const scale = figureScale(FIGURES.salute!, FIGURES.land!);
    const shape = sampleFigure(mask, scale, { count: SHAPE_COUNT, seed: 23 });
    let minX = width;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (alpha[y * width + x]! >= 128) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
    const u = WORLD_UNIT_PER_LAND_PX * scale;
    let inHole = 0;
    for (let i = 0; i < shape.count; i++) {
      const px = Math.floor(shape.positions[i * 3]! / u + (minX + maxX + 1) / 2);
      const py = Math.floor(maxY + 1 - shape.positions[i * 3 + 1]! / u);
      const j = py * width + px;
      if (alpha[j]! < 128 && !outside[j]) inHole++;
    }
    expect(inHole).toBe(0);
  });
});
