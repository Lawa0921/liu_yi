import type { AstroIntegration } from 'astro';

/**
 * 引擎 e2e 專用的 harness 頁（`tests/harness/qi-harness.astro`）：只有環境變數 `QI_HARNESS=1` 的測試建置才註冊這條路由
 * （`npm run build:harness`，輸出到 `dist-harness`，由 playwright 的 `engine` project 服務）。一般建置與部署都不會有這一頁，
 * 檔案也不在 `src/pages` 底下，所以不會被當成正式頁面；sitemap 另外排除 `/__test/`。
 */

/** harness 頁的網址路徑（不含 base）。`astro.config.mjs` 的 sitemap 篩選與 e2e 的網址都引用它。 */
export const QI_HARNESS_PATH = '/__test/qi-harness';

export interface QiHarnessOptions {
  /** 測試用：預設是 `process.env`。 */
  env?: Record<string, string | undefined>;
}

export function qiHarness(options: QiHarnessOptions = {}): AstroIntegration {
  return {
    name: 'qi-harness',
    hooks: {
      'astro:config:setup': ({ injectRoute, logger }) => {
        const env = options.env ?? process.env;
        if (env.QI_HARNESS !== '1') return;
        injectRoute({ pattern: QI_HARNESS_PATH, entrypoint: './tests/harness/qi-harness.astro' });
        logger.warn(`QI_HARNESS=1：已加入測試專用頁 ${QI_HARNESS_PATH}/（只給 e2e 用，不得部署這份建置）`);
      },
    },
  };
}
