// 首頁景深層的接線（Task 27）：換中景與捲動視差。標記在 components/home/Depth.astro，位移的計算在 lib/scene/parallax.ts（單元測試守住）。
//
//   - 中景依目前的段落換（`MID_BY_BEAT`）：IntersectionObserver 看哪個 `[data-beat]` 在視窗正中央，設 `.depth[data-depth-mid]`，CSS 交叉淡化。
//     不依賴光點引擎（沒有引擎、退回靜態圖時照樣換）。
//   - 視差：passive 的 scroll 監聽，rAF 合併成一格一次；依整頁捲動進度（0–1）把遠景、中景、前景各自位移（`homeShift`）。減少動態時什麼都不做。
// 這個檔案會被打進首頁的腳本：程式字串只用英文（字型守門會掃 JS 裡的中文字）；也不得 import `config/copy.ts`。

import { BEATS, type BeatId } from '../../qi/config/poses';
import { MID_BY_BEAT } from '../../lib/scene/config';
import { homeShift } from '../../lib/scene/parallax';

const KNOWN = new Set<string>(BEATS);

export function initDepth(): void {
  const back = document.querySelector<HTMLElement>('.depth[data-depth]');
  if (!back) return;
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 換中景：視窗正中央的那一段
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.beat;
        if (!entry.isIntersecting || id === undefined || !KNOWN.has(id)) continue;
        const mid = MID_BY_BEAT[id as BeatId];
        if (back.dataset.depthMid !== mid) back.dataset.depthMid = mid;
      }
    },
    { rootMargin: '-50% 0px -50% 0px' },
  );
  for (const beat of document.querySelectorAll('[data-beat]')) observer.observe(beat);

  if (reduced) {
    root.dataset.depthMotion = 'off';
    return;
  }
  root.dataset.depthMotion = 'on';

  const layers = [...document.querySelectorAll<HTMLElement>('[data-depth-layer]')].map((el) => ({ el, kind: el.dataset.depthLayer as 'far' | 'mid' | 'fg' }));
  let frame = 0;
  const apply = (): void => {
    frame = 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progress = max > 0 ? window.scrollY / max : 0;
    for (const { el, kind } of layers) {
      const y = homeShift(kind, progress, window.innerHeight, false);
      el.style.transform = `translate3d(0px, ${Math.round(y * 10) / 10}px, 0)`;
    }
  };
  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(apply);
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  schedule();
}
