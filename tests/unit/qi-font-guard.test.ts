import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { charsFromJs } from '../../scripts/fonts/charset';

/**
 * 字型守門（D3）會掃建置產物裡所有 JS 的 CJK 字串，每個字都要在 TW-Kai 子集內。
 * `src/qi/` 的引擎、形體、設定模組會被打進首頁的引擎 chunk，所以它們的程式碼（錯誤訊息、著色器字串等）不得含 CJK；
 * 註解在轉譯時會移除，仍可寫中文。
 *
 * 檔案清單用目錄 glob 取得（遞迴、含 `engine/shaders/`），新增檔案自動納入，不必回來改這份測試。
 * 轉譯成 JS（移除註解）後，用守門本身的 `charsFromJs` 掃，與建置守門同一把尺。
 *
 * 唯一的例外是「只在 Node 建置腳本跑」的取樣模組（錯誤訊息是中文）：它們不得被 `src/` 內任何檔案 import，
 * 所以不會進瀏覽器的 chunk。清單是死的、有理由的，而且是雙向守住的：被 `src/` import 會紅燈、
 * 不再含 CJK 了（已改英文）也會紅燈，提醒把它移出清單。
 */
const root = fileURLToPath(new URL('../../', import.meta.url));
const DIRS = ['src/qi/engine', 'src/qi/shapes', 'src/qi/config'];

/** 只給 `scripts/qi/*` 的 Node 建置腳本與單元測試用的取樣模組。 */
const NODE_ONLY = [
  'src/qi/shapes/head.ts',
  'src/qi/shapes/sample-figure.ts',
  'src/qi/shapes/sample-weapon.ts',
  'src/qi/shapes/weapon-snapshot.ts',
];

const posix = (path: string): string => path.split(sep).join('/');

function filesUnder(dir: string, accept: (name: string) => boolean): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = posix(join(dir, entry.name));
    if (entry.isDirectory()) return filesUnder(path, accept);
    return accept(entry.name) ? [path] : [];
  });
}

const isTs = (name: string): boolean => name.endsWith('.ts') && !name.endsWith('.d.ts');
const FILES = DIRS.flatMap((dir) => filesUnder(dir, isTs)).sort();

/** 轉譯成 JS（移除註解）後取出會被字型守門掃到的 CJK 字。 */
function cjkInCode(file: string): string[] {
  const source = readFileSync(join(root, file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText;
  return [...charsFromJs(js)];
}

describe('src/qi：程式碼字串不含 CJK（D3 字型守門）', () => {
  it('目錄 glob 找得到檔案（防止路徑改名後測試變成空轉），含遞迴的子目錄', () => {
    for (const dir of DIRS) expect(FILES.filter((f) => f.startsWith(`${dir}/`)).length, dir).toBeGreaterThan(0);
    for (const file of ['src/qi/shapes/loader.ts', 'src/qi/shapes/expand.ts', 'src/qi/engine/tiers.ts', 'src/qi/config/poses.ts']) {
      expect(FILES, file).toContain(file);
    }
  });

  it.each(FILES.filter((f) => !NODE_ONLY.includes(f)))('%s', (file) => {
    expect(cjkInCode(file), file).toEqual([]);
  });
});

describe('src/qi：Node 專用取樣模組不進瀏覽器的 chunk', () => {
  it.each(NODE_ONLY)('%s 存在、仍含中文字串（否則請移出 NODE_ONLY 讓上面的掃描涵蓋它）', (file) => {
    expect(FILES).toContain(file);
    expect(cjkInCode(file).length).toBeGreaterThan(0);
  });

  it('src/ 內沒有任何檔案 import 它們', () => {
    const targets = new Set(NODE_ONLY.map((file) => resolve(root, file.replace(/\.ts$/, ''))));
    const importers = filesUnder('src', (name) => /\.(ts|js|mjs|astro)$/.test(name)).filter((f) => !NODE_ONLY.includes(f));
    const offenders: string[] = [];
    for (const file of importers) {
      const source = readFileSync(join(root, file), 'utf8');
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const resolved = resolve(dirname(join(root, file)), match[1]!.replace(/\.(ts|js)$/, ''));
        if (targets.has(resolved)) offenders.push(`${file} → ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
