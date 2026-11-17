import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAllShapes } from '../../scripts/qi/build-shapes';
import { renderAllStills, renderStill } from '../../scripts/qi/render-stills';
import { SHAPES } from '../../src/qi/config/shapes';
import type { Shape } from '../../src/qi/shapes/format';
import { rng } from '../../src/qi/shapes/rng';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const IDS = Object.keys(SHAPES);
const NAMES = ['hero-wide', 'hero-tall', ...IDS];
const KB = 1024;

const tmpDirs: string[] = [];
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'qi-stills-'));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

interface Raster {
  data: Buffer;
  width: number;
  height: number;
}

async function decode(bytes: Uint8Array): Promise<Raster> {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(3);
  return { data, width: info.width, height: info.height };
}
const luma = (r: Raster, i: number): number => 0.2126 * r.data[i * 3]! + 0.7152 * r.data[i * 3 + 1]! + 0.0722 * r.data[i * 3 + 2]!;

/** 全圖平均亮度（0–255）。 */
function meanLuma(r: Raster): number {
  let sum = 0;
  for (let i = 0; i < r.width * r.height; i++) sum += luma(r, i);
  return sum / (r.width * r.height);
}

/** 亮度高於 threshold 的像素占全圖的比例。 */
function brightShare(r: Raster, threshold: number): number {
  let n = 0;
  for (let i = 0; i < r.width * r.height; i++) if (luma(r, i) > threshold) n++;
  return n / (r.width * r.height);
}

/** 亮點（亮度 > threshold）的質心，座標正規化到 0–1。 */
function brightCentroid(r: Raster, threshold: number): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      if (luma(r, y * r.width + x) <= threshold) continue;
      sx += x;
      sy += y;
      n++;
    }
  expect(n).toBeGreaterThan(0);
  return { x: sx / n / r.width, y: sy / n / r.height };
}

/** 每一列、每一欄各有多少個亮度 > threshold 的像素。 */
function litProfile(r: Raster, threshold: number): { rows: number[]; columns: number[] } {
  const rows = new Array<number>(r.height).fill(0);
  const columns = new Array<number>(r.width).fill(0);
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++)
      if (luma(r, y * r.width + x) > threshold) {
        rows[y]!++;
        columns[x]!++;
      }
  return { rows, columns };
}

/** 一維剖面上「至少有 minCount 個亮點」的範圍（含頭尾）；沒有就回 undefined。零星的環境煙不到 minCount，所以不會把範圍撐大。 */
function litSpan(profile: number[], minCount: number): { first: number; last: number } | undefined {
  const first = profile.findIndex((n) => n >= minCount);
  if (first < 0) return undefined;
  let last = first;
  for (let i = profile.length - 1; i > first; i--)
    if (profile[i]! >= minCount) {
      last = i;
      break;
    }
  return { first, last };
}

/** 亮點（亮度 > threshold）的垂直範圍占影像高度的比例；每一列至少要有 3 個亮點才算（排除零星雜點）。 */
function litHeightShare(r: Raster, threshold: number, minCount = 3): number {
  const span = litSpan(litProfile(r, threshold).rows, minCount);
  return span ? (span.last - span.first + 1) / r.height : 0;
}

/** 最外圈（四邊各 4%）的平均亮度：不得有滿版外發光。 */
function borderLuma(r: Raster): number {
  const bx = Math.round(r.width * 0.04);
  const by = Math.round(r.height * 0.04);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      if (x >= bx && x < r.width - bx && y >= by && y < r.height - by) continue;
      sum += luma(r, y * r.width + x);
      n++;
    }
  return sum / n;
}

/** 偏紅的亮像素數（紅纓、朱印用）：R 明顯高於 G 與 B。 */
function redPixels(r: Raster): number {
  let n = 0;
  for (let i = 0; i < r.width * r.height; i++) {
    const R = r.data[i * 3]!;
    const G = r.data[i * 3 + 1]!;
    const B = r.data[i * 3 + 2]!;
    if (R >= 110 && R > G * 2.2 && R > B * 2.2) n++;
  }
  return n;
}

/** 偏紅的像素裡最大的一塊連通區域（四連通）的像素數：紅纓是一整塊，火星只是零星的小點。 */
function largestRedBlob(r: Raster): number {
  const isRed = (i: number): boolean => {
    const R = r.data[i * 3]!;
    return R >= 110 && R > r.data[i * 3 + 1]! * 2.2 && R > r.data[i * 3 + 2]! * 2.2;
  };
  const seen = new Uint8Array(r.width * r.height);
  let best = 0;
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !isRed(start)) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop()!;
      size++;
      const x = p % r.width;
      for (const q of [x > 0 ? p - 1 : -1, x < r.width - 1 ? p + 1 : -1, p - r.width, p + r.width]) {
        if (q < 0 || q >= seen.length || seen[q] || !isRed(q)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    best = Math.max(best, size);
  }
  return best;
}

/** 合成圓盤：半徑 1、圓心在 (0.4, 1.3)（故意不在原點，驗證取景會置中）、均勻取樣。 */
function disc(count = 3000): Shape {
  const random = rng(7);
  const positions = new Float32Array(count * 3);
  const kinds = new Uint8Array(count).fill(30);
  for (let i = 0; i < count; i++) {
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(random());
    positions[i * 3] = 0.4 + Math.cos(a) * r;
    positions[i * 3 + 1] = 1.3 + Math.sin(a) * r;
    positions[i * 3 + 2] = (random() - 0.5) * 0.2;
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, positions[i * 3 + a]!);
      max[a] = Math.max(max[a]!, positions[i * 3 + a]!);
    }
  return { count, positions, kinds, min, max };
}

describe('renderStill（合成圓盤）', () => {
  const opts = { width: 1000, height: 750, seed: 11 };
  let bytes: Uint8Array;
  let raster: Raster;
  beforeAll(async () => {
    bytes = await renderStill(disc(), opts);
    raster = await decode(bytes);
  }, 60_000);

  it('輸出是可被 sharp 解開的 WebP，尺寸與指定的一致', async () => {
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1000);
    expect(meta.height).toBe(750);
  });

  it('暗底：平均亮度在 3–60 之間；亮點（L > 120）占 0.5%–12%', () => {
    const mean = meanLuma(raster);
    expect(mean).toBeGreaterThanOrEqual(3);
    expect(mean).toBeLessThanOrEqual(60);
    const share = brightShare(raster, 120);
    expect(share).toBeGreaterThanOrEqual(0.005);
    expect(share).toBeLessThanOrEqual(0.12);
  });

  it('亮點質心落在影像中央 ±10%（形體不在原點也會被置中取景）', () => {
    const c = brightCentroid(raster, 120);
    expect(Math.abs(c.x - 0.5)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(c.y - 0.5)).toBeLessThanOrEqual(0.1);
  });

  it('同輸入逐位元相同；換種子輸出會變', async () => {
    const again = await renderStill(disc(), opts);
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
    const other = await renderStill(disc(), { ...opts, seed: 12 });
    expect(Buffer.from(other).equals(Buffer.from(bytes))).toBe(false);
  }, 60_000);

  it('沒有滿版外發光：最外圈維持底色，glow 加大只讓亮度單調上升、仍不外溢到邊緣', async () => {
    expect(borderLuma(raster)).toBeLessThan(18);
    const dim = meanLuma(await decode(await renderStill(disc(), { ...opts, glow: 0 })));
    const bright = meanLuma(await decode(await renderStill(disc(), { ...opts, glow: 2 })));
    expect(dim).toBeLessThan(meanLuma(raster));
    expect(meanLuma(raster)).toBeLessThan(bright);
    expect(borderLuma(await decode(await renderStill(disc(), { ...opts, glow: 2 })))).toBeLessThan(22);
  }, 60_000);

  it('形體偏金：亮部的 R > G > B（金／米白，不是灰白或別的色相）', () => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < raster.width * raster.height; i++) {
      if (luma(raster, i) <= 90) continue;
      r += raster.data[i * 3]!;
      g += raster.data[i * 3 + 1]!;
      b += raster.data[i * 3 + 2]!;
      n++;
    }
    expect(n).toBeGreaterThan(50);
    expect(r / n).toBeGreaterThan(g / n);
    expect(g / n).toBeGreaterThan(b / n);
    expect((r - b) / r).toBeGreaterThan(0.15);
  });

  it('寬高、點數不合法就丟錯（不默默輸出空白圖）', async () => {
    await expect(renderStill(disc(), { ...opts, width: 0 })).rejects.toThrow(/width/);
    await expect(renderStill(disc(), { ...opts, height: 10.5 })).rejects.toThrow(/height/);
    await expect(renderStill({ ...disc(), count: 0, positions: new Float32Array(0), kinds: new Uint8Array(0) }, opts)).rejects.toThrow(/count/);
  });
});

/** 真資料：先建一份形體，再渲出全部靜態圖，供多個測試共用。 */
const SHAPES_DIR = join(tmpdir(), `qi-stills-shapes-${process.pid}`);
const STILLS_DIR = join(tmpdir(), `qi-stills-out-${process.pid}`);
const rasters = new Map<string, Raster>();
let manifest: Record<string, { width: number; height: number; bytes: number }>;
beforeAll(async () => {
  tmpDirs.push(SHAPES_DIR, STILLS_DIR);
  await buildAllShapes({ root: ROOT, outDir: SHAPES_DIR });
  await renderAllStills({ shapesDir: SHAPES_DIR, outDir: STILLS_DIR });
  manifest = JSON.parse(readFileSync(join(STILLS_DIR, 'stills.json'), 'utf8'));
  for (const name of NAMES) rasters.set(name, await decode(new Uint8Array(readFileSync(join(STILLS_DIR, `${name}.webp`)))));
}, 240_000);

const FIGURE_IDS = IDS.filter((id) => SHAPES[id]!.kind === 'figure');

describe('renderAllStills：輸出與尺寸', () => {
  it('恰有 hero-wide、hero-tall 與每個形體各一張 .webp，另有 stills.json、.inputs-hash，沒有殘檔', () => {
    expect(readdirSync(STILLS_DIR).filter((f) => f.endsWith('.webp')).sort()).toEqual(NAMES.map((n) => `${n}.webp`).sort());
    expect(existsSync(join(STILLS_DIR, 'stills.json'))).toBe(true);
    expect(readFileSync(join(STILLS_DIR, '.inputs-hash'), 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(STILLS_DIR, '.staging'))).toBe(false);
    expect(readdirSync(STILLS_DIR).filter((f) => !f.endsWith('.webp')).sort()).toEqual(['.inputs-hash', 'stills.json']);
  });

  it('hero-wide 1440×810、hero-tall 780×1280、其餘每張 1000×750；stills.json 與實際檔案相符', async () => {
    expect(Object.keys(manifest).sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) {
      const [width, height] = name === 'hero-wide' ? [1440, 810] : name === 'hero-tall' ? [780, 1280] : [1000, 750];
      const meta = await sharp(join(STILLS_DIR, `${name}.webp`)).metadata();
      expect([meta.format, meta.width, meta.height], name).toEqual(['webp', width, height]);
      expect(manifest[name], name).toEqual({ width, height, bytes: statSync(join(STILLS_DIR, `${name}.webp`)).size });
    }
  });

  it('體積門檻：hero 兩張 ≤ 60 KB，其餘每張 ≤ 45 KB（不放寬門檻，超過就調 quality 或點徑）', () => {
    for (const name of NAMES) {
      const limit = name.startsWith('hero-') ? 60 * KB : 45 * KB;
      expect(manifest[name]!.bytes, `${name}（上限 ${limit} B）`).toBeLessThanOrEqual(limit);
    }
  });
});

describe('renderAllStills：畫面品質（機械可驗的部分）', () => {
  it('每張都是暗底、亮點占比合理（0.3%–25%；hero 兩張更嚴：亮度 > 100 的像素 ≤ 15%，不能是一大片偏亮的米黃）、最外圈維持底色（沒有滿版外發光）', () => {
    for (const name of NAMES) {
      const r = rasters.get(name)!;
      const mean = meanLuma(r);
      expect(mean, `${name} 平均亮度`).toBeGreaterThanOrEqual(8);
      expect(mean, `${name} 平均亮度`).toBeLessThanOrEqual(60);
      const share = brightShare(r, 120);
      expect(share, `${name} 亮點占比`).toBeGreaterThanOrEqual(0.003);
      expect(share, `${name} 亮點占比`).toBeLessThanOrEqual(0.25);
      expect(borderLuma(r), `${name} 外圈`).toBeLessThan(18);
    }
    for (const name of ['hero-wide', 'hero-tall']) {
      expect(brightShare(rasters.get(name)!, 100), `${name} 亮度 > 100 的占比`).toBeLessThanOrEqual(0.15);
      expect(brightShare(rasters.get(name)!, 120), `${name} 亮點占比`).toBeLessThanOrEqual(0.15);
    }
  });

  it('人形的亮部外框高度占影像 ≥ 60%（hero-wide ≥ 70%）', () => {
    expect(litHeightShare(rasters.get('hero-wide')!, 60)).toBeGreaterThanOrEqual(0.7);
    expect(litHeightShare(rasters.get('hero-tall')!, 60)).toBeGreaterThanOrEqual(0.6);
    for (const id of FIGURE_IDS) expect(litHeightShare(rasters.get(id)!, 60), id).toBeGreaterThanOrEqual(0.6);
  });

  it('人形與兵器以金色為主（亮部 R > G > B）；人形幾乎沒有紅點，大槍的紅纓明顯是紅的', () => {
    for (const name of [...FIGURE_IDS, 'jian', 'miaodao', 'spear', 'hero-wide', 'hero-tall']) {
      const r = rasters.get(name)!;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let i = 0; i < r.width * r.height; i++) {
        if (luma(r, i) <= 90) continue;
        sr += r.data[i * 3]!;
        sg += r.data[i * 3 + 1]!;
        sb += r.data[i * 3 + 2]!;
        n++;
      }
      expect(n, `${name} 亮部像素`).toBeGreaterThan(100);
      expect(sr / n, name).toBeGreaterThan(sg / n);
      expect(sg / n, name).toBeGreaterThan(sb / n);
    }
    // 紅纓是一整塊明確的紅；人形上只有零星的小火星（每顆不到幾十個像素，也不連成一片）
    expect(largestRedBlob(rasters.get('spear')!), 'spear 紅纓').toBeGreaterThan(300);
    expect(largestRedBlob(rasters.get('jian')!), 'jian 紅穗').toBeGreaterThan(300);
    expect(largestRedBlob(rasters.get('land')!), 'land 的火星').toBeLessThan(80);
    expect(redPixels(rasters.get('land')!), 'land 的火星總量').toBeLessThan(1500);
    // 苗刀沒有紅纓：只有人形上的零星火星（第 2 輪改成低弓步前指後，人形比較大，火星總量約 150 顆像素，仍遠小於 land 的上限，也沒有連成一塊）
    expect(largestRedBlob(rasters.get('miaodao')!), 'miaodao 沒有紅纓').toBeLessThan(80);
    expect(redPixels(rasters.get('miaodao')!), 'miaodao 的火星總量').toBeLessThan(1500);
  });

  it('朱印是朱紅色的（紅像素多，且亮部以紅為主，不是金色）', () => {
    const seal = rasters.get('seal')!;
    expect(redPixels(seal)).toBeGreaterThan(2000);
    let red = 0;
    let other = 0;
    for (let i = 0; i < seal.width * seal.height; i++) {
      if (luma(seal, i) <= 40) continue;
      if (seal.data[i * 3]! > seal.data[i * 3 + 1]! * 1.8) red++;
      else other++;
    }
    expect(red).toBeGreaterThan(other * 3);
  });

  it('朱印大致方正、置中：亮部外框寬高比 0.8–1.25，質心在中央 ±8%', () => {
    const seal = rasters.get('seal')!;
    const c = brightCentroid(seal, 50);
    expect(Math.abs(c.x - 0.5)).toBeLessThan(0.08);
    expect(Math.abs(c.y - 0.5)).toBeLessThan(0.08);
    // 方印的邊框每一欄、每一列都有幾百個亮點；環境煙不到 30 個
    const { rows, columns } = litProfile(seal, 50);
    const across = litSpan(columns, 30)!;
    const down = litSpan(rows, 30)!;
    const aspect = (across.last - across.first + 1) / (down.last - down.first + 1);
    expect(aspect).toBeGreaterThan(0.8);
    expect(aspect).toBeLessThan(1.25);
  });

  it('竹簡（scroll）與光點館徽（crest）的靜態圖是金色的：亮部 R > G > B、沒有朱紅（朱印才是紅的）', () => {
    for (const name of ['scroll', 'crest']) {
      const r = rasters.get(name)!;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let i = 0; i < r.width * r.height; i++) {
        if (luma(r, i) <= 60) continue;
        sr += r.data[i * 3]!;
        sg += r.data[i * 3 + 1]!;
        sb += r.data[i * 3 + 2]!;
        n++;
      }
      expect(n, `${name} 亮部像素`).toBeGreaterThan(1000);
      expect(sr / n, name).toBeGreaterThan(sg / n);
      expect(sg / n, name).toBeGreaterThan(sb / n);
      expect(redPixels(r), `${name} 沒有朱紅`).toBeLessThan(100);
    }
  });

  it('竹簡的靜態圖是橫的長方形（亮部外框寬高比 1.2–1.9）、置中；比光點館徽淡（亮度 > 100 的像素更少）', () => {
    const scroll = rasters.get('scroll')!;
    const { rows, columns } = litProfile(scroll, 50);
    const across = litSpan(columns, 30)!;
    const down = litSpan(rows, 30)!;
    const aspect = (across.last - across.first + 1) / (down.last - down.first + 1);
    expect(aspect).toBeGreaterThan(1.2);
    expect(aspect).toBeLessThan(1.9);
    const c = brightCentroid(scroll, 50);
    expect(Math.abs(c.x - 0.5)).toBeLessThan(0.08);
    expect(Math.abs(c.y - 0.5)).toBeLessThan(0.08);
    expect(brightShare(scroll, 100)).toBeLessThan(brightShare(rasters.get('crest')!, 100));
  });

  it('光點館徽的靜態圖大致方正、置中（獅子）：亮部外框寬高比 0.9–1.3，質心在中央 ±10%', () => {
    const crest = rasters.get('crest')!;
    const { rows, columns } = litProfile(crest, 50);
    const across = litSpan(columns, 30)!;
    const down = litSpan(rows, 30)!;
    const aspect = (across.last - across.first + 1) / (down.last - down.first + 1);
    expect(aspect).toBeGreaterThan(0.9);
    expect(aspect).toBeLessThan(1.3);
    const c = brightCentroid(crest, 50);
    expect(Math.abs(c.x - 0.5)).toBeLessThan(0.1);
    expect(Math.abs(c.y - 0.5)).toBeLessThan(0.1);
  });

  it('持械的人（Task 27）：亮部外框占影像寬的 45% 以上、高的 30% 以上（人加兵器，不是橫躺的一條線；苗刀、劍與大槍都過這個門檻）；大槍橫伸得更寬', () => {
    const shares: Record<string, { w: number; h: number }> = {};
    for (const name of ['jian', 'miaodao', 'spear']) {
      const r = rasters.get(name)!;
      // 人形的每一欄有幾十個亮點、每一列也是；兵器細長，那一欄只有十來個亮點，所以用較低的門檻把兵器算進外框；環境煙更少
      const { rows, columns } = litProfile(r, 50);
      const across = litSpan(columns, 8)!;
      const down = litSpan(rows, 8)!;
      shares[name] = { w: (across.last - across.first + 1) / r.width, h: (down.last - down.first + 1) / r.height };
    }
    for (const [name, share] of Object.entries(shares)) {
      expect(share.w, `${name} 寬`).toBeGreaterThanOrEqual(0.45);
      expect(share.h, `${name} 高`).toBeGreaterThanOrEqual(0.3);
      expect(share.h, `${name} 高不超出影像`).toBeLessThanOrEqual(0.95);
    }
    // 大槍是橫著伸的：寬高比（以像素算）比劍大。苗刀第 2 輪改成低弓步前指（原本是直立高舉，像日本劍道），也是橫向的，所以不再拿它跟大槍比。
    const aspect = (name: string) => (shares[name]!.w * rasters.get(name)!.width) / (shares[name]!.h * rasters.get(name)!.height);
    expect(aspect('spear')).toBeGreaterThan(aspect('jian'));
    expect(aspect('miaodao'), '苗刀是橫向的弓步前指，不是直立的一條').toBeGreaterThan(1.2);
  });

  it('others 是四個人形橫排：連續有亮點的欄分成 4 段（人形之間有空隙），整排占影像寬的 70% 以上、高度不到一半', () => {
    const r = rasters.get('others')!;
    const { columns } = litProfile(r, 60);
    // 人形的每一欄有幾十個亮點；環境煙不到 12 個。人形內部細長的肢體可能讓亮欄斷開幾格，所以 25 欄以內的縫不算空隙
    // （人形之間的空隙有 60 欄以上）
    let segments = 0;
    let previous = -Infinity;
    columns.forEach((n, x) => {
      if (n < 12) return;
      if (x - previous > 25) segments++;
      previous = x;
    });
    expect(segments).toBe(4);
    const across = litSpan(columns, 12)!;
    expect((across.last - across.first + 1) / r.width).toBeGreaterThanOrEqual(0.7);
    expect(litHeightShare(r, 60, 12)).toBeLessThan(0.5);
  });
});

/**
 * 跳過與失敗的情境用縮小的形體目錄（land、kao、jian 三個）：每次只渲 5 張（hero 兩張＋三個形體），整檔才跑得快。
 * 「暫存再換入」本身的故障注入（換入途中失敗、.staging 清不掉、殘檔）在 qi-staged-output.test.ts；
 * 這裡只留一條整合等級的故障測試，證明靜態圖產線真的接上了它。
 */
const MINI_IDS = ['land', 'kao', 'jian'];
const MINI_NAMES = ['hero-wide', 'hero-tall', ...MINI_IDS];
describe('renderAllStills：失敗與跳過', () => {
  const miniShapes = (): string => {
    const dir = join(tmp(), 'shapes');
    mkdirSync(dir, { recursive: true });
    for (const id of MINI_IDS) cpSync(join(SHAPES_DIR, `${id}.bin`), join(dir, `${id}.bin`));
    const list = (JSON.parse(readFileSync(join(SHAPES_DIR, 'shapes.json'), 'utf8')) as { id: string }[]).filter((e) => MINI_IDS.includes(e.id));
    writeFileSync(join(dir, 'shapes.json'), JSON.stringify(list));
    return dir;
  };
  const stillsOf = (dir: string): Record<string, string> =>
    Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.webp')).map((f) => [f, readFileSync(join(dir, f)).toString('base64')]));

  it('第二次呼叫不重寫任何檔（輸入沒變就跳過）；少一張或大小對不上 stills.json 就重建；force 一律重建', async () => {
    const shapesDir = miniShapes();
    const outDir = join(tmp(), 'stills');
    const first = await renderAllStills({ shapesDir, outDir });
    expect(first.skipped).toBe(false);
    expect([...first.built].sort()).toEqual([...MINI_NAMES].sort());
    const old = new Date('2001-01-01T00:00:00Z');
    const files = readdirSync(outDir);
    for (const f of files) utimesSync(join(outDir, f), old, old);

    expect(await renderAllStills({ shapesDir, outDir })).toEqual({ built: [], skipped: true });
    for (const f of files) expect(statSync(join(outDir, f)).mtimeMs, f).toBe(old.getTime());

    const before = stillsOf(outDir);
    rmSync(join(outDir, 'kao.webp'));
    expect((await renderAllStills({ shapesDir, outDir })).skipped).toBe(false);
    expect(stillsOf(outDir)).toEqual(before);

    writeFileSync(join(outDir, 'land.webp'), new Uint8Array(20)); // 檔案被截成垃圾：大小對不上 stills.json
    expect((await renderAllStills({ shapesDir, outDir })).skipped).toBe(false);
    expect(stillsOf(outDir)).toEqual(before);

    expect((await renderAllStills({ shapesDir, outDir, force: true })).skipped).toBe(false);
  }, 120_000);

  it('形體檔一變就重建：只有用到那個形體的靜態圖改變（kao.bin 換成 jian 的內容 → 只有 kao.webp 變）', async () => {
    const shapesDir = miniShapes();
    const outDir = join(tmp(), 'stills');
    await renderAllStills({ shapesDir, outDir });
    const before = stillsOf(outDir);

    writeFileSync(join(shapesDir, 'kao.bin'), readFileSync(join(shapesDir, 'jian.bin'))); // 仍是合法形體檔

    expect((await renderAllStills({ shapesDir, outDir })).skipped).toBe(false);
    const after = stillsOf(outDir);
    expect(Object.keys(after).filter((f) => after[f] !== before[f])).toEqual(['kao.webp']);
  }, 120_000);

  it('改渲染原始碼或共用的 staged-output.ts（只加註解）→ 重建，而且圖逐位元不變（渲染是確定性的）', async () => {
    const root = tmp();
    for (const rel of ['scripts/qi', 'src/qi']) cpSync(join(ROOT, rel), join(root, rel), { recursive: true });
    const shapesDir = miniShapes();
    const outDir = join(tmp(), 'stills');
    await renderAllStills({ shapesDir, outDir, root });
    const before = stillsOf(outDir);

    for (const rel of ['scripts/qi/render-stills.ts', 'scripts/qi/staged-output.ts']) {
      writeFileSync(join(root, rel), `${readFileSync(join(root, rel), 'utf8')}\n// 只加註解\n`);
      expect((await renderAllStills({ shapesDir, outDir, root })).skipped, rel).toBe(false);
      expect(stillsOf(outDir), rel).toEqual(before);
    }
  }, 120_000);

  it('建置中途失敗（kao.bin 被截斷）：錯誤訊息帶名稱與原因、不留 .inputs-hash 與 .staging、舊產物原封不動；修好後重建與乾淨建置一致，已不存在的 .webp 殘檔被清掉', async () => {
    const shapesDir = miniShapes();
    const outDir = join(tmp(), 'stills');
    await renderAllStills({ shapesDir, outDir });
    const clean = stillsOf(outDir);
    writeFileSync(join(outDir, 'renamed-away.webp'), new Uint8Array(8)); // 改名的形體留下的殘檔
    const before = stillsOf(outDir);
    const manifestBefore = readFileSync(join(outDir, 'stills.json'), 'utf8');
    const filesBefore = readdirSync(outDir).filter((f) => f !== '.inputs-hash').sort();

    // land 在 kao 之前渲（會渲出新內容）；kao 被截斷（渲到它才失敗）：失敗之後不能只有 land 是新的
    const good = readFileSync(join(shapesDir, 'kao.bin'));
    writeFileSync(join(shapesDir, 'kao.bin'), good.subarray(0, 1000));
    const land = readFileSync(join(shapesDir, 'land.bin'));
    const tweaked = Buffer.from(land);
    tweaked[tweaked.length - 1] = (tweaked[tweaked.length - 1]! + 1) % 100; // 改最後一個點的 kind
    writeFileSync(join(shapesDir, 'land.bin'), tweaked);

    const error = await renderAllStills({ shapesDir, outDir }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('kao');
    expect((error as Error).cause).toBeDefined();
    expect(existsSync(join(outDir, '.inputs-hash'))).toBe(false);
    expect(existsSync(join(outDir, '.staging'))).toBe(false);
    expect(readdirSync(outDir).sort()).toEqual(filesBefore);
    expect(stillsOf(outDir)).toEqual(before);
    expect(readFileSync(join(outDir, 'stills.json'), 'utf8')).toBe(manifestBefore);

    writeFileSync(join(shapesDir, 'kao.bin'), good);
    writeFileSync(join(shapesDir, 'land.bin'), land);
    await renderAllStills({ shapesDir, outDir });
    expect(existsSync(join(outDir, 'renamed-away.webp'))).toBe(false);
    expect(stillsOf(outDir)).toEqual(clean);
  }, 120_000);

  it('shapes.json 不見或缺 land → 丟錯（沒有東西可渲，不默默產出殘缺的一組）', async () => {
    const noManifest = miniShapes();
    rmSync(join(noManifest, 'shapes.json'));
    await expect(renderAllStills({ shapesDir: noManifest, outDir: join(tmp(), 'stills') })).rejects.toThrow(/shapes\.json/);

    const noLand = miniShapes();
    const list = (JSON.parse(readFileSync(join(noLand, 'shapes.json'), 'utf8')) as { id: string }[]).filter((e) => e.id !== 'land');
    writeFileSync(join(noLand, 'shapes.json'), JSON.stringify(list));
    await expect(renderAllStills({ shapesDir: noLand, outDir: join(tmp(), 'stills') })).rejects.toThrow(/land/);
  });
});
