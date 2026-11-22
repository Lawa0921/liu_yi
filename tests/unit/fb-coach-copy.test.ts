// 2026-11-22 業主要求：大人班的課程文案參考詹教練的粉專（facebook.com/LucalSixArts，六藝武學）。
// 只寫該粉專貼文明說的事，語氣收斂成網站用；出處整理在 docs/fb-sync-2026-11-22.md。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const body = (path: string) => read(path).split(/^---\r?$/m).slice(2).join('---');

describe('大人三門主課的內文（詹教練粉專）', () => {
  it('八極專修：求真、怎麼練、時段', () => {
    const md = body('src/content/courses/bajiquan.md');
    expect(md).toContain('最真實的八極拳');
    expect(md).toContain('## 怎麼練');
    expect(md).toContain('定樁');
    expect(md).toContain('活樁');
    expect(md).toContain('## 上課時間');
    expect(md).toContain('週五、週六晚上');
  });

  it('散手技擊：怎麼練（反覆練、先控制再加強度、與現代格鬥比較），原本的時段還在', () => {
    const md = body('src/content/courses/sanshou.md');
    expect(md).toContain('## 怎麼練');
    expect(md).toContain('衝錘');
    expect(md).toContain('受傷不是勳章');
    expect(md).toContain('週日 19:30–21:00');
  });

  it('中式兵器：怎麼練；苗刀、大槍的子項都有說明', () => {
    const md = read('src/content/courses/chinese-weapons.md');
    expect(md).toContain('## 怎麼練');
    expect(md).toContain('拍位');
    expect(md).toMatch(/name: 苗刀\r?\n\s+description: .*單勢精修/);
    expect(md).toMatch(/name: 大槍\r?\n\s+description: /);
  });

  it('首頁直接顯示的 summary 不動（版面照短句調）', () => {
    expect(read('src/content/courses/bajiquan.md')).toContain('summary: 八極拳的套路與應用。');
    expect(read('src/content/courses/sanshou.md')).toContain('summary: 八極拳風格的散手。');
    expect(read('src/content/courses/chinese-weapons.md')).toContain('summary: 中國劍、苗刀、大槍，三種兵器。');
  });

  it('不把教練對同行的嘲諷搬上網站', () => {
    for (const id of ['bajiquan', 'sanshou', 'chinese-weapons']) {
      expect(body(`src/content/courses/${id}.md`)).not.toMatch(/傳武仔|大師|pua|下三濫/i);
    }
  });
});
