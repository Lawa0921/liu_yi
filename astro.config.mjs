// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { resolveDeployTarget } from './deploy-target.mjs';
import { twkaiGuard } from './integrations/twkai-guard.ts';
import { qiAssets } from './integrations/qi-assets.ts';
import { QI_HARNESS_PATH, qiHarness } from './integrations/qi-harness.ts';
import { charsetUnicodeRange } from './scripts/fonts/ranges.mjs';

// site／base／outDir 的預設值與環境變數覆寫都在 deploy-target.mjs。
const { site, base, outDir } = resolveDeployTarget(process.env);

// TW-Kai 分成兩份子集（scripts/fonts/split.ts）：核心（首頁與共用 JS／CSS 的字）與延伸（只出現在其他頁面的字）。
// 兩份用 unicode-range 區隔，瀏覽器只在頁面出現延伸字時才下載延伸檔；首頁只 preload 核心檔（BaseLayout.astro）。
const TWKAI_CORE_RANGE = charsetUnicodeRange(new URL('./src/assets/fonts/twkai-subset.chars.txt', import.meta.url), { includeSpace: true });
const TWKAI_EXTRA_RANGE = charsetUnicodeRange(new URL('./src/assets/fonts/twkai-extra.chars.txt', import.meta.url));
/** @param {string[]} ranges */
const toRange = (ranges) => (ranges.length > 0 ? /** @type {[string, ...string[]]} */ (ranges) : undefined);


export default defineConfig({
  site,
  base,
  outDir,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  // /lab/（拋棄式試作的位置，已移除）與引擎 e2e 的 harness 路徑都不進 sitemap。
  integrations: [
    sitemap({ filter: (page) => !page.includes('/lab/') && !page.includes(`${QI_HARNESS_PATH}/`) }),
    // 建置時產出「氣」首頁的形體檔（src/assets/generated/qi/shapes/，已忽略；輸入雜湊不變就跳過）。
    qiAssets(),
    // 建置時檢查頁面用字都在 TW-Kai 子集內（TWKAI_GUARD=warn 時只警告）。
    twkaiGuard(),
    // 引擎 e2e 的 harness 頁：只有 QI_HARNESS=1（npm run build:harness）才註冊，一般建置與部署沒有這一頁。
    qiHarness(),
  ],
  image: {
    // <Image>／<Picture> 預設輸出 srcset 與 sizes；原圖最大 4080px，不會原尺寸輸出。
    layout: 'constrained',
    responsiveStyles: true,
  },
  fonts: [
    {
      // 全站只用 TW-Kai（全字庫楷體，OFL-1.1）一種字體、一種粗細（400）。
      // 檔案是 `npm run fonts:subset` 依實際用字子集化出來的 woff2（開發者本機指令，CI 不需要原檔）。
      provider: fontProviders.local(),
      name: 'TW-Kai',
      cssVariable: '--font-twkai',
      options: {
        variants: [
          // 順序有意義：第一個是核心，BaseLayout 只 preload fontData 的第一筆。
          { src: ['./src/assets/fonts/twkai-subset.woff2'], weight: 400, style: 'normal', unicodeRange: toRange(TWKAI_CORE_RANGE) },
          ...(TWKAI_EXTRA_RANGE.length > 0
            ? [
                {
                  src: /** @type {[string]} */ (['./src/assets/fonts/twkai-extra.woff2']),
                  weight: 400,
                  style: /** @type {const} */ ('normal'),
                  unicodeRange: toRange(TWKAI_EXTRA_RANGE),
                },
              ]
            : []),
        ],
      },
      fallbacks: ['Songti TC', 'PMingLiU', 'serif'],
    },
  ],
});
