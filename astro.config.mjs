// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { resolveDeployTarget } from './deploy-target.mjs';
import { twkaiGuard } from './integrations/twkai-guard.ts';

// site／base／outDir 的預設值與環境變數覆寫都在 deploy-target.mjs。
const { site, base, outDir } = resolveDeployTarget(process.env);

export default defineConfig({
  site,
  base,
  outDir,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  // /lab/ 底下是給業主看方向的拋棄式試作，不進 sitemap。
  integrations: [
    sitemap({ filter: (page) => !page.includes('/lab/') }),
    // 建置時檢查頁面用字都在 TW-Kai 子集內（TWKAI_GUARD=warn 時只警告）。
    twkaiGuard(),
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
        variants: [{ src: ['./src/assets/fonts/twkai-subset.woff2'], weight: 400, style: 'normal' }],
      },
      fallbacks: ['Songti TC', 'PMingLiU', 'serif'],
    },
  ],
});
