/**
 * 把站台用字拆成兩份子集：首頁每次都要下載的「核心」，與只有其他頁面才用到的「延伸」。
 * 兩份以 @font-face 的 unicode-range 宣告（astro.config.mjs），瀏覽器只在頁面真的出現延伸字時才下載延伸檔，
 * 所以子頁新增文案不會加重首頁首屏（tests/e2e/budget.spec.ts 的 1.5 MB 上限）。
 *
 * 核心＝出現在首頁（index.html）或任何非 .html 檔（共用的 JS／CSS 可能在首頁執行）的字；where 沒記錄的字保守地算核心。
 */
const HOME_PAGES = new Set(['index.html']);

export function splitCharset(chars: Set<string>, where: Map<string, string[]>): { core: Set<string>; extra: Set<string> } {
  const core = new Set<string>();
  const extra = new Set<string>();
  for (const ch of chars) {
    const files = where.get(ch);
    const onlyOtherPages = files !== undefined && files.length > 0 && files.every((file) => file.endsWith('.html') && !HOME_PAGES.has(file));
    (onlyOtherPages ? extra : core).add(ch);
  }
  return { core, extra };
}
