/**
 * 取景（試作的值，原本寫在 `stage.ts` 的 `fit`）：橫向與直向各自決定人物佔畫面的大小與偏移。純函式，不碰 three／DOM。
 *
 * 抽出來的原因：持械形體的擺放（`shapes/expand.ts` 的 `armedLayout`）要知道「槍尖落在畫布寬的幾成處」，才能在寬螢幕上
 * 替右緣的段落導覽留位置（Task 22b）。這份取景同時決定海報（home.css）的人形位置，兩邊的數字由 e2e 量測對齊。
 */

export interface Framing {
  /** 鏡頭看到的世界高度。 */
  visibleH: number;
  /** 注視點（世界座標）；橫向往左移（人形偏右）、直向往下移（人形偏上）。 */
  lookX: number;
  lookY: number;
}

/**
 * `aspect` 是畫布的寬高比（相機要用它）；`portrait` 是版面的直／橫（`viewport.ts` 的 `isPortrait`，依視窗而不是畫布）。
 * 橫向：可視高 max(3.4, 5.9 ÷ aspect)，鏡頭往左移 13% 的可視寬（人形落在 63% 處）。
 * 直向：可視高 max(3.4, 2.75 ÷ aspect)，鏡頭往下移 13% 的可視高（人形落在約 37.8% 處）。
 */
export function framingFor(aspect: number, portrait: boolean): Framing {
  if (!portrait) {
    const visibleH = Math.max(3.4, 5.9 / aspect);
    return { visibleH, lookX: -visibleH * aspect * 0.13, lookY: 1.05 };
  }
  const visibleH = Math.max(3.4, 2.75 / aspect);
  return { visibleH, lookX: 0, lookY: 1.05 - visibleH * 0.13 };
}

/**
 * 兵器的右端要離畫布右緣至少這麼多 px（寬螢幕）：右緣的段落導覽距畫布右緣 58px（導覽 `right` ＝ 外框 inset ＋ 1.5rem，
 * 畫布右緣在外框 inset 之內；導覽寬約 34px），槍頭的光暈再向外約 40px，其餘約 22px 是餘裕（實測引擎讀回的最右光點，
 * 比這裡 z = 0 的推算再靠左約 1.5–2% 畫布寬，所以實際餘裕更大）。用 px 而不是比例：導覽的大小與位置不隨視窗放大，
 * 1920 寬的螢幕不必像 1024 寬的一樣把槍縮那麼多。e2e（screen-polish.spec）用引擎讀回的實際光點外框驗：
 * 1024、1280、1440、1920 寬都與導覽（外擴光暈）不相交。
 */
export const WEAPON_RIGHT_RESERVE_PX = 120;

/** 右端最多落在畫布寬的這個比例處的下限：太窄的畫布不要把兵器縮到沒有（`armedLayout` 要求上限是正數）。 */
const WEAPON_RIGHT_FRACTION_MIN = 0.7;

/**
 * 橫向取景下，兵器右端的世界 x 上限（`armedLayout` 的 `maxRight`）：投影後落在離畫布右緣 `WEAPON_RIGHT_RESERVE_PX` 處
 * （畫布寬 `widthPx` 是 CSS 像素）。
 */
export function weaponReachFor(aspect: number, widthPx: number): number {
  const { visibleH, lookX } = framingFor(aspect, false);
  const fraction = Math.max(WEAPON_RIGHT_FRACTION_MIN, 1 - WEAPON_RIGHT_RESERVE_PX / widthPx);
  return lookX + (fraction - 0.5) * visibleH * aspect;
}

/** 直向版面，持械形體離畫布左右緣各留這麼多（占畫布寬的比例）。 */
export const PORTRAIT_REACH_MARGIN = 0.04;

/**
 * 直向取景下，持械形體左右的世界 x 窗（`armedLayout` 的 `minLeft`／`maxRight`）：直向版面文字在下、光點在上，沒有段落導覽，
 * 窗就是畫布的左右緣（各留 `PORTRAIT_REACH_MARGIN`）；形體（人加兵器）比窗寬就整體縮進去（`expand.ts`）。
 */
export function portraitReachFor(aspect: number): { left: number; right: number } {
  const { visibleH, lookX } = framingFor(aspect, true);
  const half = (visibleH * aspect) / 2;
  return { left: lookX - half * (1 - 2 * PORTRAIT_REACH_MARGIN), right: lookX + half * (1 - 2 * PORTRAIT_REACH_MARGIN) };
}

/** 兵器的左端離文字右緣至少這麼多 px（槍尾與字之間留一點空）。 */
export const WEAPON_LEFT_MARGIN_PX = 24;

/**
 * 橫向取景下，兵器左端的世界 x 下限（`armedLayout` 的 `minLeft`）：投影後落在文字右緣（`textRightPx`，從畫布左緣起算的 CSS 像素）
 * 再加 `WEAPON_LEFT_MARGIN_PX` 處。`textRightPx` 是目前那一段**實際文字**的最右緣（頁面量每個文字節點的矩形，
 * `scripts/home/text-extent.ts`），不是整個文字欄的盒子：欄比字寬（35rem／44vw），用欄當界線，1440×900 的大槍會被縮到只剩約 540–620px。
 * 兵器置中在人形的位置，左端原本會伸進文字（近方形視窗、窄的橫向視窗）；超過界線的兵器整把往右推，窗放不下才縮（`expand.ts`）。
 */
export function weaponLeftFor(aspect: number, widthPx: number, textRightPx: number): number {
  const { visibleH, lookX } = framingFor(aspect, false);
  return lookX + ((textRightPx + WEAPON_LEFT_MARGIN_PX) / widthPx - 0.5) * visibleH * aspect;
}
