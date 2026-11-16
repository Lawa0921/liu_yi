import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

// 朱印「六藝」遮罩的閘門（計畫 D9）：入庫的只有 512×512 的 alpha 遮罩，崇羲篆體字型檔絕不入庫。
// 朱文＝字與框是實心（不透明），其餘透明；右「六」左「藝」，框為方形，字與框之間要留白。
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MASK = fileURLToPath(new URL('../../src/assets/seal/seal-liuyi.png', import.meta.url));
const PROVENANCE = fileURLToPath(new URL('../../src/assets/silhouettes/provenance.json', import.meta.url));

const SIZE = 512;
const INK = 128; // alpha ≥ 此值算「墨」
const BIG_AREA = 1500; // 一個字（或字的主體）至少要有的面積
const GAP = 8; // 字與框內緣至少留白

interface Mask {
  alpha: Uint8Array;
  width: number;
  height: number;
}

interface Component {
  id: number;
  area: number;
  cx: number; // 質心，0–1
  cy: number;
  minD: number; // 此元件任一像素到畫布最近邊的最小距離
}

async function readMask(path: string): Promise<Mask> {
  // 灰階＋alpha（2 通道）或 RGBA（4 通道）都收：alpha 一律是最後一個通道
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const alpha = new Uint8Array(info.width * info.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = ch === 1 ? 255 : data[i * ch + ch - 1]!;
  return { alpha, width: info.width, height: info.height };
}

/** 4 連通標記，墨像素＝alpha ≥ INK。labels 為 0（空）或元件編號（從 1 起）。 */
function label(mask: Mask): { labels: Int32Array; components: Component[] } {
  const { alpha, width: w, height: h } = mask;
  const labels = new Int32Array(w * h);
  const components: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < labels.length; start++) {
    if (alpha[start]! < INK || labels[start] !== 0) continue;
    const id = components.length + 1;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let minD = Infinity;
    const push = (q: number): void => {
      if (alpha[q]! >= INK && labels[q] === 0) {
        labels[q] = id;
        stack.push(q);
      }
    };
    push(start);
    while (stack.length > 0) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      area++;
      sx += x;
      sy += y;
      minD = Math.min(minD, x, y, w - 1 - x, h - 1 - y);
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
    components.push({ id, area, cx: sx / area / w, cy: sy / area / h, minD });
  }
  return { labels, components };
}

/** 從 (x, y) 朝 (dx, dy) 走，回傳連續墨像素的長度。 */
function runLength(mask: Mask, x: number, y: number, dx: number, dy: number): number {
  let n = 0;
  while (x >= 0 && y >= 0 && x < mask.width && y < mask.height && mask.alpha[y * mask.width + x]! >= INK) {
    n++;
    x += dx;
    y += dy;
  }
  return n;
}

function walkFiles(dir: string, skip: ReadonlySet<string>, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.name.startsWith('dist')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, skip, out);
    else out.push(full);
  }
  return out;
}

describe('朱印遮罩 src/assets/seal/seal-liuyi.png', () => {
  let mask: Mask;
  let labels: Int32Array;
  let components: Component[];
  let frameId: number; // 框的元件編號（取上緣中點）
  let frameInnerEdge: number; // 框內緣離畫布邊的距離（量四邊中點的最小值）

  beforeAll(async () => {
    expect(existsSync(MASK), `缺 ${MASK}，先跑 tools/seal/render-seal.py`).toBe(true);
    mask = await readMask(MASK);
    ({ labels, components } = label(mask));
    const { width: w, height: h } = mask;
    frameId = labels[11 * w + w / 2]!;
    // 框外緣在 8 px 之後；從 ring 內（d = 11）往內量墨的連續長度，再加回 11
    frameInnerEdge =
      11 +
      Math.min(
        runLength(mask, 11, h / 2, 1, 0),
        runLength(mask, w - 12, h / 2, -1, 0),
        runLength(mask, w / 2, 11, 0, 1),
        runLength(mask, w / 2, h - 12, 0, -1),
      );
  });

  it('是 512×512 並帶 alpha 通道', async () => {
    const meta = await sharp(MASK).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(SIZE);
    expect(meta.height).toBe(SIZE);
    expect(meta.hasAlpha).toBe(true);
  });

  it('沒有半透明霧：中間 alpha 只出現在邊緣 2 px 內（鄰近同時有全透明與全不透明）', () => {
    const { alpha, width: w, height: h } = mask;
    const stray: string[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = alpha[y * w + x]!;
        if (a === 0 || a === 255) continue;
        let seesClear = false;
        let seesInk = false;
        for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) {
          for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) {
            const b = alpha[yy * w + xx]!;
            if (b === 0) seesClear = true;
            if (b === 255) seesInk = true;
          }
        }
        if (!(seesClear && seesInk)) stray.push(`(${x},${y})=${a}`);
      }
    }
    expect(stray.slice(0, 10)).toEqual([]);
  });

  it('外框存在：距四邊 8–14 px 的環上不透明比例 ≥ 95%', () => {
    const { alpha, width: w, height: h } = mask;
    let ring = 0;
    let ink = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.min(x, y, w - 1 - x, h - 1 - y);
        if (d < 8 || d > 14) continue;
        ring++;
        if (alpha[y * w + x]! >= INK) ink++;
      }
    }
    expect(ink / ring).toBeGreaterThanOrEqual(0.95);
  });

  it('外框是閉合的單一連通元件：四邊中點同屬一個元件', () => {
    const { width: w, height: h } = mask;
    const ids = [
      labels[11 * w + w / 2]!,
      labels[(h - 12) * w + w / 2]!,
      labels[(h / 2) * w + 11]!,
      labels[(h / 2) * w + (w - 12)]!,
    ];
    expect(ids[0]).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(1);
  });

  it(`字與框之間有留白：框以外的墨離框內緣至少 ${GAP} px（字不與框相連）`, () => {
    const others = components.filter((c) => c.id !== frameId);
    expect(others.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...others.map((c) => c.minD)) - frameInnerEdge).toBeGreaterThanOrEqual(GAP);
  });

  it('框內至少 2 個大連通元件（各 ≥ 1 500 px）；最大兩個一左一右，質心 y 靠中', () => {
    const big = components.filter((c) => c.id !== frameId && c.area >= BIG_AREA);
    expect(big.length).toBeGreaterThanOrEqual(2);
    const [a, b] = [...big].sort((p, q) => q.area - p.area).slice(0, 2) as [Component, Component];
    const [left, right] = a.cx < b.cx ? [a, b] : [b, a];
    expect(Math.abs(left.cx - 0.25)).toBeLessThanOrEqual(0.12); // 左＝藝
    expect(Math.abs(right.cx - 0.75)).toBeLessThanOrEqual(0.12); // 右＝六
    expect(Math.abs(left.cy - 0.5)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(right.cy - 0.5)).toBeLessThanOrEqual(0.15);
  });

  it('墨量占整張 0.25–0.55', () => {
    let ink = 0;
    for (const a of mask.alpha) if (a >= INK) ink++;
    const ratio = ink / mask.alpha.length;
    expect(ratio).toBeGreaterThanOrEqual(0.25);
    expect(ratio).toBeLessThanOrEqual(0.55);
  });
});

describe('朱印來源紀錄（provenance.json 的 seal-liuyi）', () => {
  it('有紀錄，綁定目前這張遮罩（sha256）與字型來源（只記 sha256，不含字型檔）', () => {
    const provenance = JSON.parse(readFileSync(PROVENANCE, 'utf8')) as Record<string, Record<string, unknown>>;
    const entry = provenance['seal-liuyi'];
    expect(entry, 'provenance.json 缺 seal-liuyi').toBeDefined();
    expect(entry!.status).toBe('approved');
    expect(entry!.tool).toBe('tools/seal/render-seal.py');
    expect(entry!.fontSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry!.maskSha256).toBe(createHash('sha256').update(readFileSync(MASK)).digest('hex'));
    expect(entry!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(entry!.license)).toMatch(/CC BY-ND 3\.0 TW/);
  });
});

describe('字型檔不入庫', () => {
  it('repo 內沒有 *.otf、*.ttf、檔名含 chongxi 的檔案（略過 node_modules、.cache、dist*、.git、.astro）', () => {
    const skip = new Set(['node_modules', '.cache', '.git', '.astro']);
    const offenders = walkFiles(ROOT, skip)
      .map((f) => f.slice(ROOT.length))
      .filter((f) => /\.(otf|ttf)$/i.test(f) || /chongxi/i.test(f.split(/[\\/]/).pop()!));
    expect(offenders).toEqual([]);
  });
});
