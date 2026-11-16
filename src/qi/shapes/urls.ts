/**
 * 形體檔的執行時網址（只在瀏覽器建置用；Node 的建置腳本不 import 它）。
 *
 * `.bin` 是建置產物（D11，`src/assets/generated/qi/shapes/`，已忽略），由 `integrations/qi-assets.ts` 在 `astro:config:setup`
 * 產生，之後 Vite 的 `import.meta.glob` 才找得到。`?url` 讓 Vite 處理資產：開發時是帶 base 的來源路徑，
 * 建置後是帶 base 的雜湊檔名（`/liu_yi/_astro/land.<hash>.bin`、根路徑建置則無 `/liu_yi`），所以不需要再經 `url()`。
 * 檔案比 `assetsInlineLimit` 大得多（約 115 KB），不會被內嵌成 data URI。
 */

/** 由 glob 的結果（檔案路徑 → 網址）建出「形體 id → 網址」的查表函式；id 就是 `.bin` 的檔名（不含副檔名）。 */
export function shapeUrlResolver(urls: Record<string, string>): (id: string) => string {
  const byId = new Map<string, string>();
  for (const [path, url] of Object.entries(urls)) {
    const name = /([^/\\]+)\.bin$/.exec(path)?.[1];
    if (name) byId.set(name, url);
  }
  return (id) => {
    const url = byId.get(id);
    if (url === undefined) throw new Error(`No shape file for "${id}" (known: ${[...byId.keys()].join(', ') || 'none'}); shape files are build artifacts, run npm run build or astro dev first`);
    return url;
  };
}

const urls = import.meta.glob<string>('../../assets/generated/qi/shapes/*.bin', { query: '?url', import: 'default', eager: true });

export const resolveShapeUrl: (id: string) => string = shapeUrlResolver(urls);
