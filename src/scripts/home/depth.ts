// 首頁景深層的接線（Task 27）：換中景與捲動視差。標記在 components/home/Depth.astro，位移的計算在 lib/scene/parallax.ts（單元測試守住）。
//
//   - 中景依目前的段落換（`MID_BY_BEAT`）：IntersectionObserver 看哪個 `[data-beat]` 在視窗正中央，設 `.depth[data-depth-mid]`，CSS 交叉淡化。
//     不依賴光點引擎（沒有引擎、退回靜態圖時照樣換）。
//   - 首屏只載院門（預設中景）；其餘四種中景的圖放在 `data-src`，輪到那一段時載入，或引擎就緒（`html[data-qi-ready]`）、退回靜態圖後 2 秒一併載入（首屏預算）。
//   - 視差：passive 的 scroll 監聽，rAF 合併成一格一次；依整頁捲動進度（0–1）把遠景、中景、前景各自位移（`homeShift`）。減少動態時什麼都不做。
// 這個檔案會被打進首頁的腳本：程式字串只用英文（字型守門會掃 JS 裡的中文字）；也不得 import `config/copy.ts`。

import { BEATS, type BeatId } from '../../qi/config/poses';
import { HOME_FG_LEFT_BEATS, MID_BY_BEAT } from '../../lib/scene/config';
import { homeShift } from '../../lib/scene/parallax';

const KNOWN = new Set<string>(BEATS);
const FG_LEFT = new Set<string>(HOME_FG_LEFT_BEATS);

/** 延後載入的圖：有 `data-src` 且還沒有 `src` 才設。 */
function loadLazy(img: HTMLImageElement): void {
  const src = img.dataset.src;
  if (src && !img.getAttribute('src')) img.src = src;
}

export function initDepth(): void {
  const back = document.querySelector<HTMLElement>('.depth[data-depth]');
  if (!back) return;
  const front = document.querySelector<HTMLElement>('.depth-fg[data-depth]');
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 其餘中景：首屏之後（引擎就緒或退回靜態圖後 2 秒；頁面 load 之後 8 秒的保險）再載
  const lazy = [...back.querySelectorAll<HTMLImageElement>('img[data-src]')];
  const loadAll = (): void => lazy.forEach(loadLazy);
  const later = (): void => void window.setTimeout(loadAll, 2000);
  if (root.dataset.qiReady !== undefined || root.classList.contains('qi-static')) later();
  else {
    const wait = new MutationObserver(() => {
      if (root.dataset.qiReady === undefined && root.dataset.qiMode !== 'static') return;
      wait.disconnect();
      later();
    });
    wait.observe(root, { attributes: true });
  }
  window.addEventListener('load', () => void window.setTimeout(loadAll, 8000), { once: true });

  // 換中景：視窗正中央的那一段
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.beat;
        if (!entry.isIntersecting || id === undefined || !KNOWN.has(id)) continue;
        const mid = MID_BY_BEAT[id as BeatId];
        const img = back.querySelector<HTMLImageElement>(`img[data-mid="${mid}"]`);
        if (img) loadLazy(img); // 輪到這一段了：還沒載的先載（圖很小，淡入時多半已到）
        if (back.dataset.depthMid !== mid) back.dataset.depthMid = mid;
        const left = FG_LEFT.has(id) ? 'on' : 'off';
        if (front && front.dataset.depthLeft !== left) front.dataset.depthLeft = left;
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
