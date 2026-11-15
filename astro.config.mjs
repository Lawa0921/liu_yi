// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { resolveDeployTarget } from './deploy-target.mjs';

// site／base／outDir 的預設值與環境變數覆寫都在 deploy-target.mjs。
const { site, base, outDir } = resolveDeployTarget(process.env);

export default defineConfig({
  site,
  base,
  outDir,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [sitemap()],
  image: {
    // <Image>／<Picture> 預設輸出 srcset 與 sizes；原圖最大 4080px，不會原尺寸輸出。
    layout: 'constrained',
    responsiveStyles: true,
  },
  fonts: [
    {
      // 標題用襯線明體。Google 的中文字型以 unicode-range 分片，瀏覽器只抓頁面用到的片段；
      // 只載標題用的一個字重。
      provider: fontProviders.google(),
      name: 'Noto Serif TC',
      cssVariable: '--font-noto-serif-tc',
      weights: [700],
      styles: ['normal'],
      subsets: ['chinese-traditional', 'latin'],
      fallbacks: ['Songti TC', 'PMingLiU', 'serif'],
    },
  ],
});
