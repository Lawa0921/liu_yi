import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { splitCharset } from '../../scripts/fonts/split';
import { charsetUnicodeRange, unicodeRangeOf } from '../../scripts/fonts/ranges.mjs';

describe('splitCharset：首頁用到的字進核心檔，只出現在其他頁面的字進延伸檔', () => {
  const where = new Map<string, string[]>([
    ['六', ['index.html', 'courses/index.html']],
    ['劍', ['courses/chinese-weapons/index.html']],
    ['煩', ['facility/index.html', '404.html']],
    ['氣', ['_astro/qi-stage.js']],
    ['館', ['_astro/home.css', 'pricing/index.html']],
  ]);

  it('出現在首頁或任何非 .html 檔（共用的 JS／CSS）就算核心', () => {
    const { core, extra } = splitCharset(new Set(where.keys()), where);
    expect([...core].sort()).toEqual(['六', '氣', '館'].sort());
    expect([...extra].sort()).toEqual(['劍', '煩'].sort());
  });

  it('where 沒記錄的字保守地放核心', () => {
    const { core, extra } = splitCharset(new Set(['六', '藝']), new Map([['六', ['about/index.html']]]));
    expect([...core]).toEqual(['藝']);
    expect([...extra]).toEqual(['六']);
  });
});

describe('unicodeRangeOf', () => {
  it('依碼位排序，連續的合成一段', () => {
    expect(unicodeRangeOf(['B', 'A', 'C', 'E', '六'])).toEqual(['U+41-43', 'U+45', 'U+516D']);
  });

  it('BMP 以外的字也正確', () => {
    expect(unicodeRangeOf(['😀'])).toEqual(['U+1F600']);
  });

  it('空的回傳空陣列', () => {
    expect(unicodeRangeOf([])).toEqual([]);
  });
});

describe('charsetUnicodeRange：讀字集檔轉 unicode-range', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('忽略空白與換行；檔案不存在回傳空陣列', () => {
    dir = mkdtempSync(join(tmpdir(), 'fonts-range-'));
    const file = join(dir, 'c.txt');
    writeFileSync(file, 'BA\r\nC 六\n');
    expect(charsetUnicodeRange(file)).toEqual(['U+41-43', 'U+516D']);
    expect(charsetUnicodeRange(join(dir, 'missing.txt'))).toEqual([]);
  });

  it('includeSpace：加上 U+20（子集一定帶空白字形；不宣告的話空白會改用後備字型，字寬不同、換行跟著變）', () => {
    dir = mkdtempSync(join(tmpdir(), 'fonts-range-'));
    const file = join(dir, 'c.txt');
    writeFileSync(file, '!A\n');
    expect(charsetUnicodeRange(file, { includeSpace: true })).toEqual(['U+20-21', 'U+41']);
    expect(charsetUnicodeRange(file)).toEqual(['U+21', 'U+41']);
  });
});
