/**
 * 「槽」取景（Task 26，非首頁的頁面光點層）：形體不是依視窗寬高比擺在固定的位置，而是擺進頁面指定的一塊矩形（槽）。
 * 槽在畫布上的位置由頁面量（桌機寬螢幕是右側欄、窄螢幕是頁首上方的一條、竹簡背景是整張畫布），引擎只管把相機對準它。
 * 純函式，不碰 three／DOM。
 *
 *   - `world`：這個槽要放得下的世界大小（寬、高）與世界中心高度 `cy`。人形約 2.0 × 2.0（撐捶等寬架勢約 1.8 寬、站姿約 1.15 寬），
 *     中心高度 1.0；其他形體（竹簡、院門）由頁面給自己的大小。
 *   - 相機：每世界單位對到幾 px（`pxPerWorld`）取「槽的寬、高各自放得下 `world`」中較小的，再乘 `SLOT_FILL`（四周留一點空）；
 *     槽的中心對到世界的 (0, cy)（形體都以 x = 0 置中）。
 *   - 視窗（`halfWidth`、`halfHeight`）：槽在世界座標裡的半寬與半高（以 (0, cy) 為中心、已乘 `SLOT_FILL`）。形體比視窗大（兵器、合成形體）就縮進去
 *     （`shapes/expand.ts` 的 `Layout.window`、`others-layout.ts` 的 `othersFitWindow`）。
 */

import type { Framing } from './framing';

/** 畫布上的矩形（CSS 像素，相對畫布左上角）。 */
export interface SlotBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 槽要放得下的世界大小與中心高度。 */
export interface SlotWorld {
  w: number;
  h: number;
  cy: number;
}

/** 形體占槽的比例上限（四周留空，涵蓋光點的半徑與透視的誤差）。 */
export const SLOT_FILL = 0.92;

/** 人形的槽：站姿、撐捶、頂肘等架勢都放得下（最寬約 1.82、最高 2.0；寬度給 2.0，最寬的架勢占槽寬約 84%，光暈與兩側的邊緣淡化另外留在 `SLOT_FILL` 的邊內）。 */
export const FIGURE_WORLD: SlotWorld = { w: 2.0, h: 2.0, cy: 1.0 };

export interface SlotFrame {
  framing: Framing;
  /** 世界 1 個單位在螢幕上幾 px（z = 0 平面）。 */
  pxPerWorld: number;
  /** 槽在世界座標裡的半寬、半高（中心是 (0, cy)）。 */
  halfWidth: number;
  halfHeight: number;
  cy: number;
}

const positive = (v: number): boolean => Number.isFinite(v) && v > 0;

/** 依槽與畫布大小算取景；槽或畫布沒有大小（display:none、量不到）時回 `null`，呼叫端退回預設取景。 */
export function slotFrame(canvas: { w: number; h: number }, slot: SlotBox, world: SlotWorld): SlotFrame | null {
  if (!positive(canvas.w) || !positive(canvas.h) || !positive(slot.w) || !positive(slot.h) || !positive(world.w) || !positive(world.h)) return null;
  if (![slot.x, slot.y, world.cy].every(Number.isFinite)) return null;
  const pxPerWorld = Math.min((slot.w * SLOT_FILL) / world.w, (slot.h * SLOT_FILL) / world.h);
  const slotCx = slot.x + slot.w / 2;
  const slotCy = slot.y + slot.h / 2;
  return {
    framing: {
      visibleH: canvas.h / pxPerWorld,
      lookX: -(slotCx - canvas.w / 2) / pxPerWorld,
      lookY: world.cy - (canvas.h / 2 - slotCy) / pxPerWorld,
    },
    pxPerWorld,
    halfWidth: (slot.w * SLOT_FILL) / 2 / pxPerWorld,
    halfHeight: (slot.h * SLOT_FILL) / 2 / pxPerWorld,
    cy: world.cy,
  };
}

/** 視窗的鍵：視窗的大小（不含位置）變了才需要重新擺位兵器與合成形體；位置變了（頁首的槽隨捲動移動）只需要重新取景。 */
export function windowKey(frame: SlotFrame): string {
  return `${frame.halfWidth.toFixed(3)}x${frame.halfHeight.toFixed(3)}`;
}
