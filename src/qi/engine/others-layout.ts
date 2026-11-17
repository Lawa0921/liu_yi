/**
 * others（四個小人形）的排列決定（Task 23 修正 R1）：依畫布大小與文字位置，決定 `shapes/arrange.ts` 的排法與平移。純函式。
 *
 *   - 橫向：同一排，放大到 `OTHERS_LANDSCAPE.scale`、空隙收到 `gap`（總寬與配方的橫排差不多，只是人形高了約 15%：
 *     人形外框高占畫布高原本只有約 23%，過不了「蹲低架勢與 others 至少 25%」）。腳底在 y = 0（與其他姿勢同一條腳底線）、置中在 x = 0。
 *   - 直向：2×2。配方的橫排總寬約 3.26 世界單位，比直向的可視寬（固定 2.75，`framing.ts`）還寬，整排會被畫布裁掉；
 *     2×2 縮放到可視寬度內，並擺在文字上方：下緣離文字上緣 `OTHERS_TEXT_GAP_PX`、上緣離畫布上緣 `OTHERS_MARGIN_PX`，
 *     在這一段空間裡盡量放大（上限 `OTHERS_MAX_SCALE`），放不下就縮（下限 `OTHERS_MIN_SCALE`）。
 *     文字上緣（`textTop`，從畫布上緣起算的 CSS 像素）由呼叫端量；沒給（harness、量不到）就把腳底放在 y = 0 的腳底線上。
 *
 * 像素與世界座標的換算用 `framing.ts` 的取景在 z = 0 平面的線性推算（與兵器的左右界同一種近似）；
 * 邊界留 `OTHERS_MARGIN_PX`（比 e2e 要求的 8 px 多一些，涵蓋光點的半徑與透視的誤差）。
 */

import { arrangedSize, type Arrangement, type FigureBox, type Offset } from '../shapes/arrange';
import { framingFor } from './framing';

/** 橫向：放大倍率與人形之間的空隙（世界單位）。 */
export const OTHERS_LANDSCAPE = { scale: 1.15, gap: 0.13 } as const;
/** 直向：同一排相鄰人形與上下兩排之間的空隙（世界單位）。 */
const PORTRAIT_GAP = 0.15;
const PORTRAIT_ROW_GAP = 0.15;
/**
 * 直向：離畫布左右與上緣至少這麼多 px，下緣離文字上緣至少這麼多 px。
 * 有最小值（手機）也有隨畫布的比例（平板）：z = 0 的線性推算與實際投影（透視、相機略高）差約畫布尺寸的 2%，
 * 畫布大了這個差就不只幾 px（1024×1366 的平板實測差約 25 px），所以邊界要跟著畫布放大。
 */
export const OTHERS_MARGIN_PX = 14;
export const OTHERS_TEXT_GAP_PX = 20;
const MARGIN_RATIO = 0.02;
const TEXT_GAP_RATIO = 0.03;
export const othersMarginFor = (cssWidth: number, cssHeight: number): number => Math.max(OTHERS_MARGIN_PX, MARGIN_RATIO * Math.min(cssWidth, cssHeight));
export const othersTextGapFor = (cssHeight: number): number => Math.max(OTHERS_TEXT_GAP_PX, TEXT_GAP_RATIO * cssHeight);
/** 直向：倍率的上下限（相對配方大小）。 */
export const OTHERS_MAX_SCALE = 1.6;
export const OTHERS_MIN_SCALE = 0.4;

export interface OthersFitInput {
  /** 四個人形的外框（`measureFigures`）。 */
  boxes: readonly FigureBox[];
  portrait: boolean;
  /** 畫布的 CSS 像素大小。 */
  cssWidth: number;
  cssHeight: number;
  /** 直向：文字上緣（從畫布上緣起算的 CSS 像素）。 */
  textTop?: number;
}

export interface OthersFit {
  arrangement: Arrangement;
  offset: Offset;
}

export function othersFit(input: OthersFitInput): OthersFit {
  const { boxes, portrait, cssWidth, cssHeight } = input;
  if (!portrait) {
    return {
      arrangement: { rows: [[0, 1, 2, 3]], scale: OTHERS_LANDSCAPE.scale, gap: OTHERS_LANDSCAPE.gap, rowGap: 0 },
      offset: { x: 0, y: 0 },
    };
  }

  const rows = [[0, 1], [2, 3]];
  const frame = framingFor(cssWidth / cssHeight, true);
  const pxPerWorld = cssHeight / frame.visibleH;
  const textTop = Number.isFinite(input.textTop) ? input.textTop : undefined;
  const margin = othersMarginFor(cssWidth, cssHeight);
  const baselinePx = cssHeight * (0.5 + frame.lookY / frame.visibleH); // y = 0（其他姿勢的腳底線）落在畫布的哪個 y
  const bottomPx = textTop === undefined ? baselinePx : textTop - othersTextGapFor(cssHeight);
  const roomWidth = (cssWidth - 2 * margin) / pxPerWorld;
  const roomHeight = (bottomPx - margin) / pxPerWorld;

  // 在 scale = 1 量各排的寬與高，反推放得下的最大倍率（空隙不隨倍率變）
  const unit: Arrangement = { rows, scale: 1, gap: PORTRAIT_GAP, rowGap: PORTRAIT_ROW_GAP };
  const rowWidths = rows.map((row) => row.reduce((sum, k) => sum + (boxes[k]!.maxX - boxes[k]!.minX), 0));
  const rowHeights = rows.map((row) => Math.max(...row.map((k) => boxes[k]!.maxY - boxes[k]!.minY)));
  const byWidth = Math.min(...rows.map((row, r) => (roomWidth - (row.length - 1) * PORTRAIT_GAP) / rowWidths[r]!));
  const byHeight = (roomHeight - (rows.length - 1) * PORTRAIT_ROW_GAP) / rowHeights.reduce((sum, h) => sum + h, 0);
  const scale = Math.min(OTHERS_MAX_SCALE, Math.max(OTHERS_MIN_SCALE, Math.min(byWidth, byHeight)));

  const arrangement: Arrangement = { ...unit, scale };
  const height = arrangedSize(boxes, arrangement).height;
  const bottomY = frame.lookY + (0.5 - bottomPx / cssHeight) * frame.visibleH; // 下緣的世界 y
  // 有文字：在「畫布上緣到文字上緣」的空間裡上下置中；放不下（縮到下限了，例如 320×568 的小手機）就把上緣貼在畫布上緣的邊界上：
  // 寧可往下壓到文字（人形在文字後面，仍看得到），也不要被畫布裁掉。
  const spare = textTop === undefined ? 0 : Math.max(0, roomHeight - height);
  const topY = frame.lookY + (0.5 - margin / cssHeight) * frame.visibleH; // 畫布上緣邊界的世界 y
  return { arrangement, offset: { x: 0, y: Math.min(bottomY + spare / 2, topY - height) } };
}
