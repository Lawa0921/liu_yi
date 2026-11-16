import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

/**
 * 全字庫正楷體 TW-Kai（BMP 字面）的來源。
 * 原檔約 37 MB、不進 git；只有開發者本機的 `npm run fonts:subset` 會下載，CI 與建置都不需要。
 * `sha256` 是 zip 內 `TW-Kai.ttf` 解出後的雜湊（不是 zip 本身）。
 */
export const TWKAI_SOURCE: {
  zipUrl: string;
  entry: 'TW-Kai.ttf';
  sha256: string;
  bytes: 36691296;
  version: '11510.1';
} = {
  zipUrl: 'https://data.cns11643.gov.tw/opendata/Fonts_Kai.zip',
  entry: 'TW-Kai.ttf',
  sha256: '9b502e5197d52a946552bef100b9a3d601befcf896fb2b64f28f862314bea337',
  bytes: 36691296,
  version: '11510.1',
};

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** 只展開 zip 內名稱完全相符的那一個檔（zip 約 57 MB，其餘字型不展開）。找不到就丟錯。 */
export function extractEntry(zip: Uint8Array, entry: string): Uint8Array {
  const files = unzipSync(zip, { filter: (file) => file.name === entry });
  const data = files[entry];
  if (!data) throw new Error(`zip 內找不到 ${entry}`);
  return data;
}

async function readIfExists(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * 確保 `cacheDir` 內有通過 sha256 驗證的 TTF，回傳其路徑。
 * - 快取命中且雜湊相符：不下載。
 * - 快取已被竄改：刪除後重新下載。
 * - 下載內容雜湊不符：丟錯，且不在 `cacheDir` 留下任何檔。
 * 寫入先落在暫存檔，驗證通過才 rename 進快取，所以快取路徑上永遠只會看到完整且已驗證的檔。
 */
export async function ensureSourceFont(opts: {
  cacheDir: string;
  fetch?: typeof fetch;
  source?: Pick<typeof TWKAI_SOURCE, 'zipUrl' | 'entry' | 'sha256'>;
}): Promise<string> {
  const { cacheDir, fetch: doFetch = fetch, source = TWKAI_SOURCE } = opts;
  const target = join(cacheDir, source.entry);
  await mkdir(cacheDir, { recursive: true });

  const cached = await readIfExists(target);
  if (cached) {
    if (sha256Hex(cached) === source.sha256) return target;
    await rm(target, { force: true });
  }

  const response = await doFetch(source.zipUrl);
  if (!response.ok) {
    throw new Error(`下載 ${source.zipUrl} 失敗：HTTP ${response.status} ${response.statusText}`.trimEnd());
  }
  const font = extractEntry(new Uint8Array(await response.arrayBuffer()), source.entry);

  const actual = sha256Hex(font);
  if (actual !== source.sha256) {
    throw new Error(`${source.entry} 的 sha256 不符：預期 ${source.sha256}，實際下載為 ${actual}`);
  }

  const temp = `${target}.${process.pid}.download`;
  try {
    await writeFile(temp, font);
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
  return target;
}
