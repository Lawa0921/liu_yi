import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAllShapes } from '../../scripts/qi/build-shapes';
import { hashInputs } from '../../scripts/qi/hash';
import { ARMED } from '../../src/qi/config/armed';
import { FIGURES } from '../../src/qi/config/figures';
import { CREST_CENTER_Y, CREST_WORLD_WIDTH, SCROLL, SEAL_CENTER_Y, SEAL_WORLD_SIZE, SHAPES, WEAPON_NAMES } from '../../src/qi/config/shapes';
import { arrangedSize, figureIndexOf, measureFigures } from '../../src/qi/shapes/arrange';
import { decodeShape, KIND, kindToW, SHAPE_COUNT, type Shape } from '../../src/qi/shapes/format';
import { decodeSnapshot, encodeSnapshot } from '../../src/qi/shapes/weapon-snapshot';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BIN_BYTES = 40 + 7 * SHAPE_COUNT;
const IDS = Object.keys(SHAPES);
/** 建置要吃的輸入都在這幾個目錄裡（剪影只複製 .png）。 */
const INPUT_DIRS = ['src/qi', 'src/assets/seal', 'scripts/qi'];
/** 另外要複製的單一檔案（館徽圖）。 */
const INPUT_FILES = ['src/assets/images/crest-lion.png'];

const tmpDirs: string[] = [];
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'qi-shapes-'));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

/** 把建置的輸入複製成一份暫存的專案根目錄，好在不動真實檔案的前提下改輸入。 */
function copyRoot(): string {
  const dir = tmp();
  for (const rel of INPUT_DIRS) cpSync(join(ROOT, rel), join(dir, rel), { recursive: true });
  for (const rel of INPUT_FILES) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    cpSync(join(ROOT, rel), join(dir, rel));
  }
  mkdirSync(join(dir, 'src/assets/silhouettes'), { recursive: true });
  for (const name of readdirSync(join(ROOT, 'src/assets/silhouettes'))) {
    if (name.endsWith('.png')) cpSync(join(ROOT, 'src/assets/silhouettes', name), join(dir, 'src/assets/silhouettes', name));
  }
  return dir;
}

/**
 * 改一張剪影的一個像素：把影像右下角那格塗成不透明。外框被拉到角落，整個形體的腳底與中線都跟著位移，
 * 所以取樣結果一定會變（隨便改內部一個像素不一定會動到任何取樣點）。
 */
async function paintCorner(file: string): Promise<void> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const corner = (info.width * info.height - 1) * 4;
  expect(data[corner + 3]).toBe(0);
  data.set([255, 255, 255, 255], corner);
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(file);
}

const binOf = (outDir: string, id: string): Buffer => readFileSync(join(outDir, `${id}.bin`));
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const snapshot = (outDir: string): Record<string, string> => Object.fromEntries(IDS.map((id) => [id, sha(binOf(outDir, id))]));
const decode = (outDir: string, id: string): Shape => decodeShape(new Uint8Array(binOf(outDir, id)));
const width = (s: Shape): number => s.max[0] - s.min[0];
const height = (s: Shape): number => s.max[1] - s.min[1];

/** 對真實專案建置一次，供大部分測試共用。 */
const OUT = join(tmpdir(), `qi-shapes-real-${process.pid}`);
let first: { built: string[]; skipped: boolean };
beforeAll(async () => {
  tmpDirs.push(OUT);
  first = await buildAllShapes({ root: ROOT, outDir: OUT });
}, 120_000);

describe('SHAPES 配方', () => {
  it('鍵恰為十九個形體 id，且等於 FIGURES ∪ 三件兵器 ∪ 小孩持劍、持刀、持槍 ∪ seal ∪ scroll ∪ crest ∪ others', () => {
    expect([...IDS].sort()).toEqual(
      ['lift', 'land', 'dingzhou', 'chengchui', 'kao', 'jian', 'miaodao', 'spear', 'salute', 'seal', 'scroll', 'crest', 'others', 'kid-wushu', 'kid-defense-a', 'kid-defense-b', 'kid-weapon', 'kid-miaodao', 'kid-spear'].sort(),
    );
    expect([...IDS].sort()).toEqual([...Object.keys(FIGURES), ...WEAPON_NAMES, 'kid-weapon', 'kid-miaodao', 'kid-spear', 'seal', 'scroll', 'crest', 'others'].sort());
  });

  it('兵器名單與入庫的 .geo 檔一致（不 import weapons.ts）', () => {
    const geo = readdirSync(join(ROOT, 'src/qi/data/weapons')).filter((f) => f.endsWith('.geo')).map((f) => f.replace(/\.geo$/, ''));
    expect([...WEAPON_NAMES].sort()).toEqual(geo.sort());
  });

  it('figure 配方的 figure 就是自己的 id；三件兵器與小孩持劍、持刀、持槍是 armed 配方（持械的人），ARMED 的鍵就是自己的 id', () => {
    for (const id of Object.keys(FIGURES)) expect(SHAPES[id]).toEqual({ kind: 'figure', figure: id });
    const armedIds = [...WEAPON_NAMES, 'kid-weapon', 'kid-miaodao', 'kid-spear'];
    for (const id of armedIds) expect(SHAPES[id], id).toEqual({ kind: 'armed', armed: id });
    expect(Object.keys(ARMED).sort()).toEqual([...armedIds].sort());
    expect(SHAPES.seal).toEqual({ kind: 'seal' });
    expect(SHAPES.scroll).toEqual({ kind: 'scroll' });
    expect(SHAPES.crest).toEqual({ kind: 'crest' });
  });

  it('others＝land、dingzhou、chengchui、kao 四個小人形，縮成 0.38，由左到右排開', () => {
    const recipe = SHAPES.others!;
    expect(recipe.kind).toBe('compose');
    if (recipe.kind !== 'compose') return;
    expect(recipe.parts.map((p) => p.figure)).toEqual(['land', 'dingzhou', 'chengchui', 'kao']);
    for (const part of recipe.parts) {
      expect(part.scale).toBe(0.38);
      expect(FIGURES[part.figure]).toBeDefined();
    }
    const xs = recipe.parts.map((p) => p.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(new Set(xs).size).toBe(4);
  });
});

describe('buildAllShapes：第一次建置', () => {
  it('不是跳過，built 列出全部十九個 id', () => {
    expect(first.skipped).toBe(false);
    expect([...first.built].sort()).toEqual([...IDS].sort());
  });

  it('每個 id 都有 .bin，大小恰為 40 + 7 × 16384，且 outDir 內沒有多的 .bin', () => {
    for (const id of IDS) {
      expect(existsSync(join(OUT, `${id}.bin`)), id).toBe(true);
      expect(statSync(join(OUT, `${id}.bin`)).size, id).toBe(BIN_BYTES);
    }
    expect(readdirSync(OUT).filter((f) => f.endsWith('.bin')).sort()).toEqual(IDS.map((id) => `${id}.bin`).sort());
  });

  it('全部可 decodeShape：點數 16384、座標與外框皆有限、外框確實框住點', () => {
    for (const id of IDS) {
      const s = decode(OUT, id);
      expect(s.count, id).toBe(SHAPE_COUNT);
      expect(s.positions.every(Number.isFinite), id).toBe(true);
      expect([...s.min, ...s.max].every(Number.isFinite), id).toBe(true);
      for (let a = 0; a < 3; a++) {
        expect(s.max[a]! - s.min[a]!, `${id} 軸 ${a}`).toBeGreaterThan(0);
        for (let i = 0; i < s.count; i++) {
          const v = s.positions[i * 3 + a]!;
          if (v < s.min[a]! - 1e-4 || v > s.max[a]! + 1e-4) throw new Error(`${id} 的點 ${i} 超出外框`);
        }
      }
    }
  });

  it('種類合法：人形與 others 只有 0–99，持械形體是人形（0–99）加兵器（100–104），seal 全是 SEAL，scroll 只有 BAMBOO／DARK，crest 全是 CREST', () => {
    for (const id of IDS) {
      const s = decode(OUT, id);
      const kinds = new Set(s.kinds);
      if (id in FIGURES || id === 'others') expect(Math.max(...kinds), id).toBeLessThanOrEqual(99);
      else if (id === 'seal') expect([...kinds]).toEqual([KIND.SEAL]);
      else if (id === 'scroll') expect([...kinds].sort()).toEqual([KIND.DARK, KIND.BAMBOO].sort());
      else if (id === 'crest') expect([...kinds]).toEqual([KIND.CREST]);
      else {
        // 持械形體：人形的點（0–99）加兵器的點（STEEL…AURA）；沒有朱印、竹簡、館徽的種類
        expect(id in ARMED, id).toBe(true);
        expect(Math.min(...kinds), id).toBeLessThanOrEqual(99);
        expect(Math.max(...kinds), id).toBeLessThanOrEqual(KIND.AURA);
        expect(kinds.has(KIND.STEEL) || kinds.has(KIND.DARK), `${id} 有兵器的點`).toBe(true);
        for (const kind of kinds) expect(kind <= 99 || (kind >= KIND.STEEL && kind <= KIND.AURA), `${id} kind ${kind}`).toBe(true);
      }
    }
  });

  it('shapes.json：每個 id 一筆 { id, bytes, sha256 }，與實際檔案相符', () => {
    const list = JSON.parse(readFileSync(join(OUT, 'shapes.json'), 'utf8')) as { id: string; bytes: number; sha256: string }[];
    expect(list.map((e) => e.id).sort()).toEqual([...IDS].sort());
    for (const entry of list) {
      expect(entry.bytes, entry.id).toBe(BIN_BYTES);
      expect(entry.sha256, entry.id).toBe(sha(binOf(OUT, entry.id)));
    }
  });

  it('.inputs-hash 存在、是 64 位十六進位；暫存目錄 .staging 不留殘餘', () => {
    expect(readFileSync(join(OUT, '.inputs-hash'), 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(OUT, '.staging'))).toBe(false);
  });

  it('全部 .bin 合計 ≤ 2.3 MB（十九個，每個 114 728 B；使用者每頁只下載用到的幾個，整頁預算由 budget.spec 守住）', () => {
    const total = IDS.reduce((sum, id) => sum + statSync(join(OUT, `${id}.bin`)).size, 0);
    expect(total).toBeLessThanOrEqual(2.3 * 1024 * 1024);
  });

  it('人形的外框＝腳底在 y = 0、中線在 x = 0；lift 與 land 的世界身高接近 2', () => {
    for (const id of Object.keys(FIGURES)) {
      const s = decode(OUT, id);
      expect(Math.abs(s.min[1]), id).toBeLessThan(0.01);
      expect(Math.abs(s.min[0] + s.max[0]) / 2, id).toBeLessThan(0.1);
    }
    expect(height(decode(OUT, 'land'))).toBeGreaterThan(1.7);
    expect(height(decode(OUT, 'land'))).toBeLessThan(2.1);
  });

  it('持械形體：兵器的點比人形密、比人形亮（使用者：兵器部分的點較密、較亮）——每個佔用的 0.04 格裡，兵器表面的點數 ≥ 人形的 1.25 倍，平均 w ≥ 人形的 2 倍', () => {
    const cell = 0.04;
    for (const id of Object.keys(ARMED)) {
      const s = decode(OUT, id);
      const body = new Map<string, number>();
      const weapon = new Map<string, number>();
      let bodyW = 0;
      let bodyN = 0;
      let weaponW = 0;
      let weaponN = 0;
      for (let i = 0; i < s.count; i++) {
        const kind = s.kinds[i]!;
        const key = `${Math.floor(s.positions[i * 3]! / cell)},${Math.floor(s.positions[i * 3 + 1]! / cell)}`;
        if (kind < 100) {
          body.set(key, (body.get(key) ?? 0) + 1);
          bodyW += kindToW(kind);
          bodyN++;
        } else if (kind !== KIND.AURA) {
          weapon.set(key, (weapon.get(key) ?? 0) + 1);
          weaponW += kindToW(kind);
          weaponN++;
        }
      }
      const mean = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0) / m.size;
      expect(mean(weapon) / mean(body), `${id} 兵器表面的點密度 ÷ 人形`).toBeGreaterThanOrEqual(1.25);
      expect(weaponW / weaponN / (bodyW / bodyN), `${id} 兵器的平均 w ÷ 人形`).toBeGreaterThanOrEqual(2);
    }
  });

  it('持械形體：腳底在 y = 0（與其他人形同一把尺）、兵器的點占 weaponShare、整體（人加兵器）的外框高在 1.2–2.8 世界單位之間（兵器軸與剪影一致由 qi-armed.test、qi-armed-assets.test 驗）', () => {
    for (const [id, def] of Object.entries(ARMED)) {
      const s = decode(OUT, id);
      expect(Math.abs(s.min[1]), `${id} 腳底`).toBeLessThan(0.02);
      const weapon = Array.from({ length: s.count }, (_, i) => i).filter((i) => s.kinds[i]! >= KIND.STEEL);
      expect(weapon.length / s.count, `${id} 兵器點占比`).toBeCloseTo(def.spec.weaponShare, 2);
      expect(height(s), `${id} 世界身高（含兵器，人加兵器的外框高）`).toBeGreaterThan(1.2);
      expect(height(s)).toBeLessThan(2.8);
    }
  });
});

describe('others（合成形體）', () => {
  it('執行時排列（shapes/arrange.ts）：依配方中線分組量到四個人形，各自的外框互不相交，2×2 比橫排窄得多（直向畫布塞得下）', () => {
    const recipe = SHAPES.others!;
    if (recipe.kind !== 'compose') throw new Error('others 必須是 compose');
    const s = decode(OUT, 'others');
    const centers = recipe.parts.map((p) => p.x);
    const boxes = measureFigures(s, centers);
    expect(boxes).toHaveLength(4);
    for (let k = 0; k < 3; k++) expect(boxes[k + 1]!.minX - boxes[k]!.maxX, `第 ${k} 與 ${k + 1} 個之間`).toBeGreaterThan(0.1);
    for (const [k, box] of boxes.entries()) {
      expect(box.minY, `第 ${k} 個的腳底`).toBeCloseTo(0, 1);
      expect(figureIndexOf((box.minX + box.maxX) / 2, centers), `第 ${k} 個的中線落在自己的分組`).toBe(k);
    }
    const row = arrangedSize(boxes, { rows: [[0, 1, 2, 3]], scale: 1, gap: 0.25, rowGap: 0 });
    const grid = arrangedSize(boxes, { rows: [[0, 1], [2, 3]], scale: 1, gap: 0.15, rowGap: 0.15 });
    expect(grid.width).toBeLessThan(row.width * 0.6);
    expect(grid.width).toBeLessThan(2.75); // 直向可視寬（framing.ts）
  });

  it('總寬 ÷ 總高 ≥ 2.5，且高度是小人形（約 land 的 0.38 倍）', () => {
    const s = decode(OUT, 'others');
    expect(width(s) / height(s)).toBeGreaterThanOrEqual(2.5);
    const ratio = height(s) / height(decode(OUT, 'land'));
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.42);
  });

  it('四個小人形各占四分之一，而且任何前綴都是同一個比例（載入時依 tier 取前綴）', () => {
    const recipe = SHAPES.others!;
    if (recipe.kind !== 'compose') throw new Error('others 必須是 compose');
    const s = decode(OUT, 'others');
    const centers = recipe.parts.map((p) => p.x);
    const nearest = (x: number) => centers.reduce((best, c, k) => (Math.abs(x - c) < Math.abs(x - centers[best]!) ? k : best), 0);
    for (const prefix of [SHAPE_COUNT, 4096, 1000]) {
      const counts = [0, 0, 0, 0];
      for (let i = 0; i < prefix; i++) counts[nearest(s.positions[i * 3]!)]!++;
      for (const c of counts) expect(Math.abs(c / prefix - 0.25), `前綴 ${prefix}`).toBeLessThan(0.01);
    }
  });

  it('四個小人形之間有空隙（沒有互相疊在一起）', () => {
    const recipe = SHAPES.others!;
    if (recipe.kind !== 'compose') throw new Error('others 必須是 compose');
    const s = decode(OUT, 'others');
    const centers = recipe.parts.map((p) => p.x);
    const ranges = centers.map(() => ({ lo: Infinity, hi: -Infinity }));
    for (let i = 0; i < s.count; i++) {
      const x = s.positions[i * 3]!;
      const k = i % 4; // 交錯排列：第 i 點屬於第 i % 4 個人形
      ranges[k]!.lo = Math.min(ranges[k]!.lo, x);
      ranges[k]!.hi = Math.max(ranges[k]!.hi, x);
    }
    for (let k = 0; k < 3; k++) expect(ranges[k + 1]!.lo - ranges[k]!.hi, `第 ${k} 與 ${k + 1} 個之間`).toBeGreaterThan(0.1);
  });

  it('每個小人形是同一張剪影的完整形體縮成 0.38 的相似形（寬度、中線、z 厚度都成比例）', () => {
    const recipe = SHAPES.others!;
    if (recipe.kind !== 'compose') throw new Error('others 必須是 compose');
    const s = decode(OUT, 'others');
    recipe.parts.forEach((part, k) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = k; i < s.count; i += 4) {
        lo = Math.min(lo, s.positions[i * 3]!);
        hi = Math.max(hi, s.positions[i * 3]!);
      }
      const full = decode(OUT, part.figure);
      const expected = width(full) * part.scale;
      expect((hi - lo) / expected, part.figure).toBeGreaterThan(0.95);
      expect((hi - lo) / expected, part.figure).toBeLessThan(1.05);
      expect((hi + lo) / 2 - part.x, `${part.figure} 的中線`).toBeCloseTo(0, 1);
      // 縮小是三個軸一起縮：z 的厚度也不會比等比縮小的原形體更厚
      let zMax = 0;
      for (let i = k; i < s.count; i += 4) zMax = Math.max(zMax, Math.abs(s.positions[i * 3 + 2]!));
      const fullZ = Math.max(Math.abs(full.min[2]), Math.abs(full.max[2]));
      expect(zMax, `${part.figure} 的 z`).toBeLessThan(fullZ * part.scale * 1.5);
    });
  });
});

describe('scroll（竹簡：程序化，沒有任何輸入檔）', () => {
  it('建置出來的 scroll 就是 sampleScroll 的結果：外框寬高比 1.2–1.9、置中、薄、兩端往鏡頭凸出', () => {
    const s = decode(OUT, 'scroll');
    expect(width(s) / height(s)).toBeGreaterThan(1.2);
    expect(width(s) / height(s)).toBeLessThan(1.9);
    expect((s.min[0] + s.max[0]) / 2).toBeCloseTo(0, 1);
    expect((s.min[1] + s.max[1]) / 2).toBeCloseTo(SCROLL.centerY, 1);
    expect(s.max[2]).toBeGreaterThan(0.15);
    // 綁繩（DARK）約 9%
    const dark = [...s.kinds].filter((k) => k === KIND.DARK).length / s.count;
    expect(dark).toBeGreaterThan(0.05);
    expect(dark).toBeLessThan(0.18);
  });

  it('改任何圖檔都不影響 scroll（它不吃輸入檔）：改館徽圖 → 只有 crest 改變', async () => {
    const root = copyRoot();
    const outDir = join(tmp(), 'shapes');
    await buildAllShapes({ root, outDir });
    const before = snapshot(outDir);
    const file = join(root, 'src/assets/images/crest-lion.png');
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // 左上角 40×40 塗成不透明：亮面多了一塊，取樣分布整個改變
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) data.set([255, 255, 255, 255], (y * info.width + x) * 4);
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(file);
    expect((await buildAllShapes({ root, outDir })).skipped).toBe(false);
    const after = snapshot(outDir);
    expect(IDS.filter((id) => after[id] !== before[id])).toEqual(['crest']);
  }, 120_000);
});

describe('crest（光點館徽：吃 crest-lion.png）', () => {
  it('置中在 (0, CREST_CENTER_Y)、寬不超過 CREST_WORLD_WIDTH、外框寬高比接近館徽、很薄', () => {
    const s = decode(OUT, 'crest');
    expect(width(s)).toBeLessThanOrEqual(CREST_WORLD_WIDTH + 1e-3);
    expect(width(s)).toBeGreaterThan(CREST_WORLD_WIDTH * 0.9);
    expect(width(s) / height(s)).toBeGreaterThan(0.95);
    expect(width(s) / height(s)).toBeLessThan(1.25);
    expect(Math.abs((s.min[0] + s.max[0]) / 2)).toBeLessThan(0.1);
    expect((s.min[1] + s.max[1]) / 2).toBeCloseTo(CREST_CENTER_Y, 0);
    expect(s.max[2] - s.min[2]).toBeLessThan(0.1);
  });

  it('每個點都在館徽的亮線上（alpha ≥ 64）；亮線取樣：整體 alpha 平均高於整張圖不透明部分的平均', async () => {
    const { data, info } = await sharp(join(ROOT, 'src/assets/images/crest-lion.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const unit = CREST_WORLD_WIDTH / info.width;
    const s = decode(OUT, 'crest');
    let weak = 0;
    for (let i = 0; i < s.count; i++) {
      const px = Math.min(info.width - 1, Math.max(0, Math.floor(s.positions[i * 3]! / unit + info.width / 2)));
      const py = Math.min(info.height - 1, Math.max(0, Math.floor(info.height / 2 - (s.positions[i * 3 + 1]! - CREST_CENTER_Y) / unit)));
      if (data[(py * info.width + px) * 4 + 3]! < 64) weak++;
    }
    expect(weak / s.count, '落在暗面或透明處的點（u16 量化的取整誤差容許 3%）').toBeLessThan(0.03);
  });
});

describe('seal（朱印遮罩取樣）', () => {
  it('寬高比在 0.8–1.25、置中在 (0, SEAL_CENTER_Y)，深度很薄', () => {
    const s = decode(OUT, 'seal');
    const aspect = width(s) / height(s);
    expect(aspect).toBeGreaterThan(0.8);
    expect(aspect).toBeLessThan(1.25);
    expect((s.min[0] + s.max[0]) / 2).toBeCloseTo(0, 1);
    expect((s.min[1] + s.max[1]) / 2).toBeCloseTo(SEAL_CENTER_Y, 1);
    expect(width(s)).toBeLessThanOrEqual(SEAL_WORLD_SIZE + 1e-3);
    expect(s.max[2] - s.min[2]).toBeLessThan(0.1);
  });

  it('每個點都落在遮罩的墨（不透明像素）上，且左右的墨量比例與遮罩一致（朱印沒有左右顛倒或上下顛倒）', async () => {
    const { data, info } = await sharp(join(ROOT, 'src/assets/seal/seal-liuyi.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (px: number, py: number): number => {
      const x = Math.floor(px);
      const y = Math.floor(py);
      return x < 0 || y < 0 || x >= info.width || y >= info.height ? 0 : data[(y * info.width + x) * 4 + 3]!;
    };
    const unit = SEAL_WORLD_SIZE / info.width;
    const s = decode(OUT, 'seal');
    let onInk = 0;
    let left = 0;
    let top = 0;
    for (let i = 0; i < s.count; i++) {
      const px = s.positions[i * 3]! / unit + info.width / 2;
      const py = info.height / 2 - (s.positions[i * 3 + 1]! - SEAL_CENTER_Y) / unit;
      if (alphaAt(px, py) >= 128) onInk++;
      if (px < info.width / 2) left++;
      if (py < info.height / 2) top++;
    }
    expect(onInk / s.count).toBeGreaterThan(0.995);

    let inkTotal = 0;
    let inkLeft = 0;
    let inkTop = 0;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * 4 + 3]! < 128) continue;
        inkTotal++;
        if (x < info.width / 2) inkLeft++;
        if (y < info.height / 2) inkTop++;
      }
    expect(Math.abs(left / s.count - inkLeft / inkTotal)).toBeLessThan(0.03);
    expect(Math.abs(top / s.count - inkTop / inkTotal)).toBeLessThan(0.03);
  });
});

describe('buildAllShapes：輸入雜湊與跳過', () => {
  it('第二次呼叫 skipped === true，built 為空，而且不重寫任何檔（mtime 不變）', async () => {
    const outDir = join(tmp(), 'shapes');
    await buildAllShapes({ root: ROOT, outDir });
    const old = new Date('2001-01-01T00:00:00Z');
    const files = readdirSync(outDir);
    for (const f of files) utimesSync(join(outDir, f), old, old);

    const second = await buildAllShapes({ root: ROOT, outDir });

    expect(second).toEqual({ built: [], skipped: true });
    for (const f of files) expect(statSync(join(outDir, f)).mtimeMs, f).toBe(old.getTime());
    expect(readdirSync(outDir).sort()).toEqual(files.sort());
  }, 120_000);

  it('改一張剪影的一個像素 → skipped === false，只有用到那張剪影的 id（kao、others）內容改變', async () => {
    const root = copyRoot();
    const outDir = join(tmp(), 'shapes');
    await buildAllShapes({ root, outDir });
    const before = snapshot(outDir);
    const hashBefore = readFileSync(join(outDir, '.inputs-hash'), 'utf8');

    await paintCorner(join(root, 'src/assets/silhouettes', `${FIGURES.kao!.src}.png`));

    const second = await buildAllShapes({ root, outDir });

    expect(second.skipped).toBe(false);
    expect(readFileSync(join(outDir, '.inputs-hash'), 'utf8')).not.toBe(hashBefore);
    const after = snapshot(outDir);
    const changed = IDS.filter((id) => after[id] !== before[id]);
    expect(changed.sort()).toEqual(['kao', 'others']);
  }, 120_000);

  it('改朱印遮罩 → 只有 seal 改變；改一個 .geo → 只有用它的兵器形體改變', async () => {
    const root = copyRoot();
    const outDir = join(tmp(), 'shapes');
    await buildAllShapes({ root, outDir });
    const before = snapshot(outDir);

    const sealFile = join(root, 'src/assets/seal/seal-liuyi.png');
    const { data, info } = await sharp(sealFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // 把左上角 40×40（框外的留白）塗成不透明：墨多了一塊，取樣的分布整個改變
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) data.set([255, 255, 255, 255], (y * info.width + x) * 4);
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(sealFile);
    expect((await buildAllShapes({ root, outDir })).skipped).toBe(false);
    const afterSeal = snapshot(outDir);
    expect(IDS.filter((id) => afterSeal[id] !== before[id])).toEqual(['seal']);

    // 苗刀的快照拿掉最後一個零件再存回去（仍是合法快照）
    const geo = join(root, 'src/qi/data/weapons/miaodao.geo');
    const snap = decodeSnapshot(new Uint8Array(readFileSync(geo)));
    expect(snap.parts.length).toBeGreaterThan(1);
    writeFileSync(geo, encodeSnapshot({ ...snap, parts: snap.parts.slice(0, -1) }));
    expect((await buildAllShapes({ root, outDir })).skipped).toBe(false);
    const afterGeo = snapshot(outDir);
    // 苗刀的幾何是大人苗刀與小孩持刀共用的
    expect(IDS.filter((id) => afterGeo[id] !== afterSeal[id]).sort()).toEqual(['kid-miaodao', 'miaodao']);
  }, 120_000);

  it('改取樣原始碼（shapes/*.ts、config/shapes.ts、建置腳本）→ 重建；只動註解時所有 .bin 逐位元不變（建置是確定性的）', async () => {
    const root = copyRoot();
    const outDir = join(tmp(), 'shapes');
    await buildAllShapes({ root, outDir });
    const before = snapshot(outDir);

    const sources = ['src/qi/shapes/sample-figure.ts', 'src/qi/shapes/format.ts', 'src/qi/config/shapes.ts', 'src/qi/config/figures.ts', 'scripts/qi/build-shapes.ts', 'scripts/qi/hash.ts', 'scripts/qi/staged-output.ts'];
    for (const rel of sources) {
      appendFileSync(join(root, rel), '\n// 只加註解\n');
      const result = await buildAllShapes({ root, outDir });
      expect(result.skipped, rel).toBe(false);
      expect(snapshot(outDir), rel).toEqual(before);
    }
  }, 180_000);

  it('少了一個 .bin → 即使 .inputs-hash 相符也重建；force: true 一律重建', async () => {
    const outDir = join(tmp(), 'shapes');
    await buildAllShapes({ root: ROOT, outDir });
    const before = snapshot(outDir);

    rmSync(join(outDir, 'jian.bin'));
    const healed = await buildAllShapes({ root: ROOT, outDir });
    expect(healed.skipped).toBe(false);
    expect(snapshot(outDir)).toEqual(before);

    expect((await buildAllShapes({ root: ROOT, outDir })).skipped).toBe(true);
    const forced = await buildAllShapes({ root: ROOT, outDir, force: true });
    expect(forced.skipped).toBe(false);
    expect([...forced.built].sort()).toEqual([...IDS].sort());
  }, 180_000);

  it('某個 .bin 被截斷（大小不是 40 + 7 × 16384）→ 即使 .inputs-hash 相符也重建', async () => {
    const outDir = join(tmp(), 'shapes');
    await buildAllShapes({ root: ROOT, outDir });
    const before = snapshot(outDir);

    writeFileSync(join(outDir, 'land.bin'), binOf(outDir, 'land').subarray(0, 1000));
    const healed = await buildAllShapes({ root: ROOT, outDir });

    expect(healed.skipped).toBe(false);
    expect(statSync(join(outDir, 'land.bin')).size).toBe(BIN_BYTES);
    expect(snapshot(outDir)).toEqual(before);
  }, 120_000);

  it('shapes.json 不見 → 即使 .inputs-hash 與全部 .bin 都在也重建', async () => {
    const outDir = join(tmp(), 'shapes');
    await buildAllShapes({ root: ROOT, outDir });
    const manifest = readFileSync(join(outDir, 'shapes.json'), 'utf8');

    rmSync(join(outDir, 'shapes.json'));
    const healed = await buildAllShapes({ root: ROOT, outDir });

    expect(healed.skipped).toBe(false);
    expect(readFileSync(join(outDir, 'shapes.json'), 'utf8')).toBe(manifest);
  }, 120_000);

  // 「暫存再換入」的故障注入情境（換入中途失敗、.staging 清不掉、殘檔）集中在 qi-staged-output.test.ts；
  // 這一條是整合等級的：證明形體產線真的接上了 commitStaged（錯誤帶形體 id、失敗不混雜、殘檔副檔名是 .bin）。
  it('建置中途失敗（kao 的剪影被截斷）：錯誤訊息帶形體 id 與原因、沒有 .inputs-hash、輸出目錄不新舊混雜；修好後重建，產物與乾淨建置一致，已不在 SHAPES 的 .bin 殘檔被清掉', async () => {
    const root = copyRoot();
    const outDir = join(tmp(), 'shapes');
    await buildAllShapes({ root, outDir });
    writeFileSync(join(outDir, 'renamed-away.bin'), new Uint8Array(8)); // 改名的形體留下的殘檔
    const before = snapshot(outDir);
    const manifestBefore = readFileSync(join(outDir, 'shapes.json'), 'utf8');
    const filesBefore = readdirSync(outDir).filter((f) => f !== '.inputs-hash').sort();

    // land 的輸入改了（它在 kao 之前建，會建出新內容），kao 的剪影被截斷（建到它就失敗）：
    // 失敗之後不能只有 land.bin 是新的，也不能留下新的 shapes.json 或半套檔案。
    await paintCorner(join(root, 'src/assets/silhouettes', `${FIGURES.land!.src}.png`));
    const kaoFile = join(root, 'src/assets/silhouettes', `${FIGURES.kao!.src}.png`);
    const kaoGood = readFileSync(kaoFile);
    writeFileSync(kaoFile, kaoGood.subarray(0, 100));

    const error = await buildAllShapes({ root, outDir }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('形體 kao');
    expect((error as Error).cause).toBeDefined();
    expect(existsSync(join(outDir, '.inputs-hash'))).toBe(false);
    expect(existsSync(join(outDir, '.staging'))).toBe(false);
    expect(readdirSync(outDir).sort()).toEqual(filesBefore);
    expect(snapshot(outDir)).toEqual(before);
    expect(readFileSync(join(outDir, 'shapes.json'), 'utf8')).toBe(manifestBefore);

    writeFileSync(kaoFile, kaoGood);
    const fixed = await buildAllShapes({ root, outDir });
    const clean = join(tmp(), 'shapes');
    await buildAllShapes({ root, outDir: clean });

    expect(fixed.skipped).toBe(false);
    expect(existsSync(join(outDir, '.staging'))).toBe(false);
    expect(snapshot(outDir)).toEqual(snapshot(clean));
    expect(snapshot(outDir).land).not.toBe(before.land); // land 確實吃到了修改
    expect(readFileSync(join(outDir, 'shapes.json'), 'utf8')).toBe(readFileSync(join(clean, 'shapes.json'), 'utf8'));
    expect(readFileSync(join(outDir, '.inputs-hash'), 'utf8')).toBe(readFileSync(join(clean, '.inputs-hash'), 'utf8'));
    expect(readdirSync(outDir).sort()).toEqual(readdirSync(clean).sort());
  }, 180_000);
});

describe('hashInputs', () => {
  it('內容相同就雜湊相同（與根目錄、檔案順序、重複項無關）；內容、路徑或 salt 一變就不同', () => {
    const a = tmp();
    const b = tmp();
    for (const dir of [a, b]) {
      writeFileSync(join(dir, 'x.txt'), 'x');
      writeFileSync(join(dir, 'y.txt'), 'y');
    }
    const base = hashInputs(a, ['x.txt', 'y.txt'], 'v1');
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInputs(b, ['y.txt', 'x.txt', 'x.txt'], 'v1')).toBe(base);
    expect(hashInputs(a, ['x.txt', 'y.txt'], 'v2')).not.toBe(base);
    expect(hashInputs(a, ['x.txt'], 'v1')).not.toBe(base);
    writeFileSync(join(b, 'y.txt'), 'changed');
    expect(hashInputs(b, ['x.txt', 'y.txt'], 'v1')).not.toBe(base);
  });

  it('輸入檔不存在就丟錯，訊息帶相對路徑', () => {
    expect(() => hashInputs(tmp(), ['nope/missing.png'])).toThrow(/nope\/missing\.png/);
  });
});
