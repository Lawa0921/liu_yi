import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveDeployTarget } from '../../deploy-target.mjs';
import { SITE } from '../../src/lib/site';
import { assertHasHtml, parseCharList, scanDist, toCharsetText } from './charset';
import { ensureSourceFont } from './source';
import { splitCharset } from './split';
import { buildSubset } from './subset';

/**
 * `npm run fonts:subset [-- --from-dir <dist>]`：開發者本機指令，CI 與一般建置都不會跑。
 * 下載（或用快取的）TW-Kai 原檔 → 建置站台並掃用字 → 子集化 → 寫 `twkai-subset.woff2` 與 `twkai-subset.chars.txt`（核心：首頁與共用 JS／CSS 的字），
 * 以及 `twkai-extra.woff2` 與 `twkai-extra.chars.txt`（延伸：只出現在其他頁面的字；沒有就刪掉這兩個檔）。拆法見 `split.ts`。
 * 不在 TW-Kai 內、也沒列入 `fallback-allowed.txt` 的字會讓指令以 1 結束（檔案仍會寫出）。
 */

const SUBSET_FILE = 'src/assets/fonts/twkai-subset.woff2';
const CHARS_FILE = 'src/assets/fonts/twkai-subset.chars.txt';
const EXTRA_SUBSET_FILE = 'src/assets/fonts/twkai-extra.woff2';
const EXTRA_CHARS_FILE = 'src/assets/fonts/twkai-extra.chars.txt';
const FALLBACK_FILE = 'scripts/fonts/fallback-allowed.txt';

export function parseArgs(argv: string[]): { fromDir?: string } {
  const args: { fromDir?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--from-dir') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error('--from-dir 需要接一個資料夾路徑');
      args.fromDir = value;
      i++;
    } else {
      throw new Error(`不認得的參數 ${arg}。用法：npm run fonts:subset [-- --from-dir <dist>]`);
    }
  }
  return args;
}

export interface RunOptions {
  /** repo 根目錄。 */
  root: string;
  /** 略過建置，直接掃這個資料夾。 */
  fromDir?: string;
  env?: Record<string, string | undefined>;
  /** 測試用：取得原檔路徑，預設是 `ensureSourceFont`。 */
  ensureFont?: (cacheDir: string) => Promise<string>;
  /** 測試用：建置站台，預設是 `astro build`。收到的 env 已帶 `TWKAI_GUARD=warn`。 */
  build?: (env: Record<string, string | undefined>) => Promise<void>;
  log?: (line: string) => void;
}

function runAstroBuild(root: string, env: Record<string, string | undefined>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const astro = join(root, 'node_modules', 'astro', 'bin', 'astro.mjs');
    const child = spawn(process.execPath, [astro, 'build'], { cwd: root, env: env as NodeJS.ProcessEnv, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`astro build 失敗（${signal ?? `exit ${code}`}）`));
    });
  });
}

async function readIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

/** 暫時版的字：可見 ASCII 與站名。只用來讓第一次建置有字型檔可以引用。 */
function provisionalChars(): Set<string> {
  const chars = new Set<string>();
  for (let code = 0x21; code <= 0x7e; code++) chars.add(String.fromCharCode(code));
  for (const ch of SITE.name) chars.add(ch);
  return chars;
}

const codePointLabel = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

export async function runSubset(opts: RunOptions): Promise<number> {
  const { root, fromDir, env = process.env, log = console.log } = opts;
  const ensureFont = opts.ensureFont ?? ((cacheDir: string) => ensureSourceFont({ cacheDir }));
  const build = opts.build ?? ((buildEnv: Record<string, string | undefined>) => runAstroBuild(root, buildEnv));
  const subsetPath = join(root, SUBSET_FILE);
  const charsPath = join(root, CHARS_FILE);

  const ttf = await readFile(await ensureFont(join(root, '.cache', 'fonts')));

  /** 子集化並寫出兩個檔；chars.txt 只記「確實進了子集」的字。 */
  const writeSubset = async (chars: Set<string>, woff2Path = subsetPath, charsFilePath = charsPath) => {
    const { woff2, notInFont } = await buildSubset(ttf, chars);
    const missing = new Set(notInFont);
    const inSubset = new Set([...chars].filter((ch) => !missing.has(ch)));
    await mkdir(join(woff2Path, '..'), { recursive: true });
    await writeFile(woff2Path, woff2);
    await writeFile(charsFilePath, `${toCharsetText(inSubset)}\n`);
    return { woff2, notInFont, inSubset };
  };

  let scanDir: string;
  if (fromDir) {
    scanDir = resolve(fromDir);
  } else {
    if (!existsSync(subsetPath)) {
      log(`找不到 ${SUBSET_FILE}，先以 ASCII 與站名產生暫時版，讓第一次建置有字型可引用`);
      await writeSubset(provisionalChars());
    }
    // 建置本身的字型守門在這裡只警告：缺字正是接下來要補進子集的東西
    await build({ ...env, TWKAI_GUARD: 'warn' });
    scanDir = resolve(root, resolveDeployTarget(env).outDir);
  }

  const scan = await scanDist(scanDir);
  const { chars, where } = scan;
  const shownDir = relative(root, scanDir);
  const shownName = shownDir === '' ? '.' : shownDir.startsWith('..') ? scanDir : shownDir;
  // 掃不到東西時直接報錯：不能拿空字集覆寫既有的子集
  assertHasHtml(scan, shownName);
  if (chars.size === 0) throw new Error(`掃描 ${shownName} 得到 0 個字，不覆寫現有的子集：請確認建置有產出頁面內容`);

  const { core, extra } = splitCharset(chars, where);
  const coreResult = await writeSubset(core);
  const extraWoff2Path = join(root, EXTRA_SUBSET_FILE);
  const extraCharsPath = join(root, EXTRA_CHARS_FILE);
  let extraResult: Awaited<ReturnType<typeof writeSubset>> | undefined;
  if (extra.size > 0) {
    extraResult = await writeSubset(extra, extraWoff2Path, extraCharsPath);
  } else {
    await rm(extraWoff2Path, { force: true });
    await rm(extraCharsPath, { force: true });
  }
  const woff2 = coreResult.woff2;
  const notInFont = [...coreResult.notInFont, ...(extraResult?.notInFont ?? [])].sort(
    (a, b) => a.codePointAt(0)! - b.codePointAt(0)!,
  );

  const allowed = parseCharList(await readIfExists(join(root, FALLBACK_FILE)));
  const unresolved = notInFont.filter((ch) => !allowed.has(ch));
  const tolerated = notInFont.filter((ch) => allowed.has(ch));

  log(`掃描 ${shownName}`);
  log(`字數：${chars.size - notInFont.length}（掃到 ${chars.size}，其中 ${notInFont.length} 個不在 TW-Kai 內）`);
  log(`大小：${woff2.byteLength} bytes（${(woff2.byteLength / 1024).toFixed(1)} KB）→ ${SUBSET_FILE}（核心 ${coreResult.inSubset.size} 字）`);
  if (extraResult) {
    const bytes = extraResult.woff2.byteLength;
    log(`延伸：${bytes} bytes（${(bytes / 1024).toFixed(1)} KB）→ ${EXTRA_SUBSET_FILE}（${extraResult.inSubset.size} 字，只有用到的頁面才下載）`);
  } else {
    log(`延伸：沒有只出現在其他頁面的字，不產生 ${EXTRA_SUBSET_FILE}`);
  }
  if (tolerated.length > 0) {
    log(`允許退回其他字型（${FALLBACK_FILE}）：${tolerated.join('')}`);
  }
  if (unresolved.length > 0) {
    log(`不在 TW-Kai 內的字（${unresolved.length}）：`);
    for (const ch of unresolved) {
      log(`  ${ch}  ${codePointLabel(ch)}  出現於 ${(where.get(ch) ?? []).slice(0, 5).join('、')}`);
    }
    log(`請改文案，或確認該字可用其他字型呈現後列入 ${FALLBACK_FILE}`);
    return 1;
  }
  return 0;
}

async function main(): Promise<void> {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  process.exitCode = await runSubset({ root, ...parseArgs(process.argv.slice(2)) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
