// base 路徑組合的純邏輯（可單元測試）。頁面與元件請用 src/lib/url.ts 的 url()。

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** 把任何寫法的 base 正規化成前後都有斜線的形式：'/' 或 '/liu_yi/'。 */
export function normalizeBase(base: string | undefined): string {
  const segments = (base ?? '').split('/').filter(Boolean);
  return segments.length === 0 ? '/' : `/${segments.join('/')}/`;
}

/**
 * 把站內路徑接到 base 後面。外部網址（http:、mailto:、// 開頭）與頁內錨點（#…）原樣回傳。
 * 傳入的 path 一律是「不含 base」的站內路徑，例如 '/courses/'；不要傳已經加過 base 的路徑。
 */
export function joinBase(base: string | undefined, path: string): string {
  if (EXTERNAL.test(path)) return path;

  const match = /^([^?#]*)(.*)$/.exec(path);
  const pathname = match?.[1] ?? '';
  const suffix = match?.[2] ?? '';

  const segments = pathname.split('/').filter(Boolean);
  const trailing = pathname.endsWith('/') && segments.length > 0 ? '/' : '';

  return `${normalizeBase(base)}${segments.join('/')}${trailing}${suffix}`;
}
