/**
 * 視窗尺寸變動要不要「重新取景」（RF1，純函式）。
 *
 * 手機網址列伸縮會讓 `innerHeight` 變動約 5–12%，這不該讓畫面閃一下：
 * 寬度不同（桌機拉窗口、轉向）一律重新取景；只有高度時，差距超過 18% 才算。
 * 取景＝重設 renderer／camera 尺寸與鏡頭擺位；**不重建模擬、不動粒子與目前姿勢**
 * （姿勢由捲動位置決定，輸入裡沒有視窗尺寸，所以轉向後仍是同一個姿勢）。
 *
 * `prev` 要傳「上一次取景用的尺寸」，不是上一個 resize 事件的尺寸；
 * 否則每次只變 7% 的連續抖動會累積過門檻、又永遠不被偵測到。
 */
export function viewportChanged(prev: { w: number; h: number }, next: { w: number; h: number }): boolean {
  if (prev.w !== next.w) return true;
  // 跨過直／橫的切換點：版面（CSS 的 @media (max-aspect-ratio: 4/5)）已經翻了，取景一定要跟著翻，即使高度只差一點
  if (isPortrait(prev.w, prev.h) !== isPortrait(next.w, next.h)) return true;
  if (!(prev.h > 0)) return next.h !== prev.h;
  return Math.abs(next.h - prev.h) > prev.h * 0.18;
}

/** 直向的切換點（寬 ÷ 高 ≤ 4/5）寫成 CSS 媒體查詢的樣子：`@media (max-aspect-ratio: ${PORTRAIT_ASPECT})`。 */
export const PORTRAIT_ASPECT = '4/5';

/**
 * 視窗是直向嗎：寬高比 ≤ 4:5（0.8）。首頁的版面（文字在左或在下）、海報人形的位置與引擎取景（`framing.ts`）都依它切換——
 * CSS 以 `@media (max-aspect-ratio: 4/5)` 表達同一條規則（home.css 與 Opening.astro 的 `<source media>`，單元測試守住兩邊一致），
 * 所以版面與取景不會各切各的：橫放手機、900×600、直式平板、近方形視窗（1000×1000、1024×1124）都落在同一邊。
 *
 * 輸入是視窗尺寸（`innerWidth × innerHeight`，與媒體查詢量的同一把尺），不是畫布尺寸：畫布扣掉外框的 inset／上下邊，
 * 它的寬高比與視窗的不同，用它切換會與 CSS 在邊界一帶對不上。以整數比較（寬 × 5 ≤ 高 × 4），與媒體查詢的比值比較一致。
 * 高度為 0 或非有限值當成橫向（取景有預設值可用，不崩潰）。
 */
export function isPortrait(w: number, h: number): boolean {
  return Number.isFinite(w) && Number.isFinite(h) && h > 0 && w * 5 <= h * 4;
}
