import { describe, expect, it } from 'vitest';
import { readBeatRects } from '../../src/scripts/home/beats';

/** 只實作 `readBeatRects` 用到的那一點 DOM：`querySelectorAll('[data-beat]')`、`dataset.beat`、`getBoundingClientRect()`。 */
function fakeRoot(items: { id: string | undefined; top: number; height: number }[]): ParentNode {
  const nodes = items.map((item) => ({
    dataset: { beat: item.id },
    getBoundingClientRect: () => ({ top: item.top, height: item.height }),
  }));
  return { querySelectorAll: () => nodes } as unknown as ParentNode;
}

describe('readBeatRects：以 getBoundingClientRect 與 scrollY 還原文件座標', () => {
  it('top = 視窗內的 top + scrollY；height 照讀（高度不等也不假設）', () => {
    const root = fakeRoot([
      { id: 'opening', top: -300, height: 800 },
      { id: 'fist', top: 500, height: 1250 },
    ]);
    expect(readBeatRects(root, 300)).toEqual([
      { id: 'opening', top: 0, height: 800 },
      { id: 'fist', top: 800, height: 1250 },
    ]);
  });

  it('不認得的 id 或沒有 id 的元素略過（不丟錯）', () => {
    const root = fakeRoot([
      { id: 'opening', top: 0, height: 700 },
      { id: 'bogus', top: 700, height: 700 },
      { id: undefined, top: 1400, height: 700 },
      { id: 'booking', top: 2100, height: 700 },
    ]);
    expect(readBeatRects(root, 0).map((beat) => beat.id)).toEqual(['opening', 'booking']);
  });

  it('沒有任何 [data-beat]：回空陣列', () => {
    expect(readBeatRects(fakeRoot([]), 0)).toEqual([]);
  });
});
