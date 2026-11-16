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
  if (!(prev.h > 0)) return next.h !== prev.h;
  return Math.abs(next.h - prev.h) > prev.h * 0.18;
}
