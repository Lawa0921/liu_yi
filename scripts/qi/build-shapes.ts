/**
 * 形體產線（D10、D11）：依 `src/qi/config/shapes.ts` 的配方，在建置時把每個形體取樣成 `<id>.bin`（v1，固定 16 384 點），
 * 另寫 `shapes.json`（`[{ id, bytes, sha256 }]`）與 `.inputs-hash`。輸出在 `src/assets/generated/qi/shapes/`（已忽略，不進 git）。
 *
 * 輸入雜湊 = 配方用到的剪影 PNG、朱印遮罩 PNG、館徽圖 PNG、兵器 `.geo` 快照（竹簡是程序化的，沒有輸入檔），加上 `config/{figures,shapes}.ts`、`shapes/*.ts`、
 * 本腳本與 `hash.ts`、`staged-output.ts` 的原始碼，以及形體檔格式版本。雜湊沒變、檔案齊全就跳過（不重寫任何檔）。
 * 本腳本自己也進雜湊：朱印取樣、合成排列的邏輯寫在這裡，改了它產物就該重建。
 * 「檔案齊全」包含大小：每個 `.bin` 必須恰為 `shapeFileBytes(SHAPE_COUNT)`，被截斷的檔會觸發重建。
 *
 * 寫檔紀律（失敗不留半套產物、錯誤帶形體 id）：建置階段任何一個形體失敗，錯誤訊息帶形體 id（`形體 kao：…`，原始錯誤在 `cause`）；
 * 其餘的「先建到 .staging、全部成功才換入、清單最後換入、殘檔清除」由 `staged-output.ts` 的 `commitStaged` 負責（與靜態圖共用）。
 *
 * 只用 Node 與入庫的檔案（CI 沒有 Python、字型原檔，也不 import `weapons.ts`：兵器取樣吃 `.geo` 快照，見 D29）。
 * 固定種子（由形體 id 雜湊而來）＋純函式取樣：同輸入逐位元相同。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { FIGURES, figureScale } from '../../src/qi/config/figures';
import { GATE_SCALE, GATE_SILHOUETTE, SEAL_CENTER_Y, SEAL_WORLD_SIZE, SHAPES, type ShapeRecipe } from '../../src/qi/config/shapes';
import { sampleCrest } from '../../src/qi/shapes/sample-crest';
import { sampleScroll } from '../../src/qi/shapes/sample-scroll';
import { encodeShape, KIND, SHAPE_COUNT, SHAPE_FORMAT_VERSION, shapeFileBytes, type Shape } from '../../src/qi/shapes/format';
import { OPAQUE } from '../../src/qi/shapes/head';
import { rng } from '../../src/qi/shapes/rng';
import { sampleFigure, type FigureImage } from '../../src/qi/shapes/sample-figure';
import { sampleWeapon } from '../../src/qi/shapes/sample-weapon';
import { decodeSnapshot } from '../../src/qi/shapes/weapon-snapshot';
import { hashInputs, listFiles, sha256 } from './hash';
import { commitStaged, hashMatches, sizeOf } from './staged-output';

const SEAL_MASK = 'src/assets/seal/seal-liuyi.png';
/** 光點館徽的取樣來源：Task 24 的透明底金色館徽（`npm run crest:build` 由 logo_large.jpg 轉出）。 */
const CREST_IMAGE = 'src/assets/images/crest-lion.png';
/** 朱印的深度：z 在 ±這個值內（人形約 ±0.3，印是薄薄一片）。 */
const SEAL_HALF_DEPTH = 0.02;
/** 院門的取樣來源（Task 26）：既有的剪影，不經 `FIGURES`（它不是人形）。 */
const GATE_IMAGE = `src/assets/silhouettes/${GATE_SILHOUETTE}.png`;
const MANIFEST = 'shapes.json';

/** 配方引用的人形：剪影檔與比例。查 `FIGURES` 與算 `figureScale`（頭部對齊或 scaleOverride）只在這裡做一次。 */
function resolveFigure(figure: string): { file: string; scale: number } {
  const def = FIGURES[figure];
  if (!def) throw new Error(`配方引用了不存在的人形 ${figure}（FIGURES 沒有這個鍵）`);
  return { file: `src/assets/silhouettes/${def.src}.png`, scale: figureScale(def, FIGURES.land!) };
}

/** 失敗訊息一律帶形體 id（sharp、解碼器丟的錯本身不會說是哪個形體），原始錯誤放在 cause。 */
function failedShape(id: string, cause: unknown): Error {
  return new Error(`形體 ${id}：${cause instanceof Error ? cause.message : String(cause)}`, { cause });
}

/** 這個配方用到的剪影原圖、遮罩或快照（相對專案根目錄）。 */
function recipeInputs(recipe: ShapeRecipe): string[] {
  switch (recipe.kind) {
    case 'figure':
      return [resolveFigure(recipe.figure).file];
    case 'weapon':
      return [`src/qi/data/weapons/${recipe.name}.geo`];
    case 'seal':
      return [SEAL_MASK];
    case 'scroll':
      return []; // 程序化：沒有輸入檔，所以不可能帶字
    case 'crest':
      return [CREST_IMAGE];
    case 'gate':
      return [GATE_IMAGE];
    case 'compose':
      return recipe.parts.map((part) => resolveFigure(part.figure).file);
  }
}

/** 全部輸入：配方用到的素材＋影響取樣結果的原始碼。 */
function allInputs(root: string): string[] {
  const assets = Object.entries(SHAPES).flatMap(([id, recipe]) => {
    try {
      return recipeInputs(recipe);
    } catch (cause) {
      throw failedShape(id, cause);
    }
  });
  return [
    ...assets,
    'src/qi/config/figures.ts',
    'src/qi/config/shapes.ts',
    ...listFiles(root, 'src/qi/shapes', '.ts'),
    'scripts/qi/build-shapes.ts',
    'scripts/qi/hash.ts',
    'scripts/qi/staged-output.ts',
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
 * 合成：每個人形照自己的比例（`base`＝`figureScale`）取樣，再三軸一起縮 `scale`、平移到 `x`。
 * 第 i 個點取自第 i % n 個人形的第 ⌊i / n⌋ 個取樣——交錯排列，所以任何前綴（載入時依 tier 取前綴）都是四個人形各占 1/n。
 */
function composeFigures(
  id: string,
  parts: Extract<ShapeRecipe, { kind: 'compose' }>['parts'],
  figures: { mask: FigureImage; base: number }[],
  count: number,
): Shape {
  const n = parts.length;
  const per = Math.ceil(count / n);
  const sampled = figures.map(({ mask, base }, k) => sampleFigure(mask, base, { count: per, seed: seedOf(`${id}#${k}`) }));
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
      const { file, scale } = resolveFigure(recipe.figure);
      return sampleFigure(await loadMask(root, file), scale, { count, seed: seedOf(id) });
    }
    case 'weapon': {
      const snapshot = decodeSnapshot(new Uint8Array(readFileSync(join(root, `src/qi/data/weapons/${recipe.name}.geo`))));
      if (snapshot.name !== recipe.name) throw new Error(`快照內的兵器名稱是 ${snapshot.name}，不是 ${recipe.name}`);
      return sampleWeapon(snapshot, { count, seed: seedOf(id) });
    }
    case 'seal':
      return sampleSeal(await loadMask(root, SEAL_MASK), { count, seed: seedOf(id) });
    case 'scroll':
      return sampleScroll({ count, seed: seedOf(id) });
    case 'crest':
      return sampleCrest(await loadMask(root, CREST_IMAGE), { count, seed: seedOf(id) });
    case 'gate':
      return sampleFigure(await loadMask(root, GATE_IMAGE), GATE_SCALE, { count, seed: seedOf(id) });
    case 'compose': {
      const figures = await Promise.all(
        recipe.parts.map(async (part) => {
          const { file, scale } = resolveFigure(part.figure);
          return { mask: await loadMask(root, file), base: scale };
        }),
      );
      return composeFigures(id, recipe.parts, figures, count);
    }
  }
}

export async function buildAllShapes(opts: {
  root: string;
  outDir: string;
  force?: boolean;
  /** 清不掉暫存目錄這類「不影響結果」的問題用它回報；預設 `console.warn`。 */
  warn?: (message: string) => void;
}): Promise<{ built: string[]; skipped: boolean }> {
  const { root, outDir } = opts;
  const warn = opts.warn ?? ((message: string) => console.warn(message));
  const ids = Object.keys(SHAPES);
  const inputsHash = hashInputs(root, allInputs(root), `qsh${SHAPE_FORMAT_VERSION}:${SHAPE_COUNT}`);

  // 跳過＝雜湊相符、shapes.json 在、每個 .bin 都在且大小正確（被截斷的檔不算數）
  const binBytes = shapeFileBytes(SHAPE_COUNT);
  const upToDate =
    !opts.force &&
    hashMatches(outDir, inputsHash) &&
    existsSync(join(outDir, MANIFEST)) &&
    ids.every((id) => sizeOf(join(outDir, `${id}.bin`)) === binBytes);
  if (upToDate) return { built: [], skipped: true };

  await commitStaged({
    outDir,
    files: ids.map((id) => `${id}.bin`),
    manifest: MANIFEST,
    hash: inputsHash,
    ext: '.bin',
    warn,
    build: async (staging) => {
      const manifest: { id: string; bytes: number; sha256: string }[] = [];
      for (const id of ids) {
        let bytes: Uint8Array;
        try {
          bytes = encodeShape(await buildShape(root, id, SHAPES[id]!));
        } catch (cause) {
          throw failedShape(id, cause);
        }
        writeFileSync(join(staging, `${id}.bin`), bytes);
        manifest.push({ id, bytes: bytes.byteLength, sha256: sha256(bytes) });
      }
      writeFileSync(join(staging, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    },
  });
  return { built: ids, skipped: false };
}
