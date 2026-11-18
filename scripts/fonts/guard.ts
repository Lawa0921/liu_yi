import { readFile } from 'node:fs/promises';
import { assertHasHtml, missingChars, parseCharList, scanDist } from './charset';
import { splitCharset } from './split';

/**
 * 建置字型守門：掃 `distDir` 的用字，任何字不在子集（`charsetFile`）、也沒列入 `allowedFile` 就算缺字。
 * 純讀檔、不依賴 Astro，所以單元測試可以直接餵暫存資料夾。`integrations/twkai-guard.ts` 在 `astro:build:done` 呼叫它。
 */

export interface GuardResult {
  ok: boolean;
  /** 缺字，依碼位排序。 */
  missing: string[];
  /** 缺字 → 出現的檔案（相對 `distDir`、以 `/` 分隔，依字串順序）。 */
  pages: Record<string, string[]>;
}

const FIX_HINT = '請執行 npm run fonts:subset';

async function readOptional(path: string | undefined): Promise<string> {
  if (path === undefined) return '';
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export async function checkDist(opts: {
  distDir: string;
  charsetFile: string;
  /** 延伸子集的字集檔（`twkai-extra.chars.txt`）；不存在視為空。 */
  extraCharsetFile?: string;
  allowedFile?: string;
}): Promise<GuardResult> {
  const { distDir, charsetFile, extraCharsetFile, allowedFile } = opts;

  let charsetText: string;
  try {
    charsetText = await readFile(charsetFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`找不到子集字集檔 ${charsetFile}：${FIX_HINT}`, { cause: error });
    }
    throw error;
  }

  const scan = await scanDist(distDir);
  assertHasHtml(scan, distDir);
  // 有 .html 卻掃不到任何字，代表掃描壞了或頁面是空殼：不能把「沒有用字」當成「沒有缺字」而報綠燈（`fonts:subset` 有同樣的防線）
  if (scan.chars.size === 0) throw new Error(`掃描 ${distDir} 得到 0 個字，無法判斷缺字：請確認建置有產出頁面內容`);

  const core = parseCharList(charsetText);
  const subset = new Set([...core, ...parseCharList(await readOptional(extraCharsetFile))]);
  const allowed = parseCharList(await readOptional(allowedFile));
  // 首頁與共用 JS／CSS 的字必須在核心：只在延伸字集的話，首頁會多下載整份延伸檔（split.ts 的拆法）
  const { core: needsCore, extra: otherPagesOnly } = splitCharset(scan.chars, scan.where);
  const missing = [
    ...new Set([...missingChars(needsCore, core, allowed), ...missingChars(otherPagesOnly, subset, allowed)]),
  ].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);

  const pages: Record<string, string[]> = {};
  for (const ch of missing) pages[ch] = scan.where.get(ch) ?? [];
  return { ok: missing.length === 0, missing, pages };
}

const MAX_PAGES_SHOWN = 5;

const codePointLabel = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

/** 缺字報告：每個字一行（含碼位與出現的檔案），最後附上修正指令。 */
export function formatMissing(result: GuardResult): string {
  const lines = [`TW-Kai 子集缺 ${result.missing.length} 個字，這些字會退回後備字型：`];
  for (const ch of result.missing) {
    const pages = result.pages[ch] ?? [];
    const shown = pages.slice(0, MAX_PAGES_SHOWN).join('、');
    const more = pages.length > MAX_PAGES_SHOWN ? `…共 ${pages.length} 個檔案` : '';
    lines.push(`  ${ch}  ${codePointLabel(ch)}  出現於 ${shown}${more}`);
  }
  lines.push(`${FIX_HINT}（TW-Kai 本身沒有的字，改文案，或確認可用後備字型呈現後列入 scripts/fonts/fallback-allowed.txt）`);
  return lines.join('\n');
}
