import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

/**
 * 用字掃描：從建置產物找出「頁面實際會用 TW-Kai 渲染的字」，供子集化與建置守門使用。
 * 全部是純函式（`scanDist` 除外，它只讀檔），不依賴任何 HTML／CSS／JS 解析套件。
 */

/** 空白與控制字元：不渲染字形，不算「用到的字」。 */
const SKIPPED = /[\s\p{Cc}]/u;

function addChars(into: Set<string>, text: string, accept: (codePoint: number) => boolean = () => true): void {
  for (const ch of text) {
    if (!SKIPPED.test(ch) && accept(ch.codePointAt(0)!)) into.add(ch);
  }
}

// ───────────────────────── HTML ─────────────────────────

/**
 * 具名 entity 表。故意不收全部 2 000 多個：頁面只會用到少數幾個。
 * 遇到表外的名稱會丟錯而不是略過，否則該字會悄悄漏出守門之外；缺了就補在這裡。
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  middot: '·',
  hellip: '…',
  bull: '•',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  times: '×',
  divide: '÷',
  plusmn: '±',
  deg: '°',
  sect: '§',
  para: '¶',
  cent: '¢',
  pound: '£',
  yen: '¥',
  euro: '€',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  hearts: '♥',
  check: '✓',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (_match, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const codePoint = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      const valid = codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff);
      return valid ? String.fromCodePoint(codePoint) : '�';
    }
    // 必須是自己的屬性：`&constructor;` 之類的名稱會沿原型鏈查到 Object 的函式，不是 entity
    const decoded = Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : undefined;
    if (decoded === undefined) {
      throw new Error(`未知的 HTML entity &${body};：請改用字元本身或數字 entity，或把它補進 scripts/fonts/charset.ts 的 NAMED_ENTITIES`);
    }
    return decoded;
  });
}

/** 值得掃字的屬性（其餘如 href、class、data-*、meta content 都不會被渲染成文字）。 */
const TEXT_ATTRIBUTES = new Set(['alt', 'title', 'aria-label', 'placeholder', 'value']);

const JS_SCRIPT_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript']);

interface HtmlScan {
  /** 文字節點與文字屬性（已解 entity、已去空白與控制字元）。 */
  chars: Set<string>;
  /** 內聯的 `<style>` 內容。 */
  styles: string[];
  /** 內聯的、可執行為 JavaScript 的 `<script>` 內容（`ld+json`、`importmap` 等不算）。 */
  scripts: string[];
}

function isWhitespace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

/** 解析 start tag 到結尾 `>`，屬性值可含 `>`（在引號內）。回傳屬性與 `>` 之後的位置。 */
function parseStartTag(html: string, from: number): { name: string; attrs: [string, string][]; end: number; selfClosing: boolean } {
  const n = html.length;
  let i = from + 1;
  const nameStart = i;
  while (i < n && !isWhitespace(html[i]) && html[i] !== '/' && html[i] !== '>') i++;
  const name = html.slice(nameStart, i).toLowerCase();
  const attrs: [string, string][] = [];
  let selfClosing = false;

  while (i < n) {
    while (i < n && (isWhitespace(html[i]) || html[i] === '/')) {
      if (html[i] === '/') selfClosing = true;
      i++;
    }
    if (i >= n) break;
    if (html[i] === '>') {
      i++;
      return { name, attrs, end: i, selfClosing };
    }
    selfClosing = false;

    const attrStart = i;
    while (i < n && !isWhitespace(html[i]) && html[i] !== '/' && html[i] !== '>' && html[i] !== '=') i++;
    const attrName = html.slice(attrStart, i).toLowerCase();
    while (i < n && isWhitespace(html[i])) i++;

    let value = '';
    if (html[i] === '=') {
      i++;
      while (i < n && isWhitespace(html[i])) i++;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        const stop = close === -1 ? n : close;
        value = html.slice(i + 1, stop);
        i = close === -1 ? n : close + 1;
      } else {
        const valueStart = i;
        while (i < n && !isWhitespace(html[i]) && html[i] !== '>') i++;
        value = html.slice(valueStart, i);
      }
    }
    if (attrName !== '') attrs.push([attrName, value]);
  }
  return { name, attrs, end: n, selfClosing: false };
}

function scanHtml(html: string): HtmlScan {
  const chars = new Set<string>();
  const styles: string[] = [];
  const scripts: string[] = [];
  const n = html.length;
  let i = 0;

  const addText = (text: string) => addChars(chars, decodeEntities(text));

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      addText(html.slice(i));
      break;
    }
    if (lt > i) addText(html.slice(i, lt));

    const next = html[lt + 1];
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
    } else if (next === '!' || next === '?' || next === '/') {
      // doctype、處理指令、結束標籤：沒有可渲染的文字
      const end = html.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
    } else if (next === undefined || !/[A-Za-z]/.test(next)) {
      // 後面不是標籤名稱的 `<`（如 "a < b"）是普通文字
      addText('<');
      i = lt + 1;
    } else {
      const tag = parseStartTag(html, lt);
      i = tag.end;
      for (const [name, value] of tag.attrs) {
        if (TEXT_ATTRIBUTES.has(name)) addText(value);
      }
      if ((tag.name === 'script' || tag.name === 'style') && !tag.selfClosing) {
        const closing = new RegExp(`</${tag.name}(?=[\\s/>])`, 'i');
        const rest = html.slice(i);
        const found = closing.exec(rest);
        const body = found ? rest.slice(0, found.index) : rest;
        if (tag.name === 'style') {
          styles.push(body);
        } else {
          const type = (tag.attrs.find(([name]) => name === 'type')?.[1] ?? '').split(';')[0]!.trim().toLowerCase();
          if (JS_SCRIPT_TYPES.has(type)) scripts.push(body);
        }
        if (found) {
          const end = html.indexOf('>', i + found.index);
          i = end === -1 ? n : end + 1;
        } else {
          i = n;
        }
      }
    }
  }
  return { chars, styles, scripts };
}

/**
 * 文字節點（含 `<noscript>`、`<title>`）與 `alt`／`title`／`aria-label`／`placeholder`／`value` 屬性值裡的字。
 * 不含 `<script>`、`<style>`、註解；空白與控制字元不算。entity 會還原，遇到表外的具名 entity 丟錯。
 */
export function charsFromHtml(html: string): Set<string> {
  return scanHtml(html).chars;
}

// ───────────────────────── CSS ─────────────────────────

/** 讀一個 CSS 字串（`src[start]` 是起始引號），解跳脫。回傳內容與結尾引號之後的位置。 */
function readCssString(src: string, start: number): { value: string; end: number } {
  const quote = src[start];
  const n = src.length;
  let i = start + 1;
  let value = '';
  while (i < n) {
    const ch = src[i]!;
    if (ch === quote) return { value, end: i + 1 };
    if (ch !== '\\') {
      value += ch;
      i++;
      continue;
    }
    const hex = /^[0-9a-fA-F]{1,6}/.exec(src.slice(i + 1, i + 7));
    if (hex) {
      const codePoint = Number.parseInt(hex[0], 16);
      const valid = codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff);
      value += valid ? String.fromCodePoint(codePoint) : '�';
      i += 1 + hex[0].length;
      // 十六進位跳脫後可有一個空白（\r\n 算一個）當結尾
      if (src.startsWith('\r\n', i)) i += 2;
      else if (isWhitespace(src[i])) i += 1;
    } else if (src[i + 1] === '\n' || src[i + 1] === '\f') {
      i += 2; // 行延續
    } else if (src.startsWith('\r\n', i + 1)) {
      i += 3;
    } else if (i + 1 < n) {
      value += src[i + 1];
      i += 2;
    } else {
      i++;
    }
  }
  return { value, end: n };
}

/** 一個宣告的值，從 `from` 到沒被引號包住的 `;` 或 `}`。回傳裡面所有字串（略過 `url(...)`）。 */
function stringsInDeclarationValue(css: string, from: number): string[] {
  const strings: string[] = [];
  const n = css.length;
  let i = from;
  while (i < n) {
    const ch = css[i]!;
    if (ch === ';' || ch === '}') break;
    if (ch === '"' || ch === "'") {
      const { value, end } = readCssString(css, i);
      strings.push(value);
      i = end;
    } else if ((ch === 'u' || ch === 'U') && /^url\(/i.test(css.slice(i, i + 4))) {
      i += 4;
      while (i < n && css[i] !== ')') {
        i = css[i] === '"' || css[i] === "'" ? readCssString(css, i).end : i + 1;
      }
      i++;
    } else {
      i++;
    }
  }
  return strings;
}

/** 只取 `content: "…"` 宣告裡的字串（解 CSS 跳脫）；字型名稱、`url()`、註解、其他屬性的字串都不算。 */
export function charsFromCss(css: string): Set<string> {
  const chars = new Set<string>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // 屬性名稱要是宣告的開頭（前一個非空白字元是 { ; } 或檔頭），避免 `.content:hover` 之類的選擇器被誤認
  const declaration = /(?<=(?:^|[{;}])\s*)content\s*:/gi;
  for (const match of clean.matchAll(declaration)) {
    for (const value of stringsInDeclarationValue(clean, match.index + match[0].length)) addChars(chars, value);
  }
  return chars;
}

// ───────────────────────── JS ─────────────────────────

/** CJK 部首到統一表意文字、CJK 符號與標點、全形與半形形式。 */
function isCjkCodePoint(cp: number): boolean {
  return (cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef);
}

/**
 * 只取落在 CJK 範圍（U+2E80–9FFF、U+3000–303F、U+FF00–FFEF）的字。
 * 程式碼裡的 ASCII 字串太雜（識別字、網址、CSS 類名），不掃；所以 ASCII 與拉丁字元要靠 HTML 與 CSS 的掃描。
 * 建置工具若把非 ASCII 輸出成 `\uXXXX`／`\u{…}`，先還原再判斷。
 */
export function charsFromJs(js: string): Set<string> {
  const chars = new Set<string>();
  const decoded = js.replace(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})/g, (_match, long?: string, short?: string) => {
    const codePoint = Number.parseInt((long ?? short)!, 16);
    return codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff) ? String.fromCodePoint(codePoint) : '';
  });
  addChars(chars, decoded, isCjkCodePoint);
  return chars;
}

// ───────────────────────── 彙整 ─────────────────────────

const SCANNED_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs']);

async function listFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (SCANNED_EXTENSIONS.has(extname(entry.name).toLowerCase())) found.push(full);
    }
  };
  await walk(dir);
  return found;
}

/**
 * 掃建置產物資料夾：`.html`（文字節點、文字屬性，加上內聯的 `<style>` 與 `<script>`）、`.css`、`.js`／`.mjs`。
 * 其他檔（圖片、`.xml`、`.svg`、`.json`、`.txt`）不讀。
 * `where` 是「字 → 出現的檔案」，檔名為相對 `dir`、以 `/` 分隔，依字串順序排列；`files` 是所有掃過的檔案（同樣的相對路徑與順序）。
 * 某個檔案解析失敗時，錯誤訊息以該檔的相對路徑開頭（原錯誤留在 `cause`）。
 */
export async function scanDist(
  dir: string,
): Promise<{ chars: Set<string>; where: Map<string, string[]>; files: string[] }> {
  const files = (await listFiles(dir))
    .map((full) => ({ full, rel: relative(dir, full).split(sep).join('/') }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const chars = new Set<string>();
  const where = new Map<string, string[]>();

  for (const { full, rel } of files) {
    const source = await readFile(full, 'utf8');
    const found = new Set<string>();
    try {
      switch (extname(rel).toLowerCase()) {
        case '.html': {
          const page = scanHtml(source);
          for (const ch of page.chars) found.add(ch);
          for (const style of page.styles) for (const ch of charsFromCss(style)) found.add(ch);
          for (const script of page.scripts) for (const ch of charsFromJs(script)) found.add(ch);
          break;
        }
        case '.css':
          for (const ch of charsFromCss(source)) found.add(ch);
          break;
        default:
          for (const ch of charsFromJs(source)) found.add(ch);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${rel}：${reason}`, { cause: error });
    }
    for (const ch of found) {
      chars.add(ch);
      const pages = where.get(ch);
      if (pages) pages.push(rel);
      else where.set(ch, [rel]);
    }
  }
  return { chars, where, files: files.map(({ rel }) => rel) };
}

/**
 * 掃描結果裡沒有任何 .html 就丟錯：資料夾不是建置產物（路徑指錯、建置沒產出頁面）時，
 * 空的結果不能被當成「沒有用字」而放行或覆寫子集。
 */
export function assertHasHtml(scan: { files: string[] }, dir: string): void {
  if (!scan.files.some((file) => file.toLowerCase().endsWith('.html'))) {
    throw new Error(`${dir} 內沒有任何 .html 檔，無法判斷頁面用字：請確認它是建置產物資料夾`);
  }
}

// ───────────────────────── 字集 ─────────────────────────

function byCodePoint(a: string, b: string): number {
  return a.codePointAt(0)! - b.codePointAt(0)!;
}

/** 依碼位排序、無重複的字串（Set 本身已去重）。 */
export function toCharsetText(chars: Set<string>): string {
  return [...chars].sort(byCodePoint).join('');
}

/** 讀 `twkai-subset.chars.txt`、`fallback-allowed.txt` 這類字集檔：所有非空白字元各算一個，沒有註解語法（`#` 本身就是字）。 */
export function parseCharList(text: string): Set<string> {
  const chars = new Set<string>();
  addChars(chars, text);
  return chars;
}

/** 用到、但不在子集、也沒列入「允許退回其他字型」的字，依碼位排序。 */
export function missingChars(used: Set<string>, subset: Set<string>, allowedFallback: Set<string> = new Set()): string[] {
  return [...used].filter((ch) => !subset.has(ch) && !allowedFallback.has(ch)).sort(byCodePoint);
}
