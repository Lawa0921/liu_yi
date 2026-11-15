// 部署目標的唯一設定處：站台網址與 base 路徑。
// 預設是 GitHub Pages 專案頁 https://lawa0921.github.io/liu_yi/。
// 換自訂網域或根路徑時，改這裡的預設值，或在建置時給環境變數：
//   SITE_URL=https://example.com BASE_PATH=/ npm run build
// OUT_DIR 讓同一份程式碼能把兩種 base 建到不同資料夾（端對端測試用）。

export const DEFAULT_SITE = 'https://lawa0921.github.io';
export const DEFAULT_BASE = '/liu_yi';
export const DEFAULT_OUT_DIR = 'dist';

/** @param {string | undefined} value */
function clean(value) {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ site: string, base: string, outDir: string }}
 */
export function resolveDeployTarget(env = {}) {
  const site = (clean(env.SITE_URL) ?? DEFAULT_SITE).replace(/\/+$/, '');

  const rawBase = clean(env.BASE_PATH) ?? DEFAULT_BASE;
  const segments = rawBase.split('/').filter(Boolean);
  const base = segments.length === 0 ? '/' : `/${segments.join('/')}`;

  const outDir = `./${(clean(env.OUT_DIR) ?? DEFAULT_OUT_DIR).replace(/^\.?\/+/, '').replace(/\/+$/, '')}`;

  return { site, base, outDir };
}
