// 首頁的 beat 位置：把 DOM 的 `[data-beat]` 讀成捲動模型要的 `BeatRect[]`（文件座標，不是視窗座標）。
// 讀的是實際的 `getBoundingClientRect`（beat 用 min-height，高度不等，不能假設等高）；
// 會強制版面計算，所以只在 resize、字型載入完成、對象切換後讀，不在每一格讀。

import { BEATS, type BeatId } from '../../qi/config/poses';
import type { BeatRect } from '../../qi/engine/scroll-model';

const KNOWN = new Set<string>(BEATS);

export function readBeatRects(root: ParentNode, scrollY: number): BeatRect[] {
  const rects: BeatRect[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('[data-beat]')) {
    const id = el.dataset.beat;
    if (id === undefined || !KNOWN.has(id)) continue;
    const box = el.getBoundingClientRect();
    rects.push({ id: id as BeatId, top: box.top + scrollY, height: box.height });
  }
  return rects;
}
