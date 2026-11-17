// 首頁景深層的接線（Task 27）：換中景與捲動視差。標記在 components/home/Depth.astro，位移的計算在 lib/scene/parallax.ts（單元測試守住）。
//
//   - 中景依目前的段落換（`MID_BY_BEAT`）：IntersectionObserver 看哪個 `[data-beat]` 在視窗正中央，設 `.depth[data-depth-mid]`，CSS 交叉淡化。
//     不依賴光點引擎（沒有引擎、退回靜態圖時照樣換）。
//   - 首屏只載院門（預設中景）；其餘四種中景的圖放在 `data-src`，輪到那一段時載入，或引擎就緒（`html[data-qi-ready]`）、退回靜態圖後 2 秒一併載入（首屏預算）。
//   - 視差：passive 的 scroll 監聽，rAF 合併成一格一次；依整頁捲動進度（0–1）把遠景、中景、前景各自位移（`homeShift`）。減少動態時不位移。
//   - 前景閃避文字（複審 Critical）：前景在文字之上（為了蓋在不透明的海報與靜態圖前面），所以每一格（捲動、改變視窗大小、換對象）量每個文字矩形，
//     與前景不透明部分的外框相交的那一張前景淡出（`data-fg-hide`，CSS 的轉場），文字走過去再淡入；減少動態時也照做（這是可讀性，不是動態）。
//     只算看得見的文字（夾進景深層的矩形：被頁首蓋住、在外框下緣之外的不算）。淡出要快（0.1 s，淡入 0.3 s），所以要提前：依捲動速度與方向
//     （`trackScroll`）往文字來的那一側看遠 速度 × (0.1 s ＋ 餘裕 0.05 s ＋ 一格)（`leadBox`），文字還沒碰到前景就開始淡出；文字已經壓上來（沒趕上）就直接切掉（`data-fg-cut`）。
//     提前量只看會隨捲動移動的文字；固定在畫面上的切換鈕與段落導覽只算「現在相交」（`dodgeDecision`）。
//     最後一個 scroll 事件之後 `FG_SETTLE_MS` 再重算一格、速度歸零（`settleTrack`）：突然停下時前景不會卡在隱藏。
//     第一次量完才標 `data-fg-ready`（之前前景是透明的，沒有 JS 時前景不顯示）；`data-fg-sync` 記這一格用的 scrollY（e2e 用它等腳本處理完）。
// 這個檔案會被打進首頁的腳本：程式字串只用英文（字型守門會掃 JS 裡的中文字）；也不得 import `config/copy.ts`。

import { BEATS, type BeatId } from '../../qi/config/poses';
import { HOME_FG_LEFT_BEATS, MID_BY_BEAT } from '../../lib/scene/config';
import { clipBox, dodgeDecision, FG_SETTLE_MS, opaqueBox, settleTrack, trackScroll, type Box, type ScrollTrack } from '../../lib/scene/fg-dodge';
import { homeShift } from '../../lib/scene/parallax';

const KNOWN = new Set<string>(BEATS);
const FG_LEFT = new Set<string>(HOME_FG_LEFT_BEATS);

/** 前景外框往外加的邊距（px）：文字離前景 6 px 以內就先淡出，不要等它真的碰到。 */
const FG_MARGIN = 6;
/** 捲動時往來向那一側再看多遠的上限（px）：略過離視窗更遠的文字（速度上限 6000 px/s × 約 0.2 s）。 */
const CULL = 1500;
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

  /**
   * 目前在視窗附近的文字矩形（視窗座標，沒夾過：提前量要看到還在頁首或外框底下、下一兩格就會進來的文字），
   * 分成會隨頁面捲動的與固定在畫面上的（切換鈕、段落導覽：不會靠近，只算現在相交）。
   */
  const textBoxes = (): { moving: Box[]; fixed: Box[] } => {
    const moving: Box[] = [];
    const fixed: Box[] = [];
    const scrollY = window.scrollY;
    const view = window.innerHeight;
    for (const item of items) {
      if (!item.fixed && (item.bottom - scrollY < -CULL || item.top - scrollY > view + CULL)) continue;
      range.selectNodeContents(item.node);
      const into = item.fixed ? fixed : moving;
      for (const r of range.getClientRects()) {
        if (r.width > 0 && r.height > 0) into.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      }
    }
    return { moving, fixed };
  };

  let track: ScrollTrack | undefined;

  const dodge = (frameSeconds: number): void => {
    if (!front) return;
    const rectOfArea = front.getBoundingClientRect();
    const area: Box = { left: rectOfArea.left, top: rectOfArea.top, right: rectOfArea.right, bottom: rectOfArea.bottom };
    const { moving, fixed } = textBoxes();
    const speed = track?.speed ?? 0;
    const dir = track?.dir ?? 0;
    for (const img of fgImages) {
      const rect = img.getBoundingClientRect(); // 含視差位移與翻轉
      if (rect.width === 0 || rect.height === 0) continue; // display: none（直向的窗櫺）
      const flipped = new DOMMatrixReadOnly(getComputedStyle(img).transform).a < 0;
      const opaque = opaqueBox({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, img.dataset.asset ?? '', flipped);
      const visible = clipBox(opaque, area); // 前景看得見的那一塊（景深層的矩形會裁掉超出去的部分）
      if (!visible) {
        img.removeAttribute('data-fg-hide');
        img.removeAttribute('data-fg-cut');
        continue;
      }
      // 現在相交（看得見的文字，含固定的）、提前量（只看會捲動的文字）、已經壓上來就直接切掉：見 dodgeDecision
      const { hide, cut } = dodgeDecision({ visible, area, moving, fixed, speed, dir, frameSeconds, margin: FG_MARGIN });
      img.toggleAttribute('data-fg-hide', hide);
      img.toggleAttribute('data-fg-cut', cut);
    }
    front.dataset.fgSync = String(Math.round(window.scrollY));
    front.setAttribute('data-fg-ready', '');
  };

  let frame = 0;
  /** 尾端重算：最後一個 scroll 事件之後 FG_SETTLE_MS 再算一格、速度歸零（突然停下時最後一格的速度不能一直留著讓前景躲著）。 */
  let settle = 0;
  let settled = false;
  const apply = (now: number): void => {
    frame = 0;
    const previous = track;
    track = settled && previous ? settleTrack(previous, window.scrollY, now) : trackScroll(track, window.scrollY, now);
    settled = false;
    const frameSeconds = previous ? (now - previous.t) / 1000 : 1 / 60;
    if (!reduced) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? window.scrollY / max : 0;
      for (const { el, kind } of layers) {
        const y = homeShift(kind, progress, window.innerHeight, false);
        el.style.transform = `translate3d(0px, ${Math.round(y * 10) / 10}px, 0)`;
      }
    }
    dodge(frameSeconds);
  };
  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(apply);
  };
  const onScroll = (): void => {
    schedule();
    window.clearTimeout(settle);
    settle = window.setTimeout(() => {
      settled = true;
      schedule();
    }, FG_SETTLE_MS);
  };
  const rebuild = (): void => {
    items = collectText();
    schedule();
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', rebuild, { passive: true });
  window.addEventListener('load', rebuild, { once: true });
  // 重新整理或從上一頁回來（瀏覽器還原捲動位置、bfcache）：再量一次
  window.addEventListener('pageshow', rebuild);
  // 文字的升起動畫（beat-text-in、opening-in）結束時位置變了，但不會有任何捲動或尺寸事件：載入時量的是動畫中途的位置，
  // 前景會停在「文字壓上來」的隱藏狀態（複審：桌機重新整理後還原到 scrollY 4500，窗櫺一直隱藏）。動畫結束就再算一格（animationend 沒有預設行為，不需要 passive）。
  document.addEventListener('animationend', schedule);
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
