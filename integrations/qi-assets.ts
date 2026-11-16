import type { AstroIntegration } from 'astro';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAllShapes } from '../scripts/qi/build-shapes';

/**
 * 「氣」首頁的建置時素材（D11）：形體檔 `.bin` 是建置產物，不進 git，輸出在 `src/assets/generated/qi/shapes/`（已忽略）。
 * 在 `astro:config:setup` 產生，這時 Vite 還沒開始掃專案，之後 `import.meta.glob` 才找得到檔；輸入雜湊不變就跳過。
 * 只用 Node 與入庫的檔案，CI 不需要 Python 或字型原檔。不註冊 dev watch：改了取樣程式或剪影，重啟 dev 或 build 才會重做。
 */
export function qiAssets(): AstroIntegration {
  return {
    name: 'qi-assets',
    hooks: {
      'astro:config:setup': async ({ config, logger }) => {
        const root = fileURLToPath(config.root);
        const { built, skipped } = await buildAllShapes({ root, outDir: join(root, 'src', 'assets', 'generated', 'qi', 'shapes') });
        logger.info(skipped ? '形體檔輸入未變，沿用既有產物' : `已產生 ${built.length} 個形體檔`);
      },
    },
  };
}
