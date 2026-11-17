/**
 * 形體配方：哪個形體 id 由什麼做出來（`scripts/qi/build-shapes.ts` 依它在建置時產生 `<id>.bin`）。
 *
 *   - `figure`：剪影取樣，`figure` 是 `FIGURES` 的鍵；比例照 `figureScale`（頭部對齊或 `scaleOverride`）。
 *   - `armed`：拳師持械（Task 27）：`config/armed.ts` 的 `ARMED[armed]`——剪影取樣（把剪影自己畫的細兵器剔掉）加入庫的 `.geo` 快照取樣的兵器幾何（D29，建置時不 import `weapons.ts`），
 *     兵器落在剪影的手上、方向與握法與剪影一致（`shapes/sample-armed.ts`）。世界座標與其他人形同一把尺（腳底 y = 0、中線 x = 0）；兵器點較密、較亮。
 *     取代了 Task 18 以來「單獨一把兵器」的單位形（使用者：苗刀、大槍等粒子應該要有人物拿著的感覺）。
 *   - `seal`：朱印遮罩 `src/assets/seal/seal-liuyi.png` 取樣（`KIND.SEAL`、深度很薄）。
 *   - `scroll`：攤開的竹簡（收費與課表段，Task 25）。程序化產生（`shapes/sample-scroll.ts`），沒有任何輸入檔，所以不含任何字；
 *     幾何見下方 `SCROLL`。`KIND.BAMBOO`（竹片）與 `KIND.DARK`（兩道綁繩）。
 *   - `crest`：燙金獅子館徽（預約段，Task 25）。由 Task 24 的透明底館徽 `src/assets/images/crest-lion.png` 依亮度取樣
 *     （`shapes/sample-crest.ts`；亮線多取、暗面少取）。`KIND.CREST`（金）。
 *   - `compose`：把幾個人形縮小、橫排成一個形體。`scale` 是「在該剪影自己的 `figureScale` 之上再乘的倍率」，
 *     `x` 是該人形外框中線在合成形體裡的世界 x；腳底全部落在 y = 0。三個軸一起縮（z 的厚度也乘 `scale`），小人形才是原形的相似形。
 *
 * 形體 id 就是 `.bin` 檔名，也是執行時 `load(id)`、靜態圖與姿勢表用的名字。
 */

export type ShapeRecipe =
  | { kind: 'figure'; figure: string }
  | { kind: 'armed'; armed: 'jian' | 'miaodao' | 'spear' | 'kid-weapon' | 'kid-miaodao' | 'kid-spear' }
  | { kind: 'seal' }
  | { kind: 'scroll' }
  | { kind: 'crest' }
  | { kind: 'compose'; parts: { figure: string; scale: number; x: number }[] };

/** 三件兵器的幾何快照（與 `src/qi/data/weapons/*.geo` 一一對應；持械形體 `armed` 用它們）。 */
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

export const SHAPES: Record<string, ShapeRecipe> = {
  lift: { kind: 'figure', figure: 'lift' },
  land: { kind: 'figure', figure: 'land' },
  dingzhou: { kind: 'figure', figure: 'dingzhou' },
  chengchui: { kind: 'figure', figure: 'chengchui' },
  kao: { kind: 'figure', figure: 'kao' },
  jian: { kind: 'armed', armed: 'jian' },
  miaodao: { kind: 'armed', armed: 'miaodao' },
  spear: { kind: 'armed', armed: 'spear' },
  salute: { kind: 'figure', figure: 'salute' },
  seal: { kind: 'seal' },
  scroll: { kind: 'scroll' },
  crest: { kind: 'crest' },
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
  'kid-weapon': { kind: 'armed', armed: 'kid-weapon' },
  'kid-miaodao': { kind: 'armed', armed: 'kid-miaodao' },
  'kid-spear': { kind: 'armed', armed: 'kid-spear' },
};
