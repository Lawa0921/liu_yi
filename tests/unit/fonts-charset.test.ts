import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  charsFromCss,
  charsFromHtml,
  charsFromJs,
  missingChars,
  parseCharList,
  scanDist,
  toCharsetText,
} from '../../scripts/fonts/charset';

const set = (text: string) => new Set([...text]);
const sorted = (chars: Set<string>) => [...chars].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);

describe('charsFromHtml', () => {
  it('文字節點與 alt、noscript 要收；script 內的字串不收', () => {
    const html = '<p>六藝 <b>武術</b></p><script>var s="隱藏"</script><img alt="劍"><noscript>無</noscript>';
    expect(charsFromHtml(html)).toEqual(set('六藝武術劍無'));
  });

  it('解 entity，且空白（含 U+00A0）一律不收，ASCII 要收', () => {
    const chars = charsFromHtml('<p>A&amp;B&nbsp;·</p>');
    expect(chars).toEqual(new Set(['A', '&', 'B', '·']));
    for (const ch of chars) expect(ch).not.toMatch(/\s/u);
  });

  it('數字 entity（十進位與十六進位）解成實際字元', () => {
    expect(charsFromHtml('<p>&#x516D;&#34269;&#38;</p>')).toEqual(set('六藝&'));
  });

  it('常見具名 entity 解成實際字元', () => {
    const chars = charsFromHtml('<p>&copy; &lt;&gt;&quot;&#39;&hellip;&middot;</p>');
    expect(chars).toEqual(new Set(['©', '<', '>', '"', "'", '…', '·']));
  });

  it('遇到表裡沒有的具名 entity 就丟錯，不靜默漏字', () => {
    expect(() => charsFromHtml('<p>&notanentity;</p>')).toThrow(/&notanentity;/);
  });

  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf'])(
    '&%s; 是 Object 原型鏈上的名稱，不是 entity：照樣當未知 entity 丟錯，不能把函式原始碼當字收進來',
    (name) => {
      expect(() => charsFromHtml(`<p>&${name};</p>`)).toThrow(new RegExp(`&${name};`));
    },
  );

  it('沒有分號的 & 照字面處理，不當成 entity', () => {
    expect(charsFromHtml('<p>AT&T</p>')).toEqual(new Set(['A', 'T', '&']));
  });

  it('只收 alt／title／aria-label／placeholder／value，其他屬性（href、class、data-*、meta content）不收', () => {
    const html =
      '<a href="/課程/" class="類別" data-label="資料" aria-label="導覽" title="標題">x</a>' +
      '<input placeholder="輸入" value="預設"><meta name="description" content="描述">';
    expect(charsFromHtml(html)).toEqual(set('導覽標題輸入預設x'));
  });

  it('屬性值可含 >、可用單引號或不加引號，屬性值內也解 entity', () => {
    const html = `<img alt="a > 圖" src="x"><input value='單引號'><input value=搜尋><i title="&quot;引&quot;">`;
    expect(charsFromHtml(html)).toEqual(new Set(['a', '>', '圖', '單', '引', '號', '搜', '尋', '"']));
  });

  it('屬性名稱大小寫不拘；data-alt 這種只是結尾像的屬性不收', () => {
    expect(charsFromHtml('<img ALT="大" data-alt="小" x-title="細">')).toEqual(set('大'));
  });

  it('註解、doctype 不收；<style> 內容不收', () => {
    const html = '<!DOCTYPE html><!-- 註解 --><style>.a::before{content:"・"}</style><p>文</p>';
    expect(charsFromHtml(html)).toEqual(set('文'));
  });

  it('script 內含 < 與 </p> 字樣也不會干擾後面的文字節點；script／SCRIPT 與屬性都不影響', () => {
    const html = '<SCRIPT type="module">if(a<b){x="</p>隱"}</SCRIPT><p>顯</p>';
    expect(charsFromHtml(html)).toEqual(set('顯'));
  });

  it('astral 字元（如 emoji）算一個字，不被拆成代理對', () => {
    const chars = charsFromHtml('<p>😀</p>');
    expect([...chars]).toEqual(['😀']);
  });

  it('控制字元不收', () => {
    expect(charsFromHtml('<p>a\u0000\u0007\tb\n</p>')).toEqual(set('ab'));
  });

  it('沒有任何文字時回空集合', () => {
    expect(charsFromHtml('<div><img src="x.png"></div>').size).toBe(0);
  });
});

describe('charsFromCss', () => {
  it('只取 content 的字串', () => {
    expect(charsFromCss('.a::before{content:"・"}.b{color:red}')).toEqual(set('・'));
  });

  it('單引號、多段字串與 attr()／counter() 並用都能取', () => {
    expect(charsFromCss(`.q::before{content:'「' attr(data-x) "」"}`)).toEqual(set('「」'));
    expect(charsFromCss('.n::before{content:counter(item) "、"}')).toEqual(set('、'));
  });

  it('解 CSS 跳脫：十六進位（含結尾空白）、\\" 與字面跳脫', () => {
    expect(charsFromCss('.a::before{content:"\\30FB"}')).toEqual(set('・'));
    expect(charsFromCss('.a::before{content:"\\30FB x"}')).toEqual(set('・x'));
    expect(charsFromCss('.a::before{content:"\\"q\\""}')).toEqual(new Set(['"', 'q']));
  });

  it('url() 內的字串、註解、非 content 屬性的字串都不收', () => {
    const css =
      '/* content:"註" */.a::before{content:url("icon.png")}.b{font-family:"標楷";quotes:"《" "》"}.c::after{content:none}';
    expect(charsFromCss(css).size).toBe(0);
  });

  it('屬性名稱要完整是 content（--content、background-content 之類不算）', () => {
    expect(charsFromCss('.a{--content:"隱";background-content:"藏"}').size).toBe(0);
  });

  it('選擇器裡的 .content:hover 不會被當成 content 宣告', () => {
    const css = '.content:hover{font-family:"標楷"}\n.x::before{\n  color:red;\n  content:"六"\n}';
    expect(charsFromCss(css)).toEqual(set('六'));
  });

  it('沒有結尾分號、緊接 } 的宣告也能取', () => {
    expect(charsFromCss('.a::before{content:"藝"}')).toEqual(set('藝'));
  });

  it('空白與控制字元不收', () => {
    expect(charsFromCss('.a::before{content:" "}')).toEqual(new Set());
    expect(charsFromCss('.a::before{content:"\\a"}')).toEqual(new Set());
  });
});

describe('charsFromJs', () => {
  it('只取 CJK 範圍的字，ASCII 字串不收', () => {
    expect(charsFromJs('x="關閉選單",y="abc"')).toEqual(set('關閉選單'));
  });

  it('範圍邊界：U+2E80–9FFF、U+3000–303F、U+FF00–FFEF 收，鄰近外側不收', () => {
    const inRange = ['⺀', '鿿', '「', '〿', '＀', '｜', '￯'];
    const outRange = ['⹿', 'ꀀ', '·', '﻿', '￰', '\u{20000}'];
    expect(charsFromJs(`s="${inRange.join('')}${outRange.join('')}"`)).toEqual(new Set(inRange));
  });

  it('全形標點收，全形空白（U+3000）當空白不收', () => {
    expect(charsFromJs('s="，。「」　！"')).toEqual(set('，。「」！'));
  });

  it('\\uXXXX 與 \\u{…} 跳脫也還原後再判斷範圍', () => {
    expect(charsFromJs('s="\\u95dc\\u9589\\u{9078}\\u0041"')).toEqual(set('關閉選'));
  });

  it('沒有 CJK 時回空集合', () => {
    expect(charsFromJs('const a = 1; // hello').size).toBe(0);
  });
});

describe('missingChars', () => {
  it('回傳用到但不在子集的字，依碼位排序', () => {
    expect(missingChars(set('六藝劍'), set('六藝'))).toEqual(['劍']);
    expect(missingChars(set('藝b六a'), set(''))).toEqual(['a', 'b', '六', '藝']);
  });

  it('列入允許退回清單的字不算缺', () => {
    expect(missingChars(set('六藝劍'), set('六藝'), new Set(['劍']))).toEqual([]);
  });

  it('子集比用到的多也沒事；全都有就回空陣列', () => {
    expect(missingChars(set('六'), set('六藝劍'))).toEqual([]);
  });

  it('ASCII 也要在子集內', () => {
    expect(missingChars(set('A六'), set('六'))).toEqual(['A']);
  });
});

describe('toCharsetText', () => {
  it('依碼位排序、無重複', () => {
    expect(toCharsetText(new Set(['b', 'a', '藝']))).toBe('ab藝');
  });

  it('astral 字元排在 BMP 之後，且仍是完整字元', () => {
    expect(toCharsetText(new Set(['😀', '藝', 'a']))).toBe('a藝😀');
  });

  it('空集合回空字串', () => {
    expect(toCharsetText(new Set())).toBe('');
  });
});

describe('parseCharList', () => {
  it('忽略所有空白與換行，其餘字元各算一個', () => {
    expect(parseCharList('ab\n 六 \t藝\r\n')).toEqual(set('ab六藝'));
  });

  it('空檔回空集合；# 沒有特殊意義（chars.txt 本身就含 #）', () => {
    expect(parseCharList('').size).toBe(0);
    expect(parseCharList('#a')).toEqual(new Set(['#', 'a']));
  });

  it('與 toCharsetText 互為反運算', () => {
    const chars = set('六藝A#😀');
    expect(parseCharList(toCharsetText(chars) + '\n')).toEqual(chars);
  });
});

describe('scanDist', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fonts-scan-'));
    mkdirSync(join(dir, 'sub', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'a.html'), '<p>六藝</p>');
    writeFileSync(join(dir, 'sub', 'b.html'), '<p>藝武術</p>');
    writeFileSync(join(dir, 'sub', 'deep', 'c.css'), '.x::before{content:"・"}');
    writeFileSync(join(dir, 'd.js'), 'const s="關閉";');
    writeFileSync(join(dir, 'e.xml'), '<urlset>隱藏</urlset>');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('掃 html、css、js 並彙整；.xml 不掃', async () => {
    const { chars } = await scanDist(dir);
    expect(sorted(chars)).toEqual(sorted(set('六藝武術・關閉')));
    expect(chars.has('隱')).toBe(false);
  });

  it('where 回「字 → 出現的檔案」，檔名為相對 dir 的 / 路徑，同一字出現在多檔時依字母序', async () => {
    const { chars, where } = await scanDist(dir);
    expect(where.get('六')).toEqual(['a.html']);
    expect(where.get('藝')).toEqual(['a.html', 'sub/b.html']);
    expect(where.get('術')).toEqual(['sub/b.html']);
    expect(where.get('・')).toEqual(['sub/deep/c.css']);
    expect(where.get('關')).toEqual(['d.js']);
    expect(where.has('隱')).toBe(false);
    expect(sorted(new Set(where.keys()))).toEqual(sorted(chars));
  });

  it('html 內聯的 <style> 用 content 規則、內聯的 <script> 用 CJK 範圍規則掃，where 記該 html', async () => {
    writeFileSync(
      join(dir, 'inline.html'),
      '<style>.q::before{content:"「"}.r{font-family:"標楷"}</style>' +
        '<script type="module">const l="開啟";</script>' +
        '<script type="application/ld+json">{"name":"隱形"}</script>' +
        '<p>文</p>',
    );
    const { chars, where } = await scanDist(dir);
    expect(where.get('「')).toEqual(['inline.html']);
    expect(where.get('開')).toEqual(['inline.html']);
    expect(where.get('文')).toEqual(['inline.html']);
    expect(chars.has('標')).toBe(false);
    expect(chars.has('隱')).toBe(false);
  });

  it('其他副檔名（圖片、svg、json、txt）不讀，空資料夾回空結果', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'fonts-scan-empty-'));
    try {
      writeFileSync(join(empty, 'x.webp'), '六藝');
      writeFileSync(join(empty, 'x.svg'), '<svg><text>六</text></svg>');
      writeFileSync(join(empty, 'x.json'), '{"a":"藝"}');
      writeFileSync(join(empty, 'robots.txt'), '六藝');
      const result = await scanDist(empty);
      expect(result.chars.size).toBe(0);
      expect(result.where.size).toBe(0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('files 回掃過的檔案（相對路徑、依字母序）', async () => {
    const { files } = await scanDist(dir);
    expect(files).toEqual(['a.html', 'd.js', 'sub/b.html', 'sub/deep/c.css']);
  });

  it('某個檔案解析失敗時，錯誤訊息帶上該檔的相對路徑，原因保留在 cause', async () => {
    writeFileSync(join(dir, 'sub', 'bad.html'), '<p>&notanentity;</p>');

    const error = await scanDist(dir).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^sub\/bad\.html：.*&notanentity;/s);
    expect(((error as Error).cause as Error).message).toMatch(/&notanentity;/);
  });

  it('資料夾不存在時 reject', async () => {
    await expect(scanDist(join(dir, 'nope'))).rejects.toThrow(/ENOENT/);
  });
});
