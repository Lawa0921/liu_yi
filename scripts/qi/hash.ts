/**
 * 建置產物的「輸入雜湊」：把一組輸入檔（與一段版本字串）折成一個 sha256，雜湊沒變就不必重建（D11）。
 * 形體（`build-shapes.ts`）用它，靜態圖（Task 12）也用它。只讀檔，不依賴 Astro。
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `root/dir` 底下副檔名為 `ext` 的檔案（只看這一層）；回傳相對 root、用正斜線、排序過的路徑。目錄不存在就丟錯。 */
export function listFiles(root: string, dir: string, ext: string): string[] {
  return readdirSync(join(root, dir))
    .filter((name) => name.endsWith(ext))
    .sort()
    .map((name) => `${dir}/${name}`);
}

/**
 * 以「相對路徑＋檔案內容的 sha256」依路徑排序後折成一個雜湊；`salt` 是不在檔案裡的版本字串（例如格式版本）。
 * 路徑一律是相對 `root` 的正斜線，所以同樣的內容在不同機器、不同根目錄下雜湊相同。
 * 任何一個檔不存在就丟錯（訊息帶相對路徑）：少了輸入不能默默算出一個「看起來正常」的雜湊。
 */
export function hashInputs(root: string, files: readonly string[], salt = ''): string {
  const unique = [...new Set(files)].sort();
  const hash = createHash('sha256');
  hash.update(`salt:${salt}\n`);
  for (const rel of unique) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(root, rel));
    } catch (cause) {
      throw new Error(`輸入雜湊：讀不到輸入檔 ${rel}（根目錄 ${root}）`, { cause });
    }
    hash.update(`${rel}\0${sha256(bytes)}\n`);
  }
  return hash.digest('hex');
}
