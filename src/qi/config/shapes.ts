/**
 * 形體配方：哪個形體 id 由什麼做出來（`scripts/qi/build-shapes.ts` 依它在建置時產生 `<id>.bin`）。
 *
 *   - `figure`：剪影取樣，`figure` 是 `FIGURES` 的鍵；比例照 `figureScale`（頭部對齊或 `scaleOverride`）。
 *   - `weapon`：入庫的 `.geo` 快照取樣（D29，建置時不 import `weapons.ts`），單位形（D13）。
 *   - `seal`：朱印遮罩 `src/assets/seal/seal-liuyi.png` 取樣（`KIND.SEAL`、深度很薄）。
 *   - `scroll`：攤開的竹簡（收費與課表段，Task 25）。程序化產生（`shapes/sample-scroll.ts`），沒有任何輸入檔，所以不含任何字；
 *     幾何見下方 `SCROLL`。`KIND.BAMBOO`（竹片）與 `KIND.DARK`（兩道綁繩）。
 *   - `crest`：燙金獅子館徽（預約段，Task 25）。由 Task 24 的透明底館徽 `src/assets/images/crest-lion.png` 依亮度取樣
 *     （`shapes/sample-crest.ts`；亮線多取、暗面少取）。`KIND.CREST`（金）。
 *   - `gate`：院門門樓（場地頁，Task 26）。由既有的剪影 `src/assets/silhouettes/bg-mid-gate.png` 取樣（走人形的取樣：內部金、輪廓亮，門洞是空的），
 *     世界寬 `GATE_WORLD_WIDTH`、腳底在 y = 0。
 *   - `compose`：把幾個人形縮小、橫排成一個形體。`scale` 是「在該剪影自己的 `figureScale` 之上再乘的倍率」，
 *     `x` 是該人形外框中線在合成形體裡的世界 x；腳底全部落在 y = 0。三個軸一起縮（z 的厚度也乘 `scale`），小人形才是原形的相似形。
 *
 * 形體 id 就是 `.bin` 檔名，也是執行時 `load(id)`、靜態圖與姿勢表用的名字。
 */

export type ShapeRecipe =
  | { kind: 'figure'; figure: string }
  | { kind: 'weapon'; name: 'jian' | 'miaodao' | 'spear' }
  | { kind: 'seal' }
  | { kind: 'scroll' }
  | { kind: 'crest' }
  | { kind: 'gate' }
  | { kind: 'compose'; parts: { figure: string; scale: number; x: number }[] };

/** 三件兵器（與 `src/qi/data/weapons/*.geo` 一一對應）。 */
export const WEAPON_NAMES = ['jian', 'miaodao', 'spear'] as const;

/** 朱印的世界尺寸：遮罩全寬（512 px）對應的世界單位。比 land 的身高 2 略小，收成「一顆印」。 */
export const SEAL_WORLD_SIZE = 1.6;
/** 朱印中心的世界 y（與人形身高一半、兵器的中點高度同一帶，姿勢切換時光點不必上下大幅位移）。 */
export const SEAL_CENTER_Y = 1.0;

/**
 * 竹簡的幾何（世界單位；人形身高 2、腳底 y = 0）。九到十三根直立竹片並排，上下兩道綁繩橫穿，兩端略捲：
 *   - `slats`：竹片數（需求 9–13）。每片寬 = 間距 × `fill`，其餘是縫；總寬 `width` 是攤平後的（兩端的捲再收窄一點）。
 *   - `cordAt`：兩道綁繩離中線的距離，占 `height` 的比例（上下對稱）；`cordThickness` 是繩粗。
 *   - `curledSlats`：兩端各有幾片向觀者捲起（`curlAngle`：最外緣捲到的角度，弧度）：捲起的部分在正面看起來被收窄、並往鏡頭凸出（z）。
 *   - `centerY`：竹簡中心的世界 y（與人形身高一半同一帶，換姿勢時光點不必上下大幅位移）。
 */
export const SCROLL = {
  slats: 11,
  width: 2.4,
  height: 1.5,
  fill: 0.84,
  cordAt: 0.3,
  cordThickness: 0.05,
  curledSlats: 2,
  curlAngle: 1.2,
  centerY: 1.0,
} as const;

/** 館徽圖（`src/assets/images/crest-lion.png`，Task 24 的成品）的寬高比（高 ÷ 寬）：960×920。 */
export const CREST_ASPECT = 920 / 960;
/** 光點館徽的世界寬度（約人形身高）：橫向版面約占畫面右側一塊（文字欄之外），直向約占畫布寬的 86%。 */
export const CREST_WORLD_WIDTH = 2.0;
export const CREST_WORLD_HEIGHT = CREST_WORLD_WIDTH * CREST_ASPECT;
/** 光點館徽中心的世界 y（與人形身高一半同一帶）。 */
export const CREST_CENTER_Y = 1.0;

/** 院門的世界寬度（Task 26）：剪影的不透明外框寬 1 151 px、高 489 px（比約 2.35：1），人形身高是 2。 */
export const GATE_WORLD_WIDTH = 2.4;
/** 院門的剪影：不是人形，沒有 `FIGURES` 的頭部對齊，直接指定比例（相對落地那張的 `WORLD_UNIT_PER_LAND_PX`）。 */
export const GATE_SILHOUETTE = 'bg-mid-gate';
/** 院門剪影的取樣比例：`GATE_WORLD_WIDTH / (1151 × WORLD_UNIT_PER_LAND_PX)`（`WORLD_UNIT_PER_LAND_PX` ＝ 2 / 1161）。 */
export const GATE_SCALE = GATE_WORLD_WIDTH / (1151 * (2 / 1161));

export const SHAPES: Record<string, ShapeRecipe> = {
  lift: { kind: 'figure', figure: 'lift' },
  land: { kind: 'figure', figure: 'land' },
  dingzhou: { kind: 'figure', figure: 'dingzhou' },
  chengchui: { kind: 'figure', figure: 'chengchui' },
  kao: { kind: 'figure', figure: 'kao' },
  jian: { kind: 'weapon', name: 'jian' },
  miaodao: { kind: 'weapon', name: 'miaodao' },
  spear: { kind: 'weapon', name: 'spear' },
  salute: { kind: 'figure', figure: 'salute' },
  seal: { kind: 'seal' },
  scroll: { kind: 'scroll' },
  crest: { kind: 'crest' },
  gate: { kind: 'gate' },
  // 四個小人形橫排：縮成 0.38 後各寬約 0.44／0.69／0.69／0.67、高約 0.76／0.55／0.59／0.46，
  // x 取使相鄰兩個之間約留 0.25 的空隙；總寬約 3.26，總寬 ÷ 總高 ≈ 4.3（需求 ≥ 2.5）。
  others: {
    kind: 'compose',
    parts: [
      { figure: 'land', scale: 0.38, x: -1.4 },
      { figure: 'dingzhou', scale: 0.38, x: -0.6 },
      { figure: 'chengchui', scale: 0.38, x: 0.35 },
      { figure: 'kao', scale: 0.38, x: 1.3 },
    ],
  },
  'kid-wushu': { kind: 'figure', figure: 'kid-wushu' },
  'kid-defense-a': { kind: 'figure', figure: 'kid-defense-a' },
  'kid-defense-b': { kind: 'figure', figure: 'kid-defense-b' },
  'kid-weapon': { kind: 'figure', figure: 'kid-weapon' },
};
