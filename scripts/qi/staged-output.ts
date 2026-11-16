/**
 * 「暫存再換入」：建置產物（形體 `.bin`、靜態圖 `.webp`）共用的寫檔紀律。`build-shapes.ts` 與 `render-stills.ts` 都用它，
 * 兩邊的失敗語意因此一致；故障注入情境集中在 `tests/unit/qi-staged-output.test.ts`。
 *
 * 失敗不留看起來完整的產物（不會有新舊混雜、卻帶著「輸入沒變」標記的輸出目錄）：
 *   - 開始就刪 `.inputs-hash`：之後不管在哪一步失敗或被中斷，下一次一定重建；
 *   - 全部先建到 `outDir/.staging/`（`build` 的工作）。建置階段任何一步失敗，錯誤原樣丟出，正式位置維持上一次完整的產物
 *     （檔案與清單彼此相符，只是沒有 `.inputs-hash`，下一次會重建）；
 *   - `build` 交出的暫存目錄要有 `files` 全部與清單，缺任何一個就在換入前丟錯，正式位置一個檔都不動；
 *   - 都成功之後才換入正式位置，換入前先刪清單：換入途中失敗（例如某個檔被別的程式鎖住）時，檔案可能新舊混雜，
 *     但目錄裡既沒有清單也沒有 `.inputs-hash`，一看就知道不完整，下一次整批重建；
 *   - 清單最後才換入，雜湊在最後才寫；
 *   - 改名或移除的產物不留殘檔（執行時用 glob 收同副檔名的檔案，殘檔會被一起打進 dist）；
 *   - `.staging` 的清理是盡力而為：清不掉只發警告，不讓成功的建置變失敗，也不蓋掉建置本身的錯誤。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 輸入雜湊檔：只有「全部換入成功」才會有它。 */
export const HASH_FILE = '.inputs-hash';
/** 建置時先寫到 `outDir/.staging/`，全部成功才換入；失敗就整個丟掉。 */
const STAGING = '.staging';

/** 檔案大小；不存在回 undefined（「檔案齊全」的跳過判斷用它核對沒有被截斷）。 */
export function sizeOf(path: string): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}

/** `outDir` 的輸入雜湊檔存在、且內容（去掉結尾換行）等於 `hash`。 */
export function hashMatches(outDir: string, hash: string): boolean {
  const file = join(outDir, HASH_FILE);
  return existsSync(file) && readFileSync(file, 'utf8').trim() === hash;
}

/** 盡力清掉暫存目錄：失敗（Windows 上被別的程式鎖住等）只警告，下一次建置開始時會再清一次。 */
function discardStaging(staging: string, warn: (message: string) => void): void {
  try {
    rmSync(staging, { recursive: true, force: true, maxRetries: 3 });
  } catch (cause) {
    warn(`清不掉暫存目錄 ${staging}（${cause instanceof Error ? cause.message : String(cause)}），下一次建置會再清一次`);
  }
}

export async function commitStaged(opts: {
  outDir: string;
  /** 要換入的檔名（不含清單）；`build` 必須把它們全部寫進暫存目錄。 */
  files: readonly string[];
  /** 清單檔名（例如 `shapes.json`）；`build` 也要寫進暫存目錄，最後才換入。 */
  manifest: string;
  /** 輸入雜湊：全部換入之後才寫進 `outDir/.inputs-hash`。 */
  hash: string;
  /** 殘檔判定的副檔名（例如 `.bin`）：`outDir` 內不在 `files` 裡的同副檔名檔案會被清掉。 */
  ext: string;
  /** 把 `files` 與清單建進 `staging`（建置階段）；丟出的錯誤原樣往外丟。 */
  build: (staging: string) => Promise<void>;
  /** 清不掉暫存目錄這類「不影響結果」的問題用它回報。 */
  warn: (message: string) => void;
}): Promise<void> {
  const { outDir, files, manifest, hash, ext, build, warn } = opts;
  mkdirSync(outDir, { recursive: true });
  // 先拿掉舊雜湊：之後不管在哪一步失敗或被中斷，下一次一定重建，不會把半成品當成「輸入沒變」
  rmSync(join(outDir, HASH_FILE), { force: true });

  const staging = join(outDir, STAGING);
  discardStaging(staging, warn);
  mkdirSync(staging, { recursive: true });
  try {
    await build(staging);
    for (const name of [...files, manifest]) {
      if (!existsSync(join(staging, name))) throw new Error(`建置沒有產出 ${name}（暫存目錄 ${staging}）`);
    }

    // 換入（同一個檔案系統內的 rename）。先刪清單：換入到一半失敗時檔案可能新舊混雜，
    // 但目錄裡既沒有清單也沒有 .inputs-hash，一看就是不完整，下一次整批重建。
    rmSync(join(outDir, manifest), { force: true });
    for (const name of files) renameSync(join(staging, name), join(outDir, name));
    renameSync(join(staging, manifest), join(outDir, manifest));
    // 改名或移除的產物不留殘檔
    const known = new Set(files);
    for (const name of readdirSync(outDir)) if (name.endsWith(ext) && !known.has(name)) rmSync(join(outDir, name));
    writeFileSync(join(outDir, HASH_FILE), `${hash}\n`);
  } finally {
    discardStaging(staging, warn);
  }
}
