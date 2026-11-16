/**
 * 形體產線（D10、D11）：依 `src/qi/config/shapes.ts` 的配方，在建置時把每個形體取樣成 `<id>.bin`（v1，固定 16 384 點），
 * 另寫 `shapes.json`（`[{ id, bytes, sha256 }]`）與 `.inputs-hash`。輸出在 `src/assets/generated/qi/shapes/`（已忽略，不進 git）。
 *
 * 輸入雜湊 = 配方用到的剪影 PNG、朱印遮罩 PNG、兵器 `.geo` 快照，加上 `config/{figures,shapes}.ts`、`shapes/*.ts`、
 * 本腳本與 `hash.ts` 的原始碼，以及形體檔格式版本。雜湊沒變、檔案齊全就跳過（不重寫任何檔）。
 * 本腳本自己也進雜湊：朱印取樣、合成排列的邏輯寫在這裡，改了它產物就該重建。
 *
 * 只用 Node 與入庫的檔案（CI 沒有 Python、字型原檔，也不 import `weapons.ts`：兵器取樣吃 `.geo` 快照，見 D29）。
 * 固定種子（由形體 id 雜湊而來）＋純函式取樣：同輸入逐位元相同。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { FIGURES, figureScale } from '../../src/qi/config/figures';
import { SEAL_CENTER_Y, SEAL_WORLD_SIZE, SHAPES, type ShapeRecipe } from '../../src/qi/config/shapes';
import { encodeShape, KIND, SHAPE_COUNT, SHAPE_FORMAT_VERSION, type Shape } from '../../src/qi/shapes/format';
import { OPAQUE } from '../../src/qi/shapes/head';
import { rng } from '../../src/qi/shapes/rng';
import { sampleFigure, type FigureImage } from '../../src/qi/shapes/sample-figure';
import { sampleWeapon } from '../../src/qi/shapes/sample-weapon';
import { decodeSnapshot } from '../../src/qi/shapes/weapon-snapshot';
import { hashInputs, listFiles, sha256 } from './hash';

const SEAL_MASK = 'src/assets/seal/seal-liuyi.png';
/** 朱印的深度：z 在 ±這個值內（人形約 ±0.3，印是薄薄一片）。 */
const SEAL_HALF_DEPTH = 0.02;
const HASH_FILE = '.inputs-hash';
const MANIFEST = 'shapes.json';

/** 這個配方用到的剪影原圖、遮罩或快照（相對專案根目錄）。 */
function recipeInputs(id: string, recipe: ShapeRecipe): string[] {
  switch (recipe.kind) {
    case 'figure':
      return [silhouetteFile(id, recipe.figure)];
    case 'weapon':
      return [`src/qi/data/weapons/${recipe.name}.geo`];
    case 'seal':
      return [SEAL_MASK];
    case 'compose':
      return recipe.parts.map((part) => silhouetteFile(id, part.figure));
  }
}

function silhouetteFile(id: string, figure: string): string {
  const def = FIGURES[figure];
  if (!def) throw new Error(`形體 ${id} 的配方引用了不存在的人形 ${figure}（FIGURES 沒有這個鍵）`);
  return `src/assets/silhouettes/${def.src}.png`;
}

/** 全部輸入：配方用到的素材＋影響取樣結果的原始碼。 */
function allInputs(root: string): string[] {
  const assets = Object.entries(SHAPES).flatMap(([id, recipe]) => recipeInputs(id, recipe));
  return [
    ...assets,
    'src/qi/config/figures.ts',
    'src/qi/config/shapes.ts',
    ...listFiles(root, 'src/qi/shapes', '.ts'),
    'scripts/qi/build-shapes.ts',
    'scripts/qi/hash.ts',
  ];
}

/** 形體 id → 32 位元種子（FNV-1a）：種子不依賴配方的排列順序，加減形體不會讓其他形體的點跑掉。 */
function seedOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 以 sharp 解碼 PNG，取 alpha（灰階＋alpha 或 RGBA，alpha 都是最後一個通道）。 */
async function loadMask(root: string, rel: string): Promise<FigureImage> {
  const { data, info } = await sharp(join(root, rel)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = new Uint8Array(info.width * info.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * info.channels + info.channels - 1]!;
  return { alpha, width: info.width, height: info.height };
}

/** 朱印：均勻取遮罩裡的墨（alpha ≥ OPAQUE），x 向右、y 向上，印的中心在 (0, SEAL_CENTER_Y)，全寬 SEAL_WORLD_SIZE。 */
function sampleSeal(img: FigureImage, opts: { count: number; seed: number }): Shape {
  const { alpha, width, height } = img;
  const ink: number[] = [];
  for (let i = 0; i < alpha.length; i++) if (alpha[i]! >= OPAQUE) ink.push(i);
  if (ink.length === 0) throw new RangeError('朱印遮罩全透明，沒有墨可取樣');
  const unit = SEAL_WORLD_SIZE / width;
  const random = rng(opts.seed);
  const positions = new Float32Array(opts.count * 3);
  const kinds = new Uint8Array(opts.count).fill(KIND.SEAL);
  for (let i = 0; i < opts.count; i++) {
    const pixel = ink[Math.floor(random() * ink.length)]!;
    const px = (pixel % width) + random();
    const py = Math.floor(pixel / width) + random();
    positions[i * 3] = (px - width / 2) * unit;
    positions[i * 3 + 1] = SEAL_CENTER_Y + (height / 2 - py) * unit;
    positions[i * 3 + 2] = (random() * 2 - 1) * SEAL_HALF_DEPTH;
  }
  return withBounds(positions, kinds);
}

/**
 * 合成：每個人形照自己的 `figureScale` 取樣，再三軸一起縮 `scale`、平移到 `x`。
 * 第 i 個點取自第 i % n 個人形的第 ⌊i / n⌋ 個取樣——交錯排列，所以任何前綴（載入時依 tier 取前綴）都是四個人形各占 1/n。
 */
function composeFigures(
  id: string,
  parts: Extract<ShapeRecipe, { kind: 'compose' }>['parts'],
  masks: FigureImage[],
  count: number,
): Shape {
  const n = parts.length;
  const land = FIGURES.land!;
  const per = Math.ceil(count / n);
  const sampled = parts.map((part, k) =>
    sampleFigure(masks[k]!, figureScale(FIGURES[part.figure]!, land), { count: per, seed: seedOf(`${id}#${k}`) }),
  );
  const positions = new Float32Array(count * 3);
  const kinds = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const k = i % n;
    const j = Math.floor(i / n);
    const { scale, x } = parts[k]!;
    const from = sampled[k]!;
    positions[i * 3] = from.positions[j * 3]! * scale + x;
    positions[i * 3 + 1] = from.positions[j * 3 + 1]! * scale;
    positions[i * 3 + 2] = from.positions[j * 3 + 2]! * scale;
    kinds[i] = from.kinds[j]!;
  }
  return withBounds(positions, kinds);
}

/** 由（已是 Float32 的）座標算外框。 */
function withBounds(positions: Float32Array, kinds: Uint8Array): Shape {
  const count = kinds.length;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i * 3 + a]!;
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
  }
  return { count, positions, kinds, min, max };
}

async function buildShape(root: string, id: string, recipe: ShapeRecipe): Promise<Shape> {
  const count = SHAPE_COUNT;
  switch (recipe.kind) {
    case 'figure': {
      const def = FIGURES[recipe.figure];
      if (!def) throw new Error(`形體 ${id} 的配方引用了不存在的人形 ${recipe.figure}`);
      const mask = await loadMask(root, silhouetteFile(id, recipe.figure));
      return sampleFigure(mask, figureScale(def, FIGURES.land!), { count, seed: seedOf(id) });
    }
    case 'weapon': {
      const snapshot = decodeSnapshot(new Uint8Array(readFileSync(join(root, `src/qi/data/weapons/${recipe.name}.geo`))));
      if (snapshot.name !== recipe.name) throw new Error(`形體 ${id}：快照內的兵器名稱是 ${snapshot.name}，不是 ${recipe.name}`);
      return sampleWeapon(snapshot, { count, seed: seedOf(id) });
    }
    case 'seal':
      return sampleSeal(await loadMask(root, SEAL_MASK), { count, seed: seedOf(id) });
    case 'compose': {
      const masks = await Promise.all(recipe.parts.map((part) => loadMask(root, silhouetteFile(id, part.figure))));
      return composeFigures(id, recipe.parts, masks, count);
    }
  }
}

export async function buildAllShapes(opts: { root: string; outDir: string; force?: boolean }): Promise<{ built: string[]; skipped: boolean }> {
  const { root, outDir } = opts;
  const ids = Object.keys(SHAPES);
  const inputsHash = hashInputs(root, allInputs(root), `qsh${SHAPE_FORMAT_VERSION}:${SHAPE_COUNT}`);
  const hashFile = join(outDir, HASH_FILE);

  const upToDate =
    !opts.force &&
    existsSync(hashFile) &&
    readFileSync(hashFile, 'utf8').trim() === inputsHash &&
    existsSync(join(outDir, MANIFEST)) &&
    ids.every((id) => existsSync(join(outDir, `${id}.bin`)));
  if (upToDate) return { built: [], skipped: true };

  mkdirSync(outDir, { recursive: true });
  // 先拿掉舊雜湊：建到一半被中斷時，下一次一定重建，不會把半成品當成「輸入沒變」
  rmSync(hashFile, { force: true });

  const manifest: { id: string; bytes: number; sha256: string }[] = [];
  for (const id of ids) {
    const bytes = encodeShape(await buildShape(root, id, SHAPES[id]!));
    writeFileSync(join(outDir, `${id}.bin`), bytes);
    manifest.push({ id, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  // 改名或移除的形體不留殘檔：執行時用 glob 收 `*.bin`，殘檔會被一起打進 dist
  const known = new Set(ids.map((id) => `${id}.bin`));
  for (const name of readdirSync(outDir)) if (name.endsWith('.bin') && !known.has(name)) rmSync(join(outDir, name));

  writeFileSync(join(outDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(hashFile, `${inputsHash}\n`);
  return { built: ids, skipped: false };
}
