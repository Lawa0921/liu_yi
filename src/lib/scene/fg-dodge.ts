/**
 * 首頁前景在文字經過時淡出的純函式（複審 Critical：前景在文字之上，捲動途中文字從前景底下經過會被蓋住）。
 * 前景（簷角、窗櫺）固定在視窗角落、蓋在海報與光點前面（`styles/depth.css`），所以不能留在文字上面：腳本（`scripts/home/depth.ts`）
 * 每一格量「前景不透明部分的外框」與「每個文字矩形」，有相交就把那一張前景淡出（`data-fg-hide`），文字走過去再淡入。
 * 這裡只放不碰 DOM 的部分，單元測試（tests/unit/fg-dodge.test.ts）守住；整體行為由 e2e 的連續捲動（home-depth.spec）驗。
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 每張前景「不透明部分」（原圖 alpha > 40 的像素範圍）的外框，占整張圖的比例；單元測試用真圖核對。 */
export const FG_OPAQUE_BOX: Record<string, { x0: number; x1: number; y0: number; y1: number }> = {
  // 簷角：原圖左側 38% 是空的（簷角從右上伸進來）
  'fg-eave': { x0: 582 / 1536, x1: 1, y0: 0, y1: 1 },
  'fg-lattice': { x0: 0, x1: 1, y0: 0, y1: 1 },
  'fg-steps': { x0: 0, x1: 1, y0: 8 / 302, y1: 1 },
  'fg-rack-close': { x0: 0, x1: 909 / 1536, y0: 8 / 825, y1: 1 },
};

/** 整張前景圖的矩形（已含視差位移與翻轉）→ 不透明部分的外框。`flipped`：scaleX(-1)，左右對調。沒有登記的素材保守地用整張圖。 */
export function opaqueBox(image: Box, asset: string, flipped: boolean): Box {
  const fraction = FG_OPAQUE_BOX[asset];
  if (!fraction) return { ...image };
  const width = image.right - image.left;
  const height = image.bottom - image.top;
  const x0 = flipped ? 1 - fraction.x1 : fraction.x0;
  const x1 = flipped ? 1 - fraction.x0 : fraction.x1;
  return { left: image.left + x0 * width, right: image.left + x1 * width, top: image.top + fraction.y0 * height, bottom: image.top + fraction.y1 * height };
}

/** 前景外框（往外加 `margin`）與任一文字矩形有面積相交（只是相切不算）。 */
export function overlapsAny(box: Box, texts: readonly Box[], margin: number): boolean {
  const left = box.left - margin;
  const right = box.right + margin;
  const top = box.top - margin;
  const bottom = box.bottom + margin;
  for (const text of texts) {
    if (Math.min(right, text.right) - Math.max(left, text.left) > 0 && Math.min(bottom, text.bottom) - Math.max(top, text.top) > 0) return true;
  }
  return false;
}
