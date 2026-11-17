// 首頁景深層的接線（Task 27）：換中景與捲動視差。標記在 components/home/Depth.astro，位移的計算在 lib/scene/parallax.ts（單元測試守住）。
//
//   - 中景依目前的段落換（`MID_BY_BEAT`）：IntersectionObserver 看哪個 `[data-beat]` 在視窗正中央，設 `.depth[data-depth-mid]`，CSS 交叉淡化。
//     不依賴光點引擎（沒有引擎、退回靜態圖時照樣換）。
//   - 首屏只載院門（預設中景）；其餘四種中景的圖放在 `data-src`，輪到那一段時載入，或引擎就緒（`html[data-qi-ready]`）、退回靜態圖後 2 秒一併載入（首屏預算）。
//   - 視差：passive 的 scroll 監聽，rAF 合併成一格一次；依整頁捲動進度（0–1）把遠景、中景、前景各自位移（`homeShift`）。減少動態時不位移。
//   - 前景閃避文字（複審 Critical）：前景在文字之上（為了蓋在不透明的海報與靜態圖前面），所以每一格（捲動、改變視窗大小、換對象）量每個文字矩形，
//     與前景不透明部分的外框相交的那一張前景淡出（`data-fg-hide`，CSS 的轉場），文字走過去再淡入；減少動態時也照做（這是可讀性，不是動態）。
//     第一次量完才標 `data-fg-ready`（之前前景是透明的，沒有 JS 時前景不顯示）；`data-fg-sync` 記這一格用的 scrollY（e2e 用它等腳本處理完）。
// 這個檔案會被打進首頁的腳本：程式字串只用英文（字型守門會掃 JS 裡的中文字）；也不得 import `config/copy.ts`。

import { BEATS, type BeatId } from '../../qi/config/poses';
import { HOME_FG_LEFT_BEATS, MID_BY_BEAT } from '../../lib/scene/config';
import { opaqueBox, overlapsAny, type Box } from '../../lib/scene/fg-dodge';
import { homeShift } from '../../lib/scene/parallax';

const KNOWN = new Set<string>(BEATS);
const FG_LEFT = new Set<string>(HOME_FG_LEFT_BEATS);

/** 前景外框往外加的邊距（px）：文字離前景 6 px 以內就先淡出，不要等它真的碰到。 */
const FG_MARGIN = 6;
/** 位置固定或黏住視窗的文字（切換鈕、段落導覽）：不隨頁面捲動，每一格都要重量。 */
const FIXED_TEXT = '.audience-switch, .home-rail';

interface TextItem {
  node: Text;
  fixed: boolean;
  /** 所在元素在文件裡的上下緣（捲動時用來略過離視窗很遠的文字）。 */
  top: number;
  bottom: number;
}

/** 頁面上所有看得見的文字節點（不含景深層、腳本、隱藏的）；版面改變（視窗、字型、換對象）時重建。 */
function collectText(): TextItem[] {
  const main = document.querySelector('main');
  if (!main) return [];
  const items: TextItem[] = [];
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const parent = text.parentElement;
    if (!parent || !text.data.trim() || parent.closest('.depth, .depth-fg, script, style, noscript, [hidden]')) continue;
    const box = parent.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue; // 沒有畫出來（另一組對象的面板、display: none）
    items.push({ node: text, fixed: parent.closest(FIXED_TEXT) !== null, top: box.top + window.scrollY, bottom: box.bottom + window.scrollY });
  }
  return items;
}

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

  root.dataset.depthMotion = reduced ? 'off' : 'on';

  const layers = [...document.querySelectorAll<HTMLElement>('[data-depth-layer]')].map((el) => ({ el, kind: el.dataset.depthLayer as 'far' | 'mid' | 'fg' }));
  const fgImages = front ? [...front.querySelectorAll<HTMLImageElement>('img.depth__img')] : [];
  let items: TextItem[] = [];
  const range = document.createRange();

  /** 目前在視窗內的文字矩形（視窗座標）。 */
  const textBoxes = (): Box[] => {
    const boxes: Box[] = [];
    const scrollY = window.scrollY;
    const view = window.innerHeight;
    for (const item of items) {
      if (!item.fixed && (item.bottom - scrollY < -FG_MARGIN || item.top - scrollY > view + FG_MARGIN)) continue;
      range.selectNodeContents(item.node);
      for (const r of range.getClientRects()) {
        if (r.width > 0 && r.height > 0) boxes.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      }
    }
    return boxes;
  };

  const dodge = (): void => {
    if (!front) return;
    const texts = textBoxes();
    for (const img of fgImages) {
      const rect = img.getBoundingClientRect(); // 含視差位移與翻轉
      if (rect.width === 0 || rect.height === 0) continue; // display: none（直向的窗櫺）
      const flipped = new DOMMatrixReadOnly(getComputedStyle(img).transform).a < 0;
      const box = opaqueBox({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, img.dataset.asset ?? '', flipped);
      img.toggleAttribute('data-fg-hide', overlapsAny(box, texts, FG_MARGIN));
    }
    front.dataset.fgSync = String(Math.round(window.scrollY));
    front.setAttribute('data-fg-ready', '');
  };

  let frame = 0;
  const apply = (): void => {
    frame = 0;
    if (!reduced) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? window.scrollY / max : 0;
      for (const { el, kind } of layers) {
        const y = homeShift(kind, progress, window.innerHeight, false);
        el.style.transform = `translate3d(0px, ${Math.round(y * 10) / 10}px, 0)`;
      }
    }
    dodge();
  };
  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(apply);
  };
  const rebuild = (): void => {
    items = collectText();
    schedule();
  };

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', rebuild, { passive: true });
  window.addEventListener('load', rebuild, { once: true });
  void document.fonts?.ready.then(rebuild);
  // 版面變高變矮（靜態圖載入、字型換上、面板顯示與隱藏）：重建文字清單
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(rebuild).observe(document.body);
  // 換對象：面板整組換掉，新那一組的文字還有 0.7 秒的升起動畫，動畫結束後再量一次
  new MutationObserver(() => {
    rebuild();
    window.setTimeout(rebuild, 900);
  }).observe(root, { attributes: true, attributeFilter: ['data-audience'] });
  rebuild();
}
