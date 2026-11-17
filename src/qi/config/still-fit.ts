/**
 * 靜態圖的取景規則（`scripts/qi/render-stills.ts`）與「靜態圖要放多大才與引擎的光點一樣大」的換算（Task 26）。
 *
 * 靜態圖把形體的 xy 外框置中、等比放大到佔滿影像的 `STILL_FIT_HEIGHT` 高或 `STILL_FIT_WIDTH` 寬（先到者為準）。
 * 所以每個形體在圖裡「每世界單位占圖高的倍率」`k` 都不同：`stillScale`。頁面光點層（`components/QiBackdrop.astro`）要讓靜態圖與引擎交叉淡化時
 * 人形一樣大：引擎每世界單位對到 `ppw` px，圖就該放到高 `ppw / k`（`styles/qi-page.css` 的 .qi-still）。
 * 純函式與常數，不碰 DOM／檔案；讀形體檔外框的部分在 `lib/still-fit.ts`。
 */

/** 形體外框占影像高度的上限。 */
export const STILL_FIT_HEIGHT = 0.8;
/** 形體外框占影像寬度的上限。 */
export const STILL_FIT_WIDTH = 0.88;

/**
 * 一張靜態圖「每世界單位占圖高的倍率」：形體外框（世界單位）`span`、影像寬高比 `imageAspect`（寬 ÷ 高）。
 * 外框退化（寬或高為 0）時以千分之一的最大邊代替，與 `renderStill` 一致。
 */
export function stillScale(span: { x: number; y: number }, imageAspect: number): number {
  const tiny = Math.max(span.x, span.y) * 1e-3;
  return Math.min((imageAspect * STILL_FIT_WIDTH) / Math.max(span.x, tiny), STILL_FIT_HEIGHT / Math.max(span.y, tiny));
}
