// 切換「大人｜小孩」時的捲動定位。
//
// 有些 beat 只屬於某一個對象（poses.ts 的 BEAT_ONLY_FOR：業主 2026-11-20 刪掉大人的直拳，格鬥第二段只剩小孩）。
// 切到另一個對象時那一段整段收起（display: none，高度 0）；若畫面正停在那一段，視窗中央會落到下一段（兵器），等於被往後跳了一段。
// 這裡在切換後把畫面移回往前最近、仍顯示的那一段的中央（格鬥的護架），讓使用者留在同一個分類。
// 其他情況（停在兩個對象都有的段落）不動：段落在畫面上方收起或出現時，瀏覽器的捲動錨定會讓目前這一段留在原處。
//
// 不依賴光點引擎：減少動態、沒有 WebGL 的靜態圖模式也要有同樣的行為。
// 必須在 init-home 之前掛上：MutationObserver 依建立順序回呼，引擎的對象切換處理要讀到移動後的捲動位置。
// 這個檔案會被打進首頁的腳本：程式字串只用英文。

import { BEATS, type BeatId } from '../../qi/config/poses';
import type { BeatRect } from '../../qi/engine/scroll-model';
import { observeAudience } from './audience-sync';
import { readBeatRects } from './beats';

const KNOWN = new Set<string>(BEATS);

/**
 * 切換後要捲到哪裡（文件座標的 scrollY）；不需要移動時回 undefined。
 * `beats` 是切換「之後」的版面（只屬於原對象的段落高度已是 0），`was` 是切換之前視窗中央的那一段。
 */
export function anchorScrollY(beats: readonly BeatRect[], was: BeatId | undefined, viewportH: number): number | undefined {
  if (was === undefined) return undefined;
  const at = beats.findIndex((beat) => beat.id === was);
  if (at < 0 || beats[at]!.height > 0) return undefined;
  for (let i = at - 1; i >= 0; i--) {
    const beat = beats[i]!;
    if (beat.height > 0) return Math.max(0, Math.round(beat.top + beat.height / 2 - viewportH / 2));
  }
  return undefined;
}

export function initAudienceAnchor(): void {
  const main = document.querySelector<HTMLElement>('main[data-home]');
  if (!main || typeof IntersectionObserver === 'undefined') return;

  // 視窗正中央目前是哪一段（同 depth.ts 的作法：根區域縮成正中央一條線）
  let centered: BeatId | undefined;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.beat;
        if (entry.isIntersecting && id !== undefined && KNOWN.has(id)) centered = id as BeatId;
      }
    },
    { rootMargin: '-50% 0px -50% 0px' },
  );
  for (const beat of main.querySelectorAll('[data-beat]')) observer.observe(beat);

  observeAudience(() => {
    const top = anchorScrollY(readBeatRects(main, window.scrollY), centered, window.innerHeight);
    if (top !== undefined) window.scrollTo({ top, behavior: 'instant' });
  });
}
