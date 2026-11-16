import type { AstroIntegration } from 'astro';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDist, formatMissing } from '../scripts/fonts/guard';

/**
 * 建置字型守門：`astro:build:done` 掃建置產物的用字，有字不在 TW-Kai 子集就讓建置失敗（訊息列出缺字與出現的檔案）。
 * 子集是入庫的 `src/assets/fonts/twkai-subset.woff2`，用字清單是 `twkai-subset.chars.txt`；新增文案後要跑 `npm run fonts:subset`。
 * 環境變數 `TWKAI_GUARD=warn` 時只印警告（`fonts:subset` 自己建置時用它：缺字正是接下來要補進子集的東西）。
 */

export interface TwkaiGuardOptions {
  /** 子集內的字（`twkai-subset.chars.txt`）；預設是專案根目錄下的 `src/assets/fonts/twkai-subset.chars.txt`。 */
  charsetFile?: string;
  /** 允許退回後備字型的字；預設是專案根目錄下的 `scripts/fonts/fallback-allowed.txt`（不存在視為空）。 */
  allowedFile?: string;
  /** 測試用：預設是 `process.env`。 */
  env?: Record<string, string | undefined>;
}

export function twkaiGuard(options: TwkaiGuardOptions = {}): AstroIntegration {
  let root = process.cwd();
  return {
    name: 'twkai-guard',
    hooks: {
      'astro:config:done': ({ config }) => {
        root = fileURLToPath(config.root);
      },
      'astro:build:done': async ({ dir, logger }) => {
        const env = options.env ?? process.env;
        const result = await checkDist({
          distDir: fileURLToPath(dir),
          charsetFile: options.charsetFile ?? join(root, 'src', 'assets', 'fonts', 'twkai-subset.chars.txt'),
          allowedFile: options.allowedFile ?? join(root, 'scripts', 'fonts', 'fallback-allowed.txt'),
        });
        if (result.ok) return;
        if (env.TWKAI_GUARD === 'warn') {
          logger.warn(formatMissing(result));
          return;
        }
        throw new Error(formatMissing(result));
      },
    },
  };
}
