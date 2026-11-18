// 字集 → CSS unicode-range。寫成 .mjs 是因為 astro.config.mjs 在載入設定時就要讀（scripts/fonts/split.ts 的說明）。
import { readFileSync } from 'node:fs';

const hex = (code) => code.toString(16).toUpperCase();

/** @param {Iterable<string>} chars @returns {string[]} 依碼位排序、連續碼位合成一段，例如 ['U+41-43', 'U+516D']。 */
export function unicodeRangeOf(chars) {
  const codes = [...new Set([...chars].map((ch) => ch.codePointAt(0)))].sort((a, b) => a - b);
  const ranges = [];
  for (let i = 0; i < codes.length; ) {
    let j = i;
    while (j + 1 < codes.length && codes[j + 1] === codes[j] + 1) j++;
    ranges.push(i === j ? `U+${hex(codes[i])}` : `U+${hex(codes[i])}-${hex(codes[j])}`);
    i = j + 1;
  }
  return ranges;
}

/**
 * 讀字集檔（每個非空白字元各算一個）轉成 unicode-range；檔案不存在回傳空陣列。
 * `includeSpace`：另外加上 U+20。字集檔不記空白，但子集化一定帶空白字形；核心子集不宣告的話，空白會改用後備字型，字寬不同、換行跟著變。
 * @param {string | URL} file
 * @param {{ includeSpace?: boolean }} [options]
 */
export function charsetUnicodeRange(file, options = {}) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  const chars = [...text].filter((ch) => !/\s/u.test(ch));
  if (options.includeSpace) chars.push(' ');
  return unicodeRangeOf(chars);
}
