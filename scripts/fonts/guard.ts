import { readFile } from 'node:fs/promises';
import { assertHasHtml, missingChars, parseCharList, scanDist } from './charset';

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

export async function checkDist(opts: { distDir: string; charsetFile: string; allowedFile?: string }): Promise<GuardResult> {
  const { distDir, charsetFile, allowedFile } = opts;

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

  const subset = parseCharList(charsetText);
  const allowed = parseCharList(await readOptional(allowedFile));
  const missing = missingChars(scan.chars, subset, allowed);

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
