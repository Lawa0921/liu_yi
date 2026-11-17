/**
 * 非首頁的頁面光點層（Task 26，使用者要求「現在所有的特殊效果基本都在首頁，其他頁面也應該要做」）：每種頁面放什麼形體、放在哪裡。
 * 純資料與查表，不碰 three／DOM；Astro 元件（`components/QiBackdrop.astro`）與頁面腳本（`scripts/qi/page.ts`）共用。
 *
 * 放在哪裡（`canvas`）：
 *   - `rail`：桌機寬螢幕（`QI_RAIL_QUERY`）光點畫布就是內容右側的一欄（內容欄讓出位置，光點不在任何文字底下，隨頁面固定）；
 *     其他（手機、平板、近方形視窗）是頁面最上方的一條（頁首上方，隨頁面捲走，捲出視窗就暫停繪製）。
 *   - `field`：整張畫布（固定在視窗、在內容底下）。收費與課表的竹簡是低亮度背景，文字與海報圖浮在上面；課程總覽的氣流也是。
 * 形體擺在哪（`slot`）：`canvas` ＝ 整張畫布；`rail` ＝ 課程總覽（氣流是整張畫布的背景，滑過課程卡時才在右側欄聚成姿勢，所以另有一塊右側欄的槽）。
 */

import type { PoseId } from './poses';
import { FIGURE_WORLD, type SlotWorld } from '../engine/slot';

export type PageKind = 'courses' | 'course' | 'coaches' | 'coach' | 'facility' | 'pricing' | 'schedule' | 'lost';

export interface PageSpec {
  canvas: 'rail' | 'field';
  slot: 'canvas' | 'rail';
  /** 槽要放得下的世界大小（`engine/slot.ts`）。 */
  world: SlotWorld;
  /** 預設姿勢：靜態圖與引擎的第一個姿勢（課程頁依課程另算，見 `poseForCourse`）。`flow` ＝ 沒有形體的氣流（沒有靜態圖）。 */
  pose: PoseId;
}

/**
 * 院門（`gate` 形體）的槽：寬約 2.4、高約 1.0（`SHAPES.gate`），所以比人形的槽寬而矮。窗比院門大一圈：院門有厚度（z ±0.3），
 * 相機會轉一點點（呼吸、視差）、透視也讓近處的點放大，實測光點外框會比 z = 0 的推算寬約一成。
 */
export const GATE_WORLD: SlotWorld = { w: 2.9, h: 1.3, cy: 0.51 };
/**
 * 竹簡（收費、課表）的槽：高度決定大小（竹簡約 2.2 × 1.56），寬度給小一點——手機直向的畫布窄，竹簡就以高度為準、左右被裁掉；
 * 桌機寬螢幕也是以高度為準（竹簡占畫布高的九成多，文字與海報浮在上面）。
 */
export const SCROLL_WORLD: SlotWorld = { w: 0.6, h: 1.5, cy: 1.0 };

export const PAGES: Record<PageKind, PageSpec> = {
  courses: { canvas: 'field', slot: 'rail', world: FIGURE_WORLD, pose: 'flow' },
  course: { canvas: 'rail', slot: 'canvas', world: FIGURE_WORLD, pose: 'land' },
  coaches: { canvas: 'rail', slot: 'canvas', world: FIGURE_WORLD, pose: 'salute' },
  coach: { canvas: 'rail', slot: 'canvas', world: FIGURE_WORLD, pose: 'salute' },
  facility: { canvas: 'rail', slot: 'canvas', world: GATE_WORLD, pose: 'gate' },
  pricing: { canvas: 'field', slot: 'canvas', world: SCROLL_WORLD, pose: 'scroll' },
  schedule: { canvas: 'field', slot: 'canvas', world: SCROLL_WORLD, pose: 'scroll' },
  lost: { canvas: 'rail', slot: 'canvas', world: FIGURE_WORLD, pose: 'land' },
};

export const PAGE_KINDS = Object.keys(PAGES) as PageKind[];

/** 右側欄的條件：寬螢幕且不是近方形。CSS（`styles/qi-page.css`）與腳本（`matchMedia`）用同一條（單元測試守住兩邊一致）。 */
export const QI_RAIL_QUERY = '(min-width: 80rem) and (min-aspect-ratio: 4/3)';

/**
 * 課程頁（與課程總覽的課程卡）對應的姿勢：拳→定軸（`dingzhou`）、格鬥→撐捶（`chengchui`）、兵器→劍（`jian`）；
 * 兒童課用 `kid-*`（拳→`kid-wushu`、格鬥→`kid-defense-a`、兵器→`kid-weapon`）；其他課→`others`（四個小人形）。
 * 「不分對象」的課視為大人。
 */
export function poseForCourse(course: { category: 'weapon' | 'fist' | 'combat' | 'other'; audience: 'adult' | 'kid' | 'all' }): PoseId {
  const kid = course.audience === 'kid';
  switch (course.category) {
    case 'fist':
      return kid ? 'kid-wushu' : 'dingzhou';
    case 'combat':
      return kid ? 'kid-defense-a' : 'chengchui';
    case 'weapon':
      return kid ? 'kid-weapon' : 'jian';
    case 'other':
      return 'others';
  }
}

/** 光點層的頁面種類（`<main data-qi-page>`）是否合法；腳本讀屬性時用。 */
export function isPageKind(value: string | undefined): value is PageKind {
  return value !== undefined && Object.hasOwn(PAGES, value);
}
