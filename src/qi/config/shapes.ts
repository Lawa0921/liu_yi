/**
 * 形體配方：哪個形體 id 由什麼做出來（`scripts/qi/build-shapes.ts` 依它在建置時產生 `<id>.bin`）。
 *
 *   - `figure`：剪影取樣，`figure` 是 `FIGURES` 的鍵；比例照 `figureScale`（頭部對齊或 `scaleOverride`）。
 *   - `weapon`：入庫的 `.geo` 快照取樣（D29，建置時不 import `weapons.ts`），單位形（D13）。
 *   - `seal`：朱印遮罩 `src/assets/seal/seal-liuyi.png` 取樣（`KIND.SEAL`、深度很薄）。
 *   - `compose`：把幾個人形縮小、橫排成一個形體。`scale` 是「在該剪影自己的 `figureScale` 之上再乘的倍率」，
 *     `x` 是該人形外框中線在合成形體裡的世界 x；腳底全部落在 y = 0。三個軸一起縮（z 的厚度也乘 `scale`），小人形才是原形的相似形。
 *
 * 形體 id 就是 `.bin` 檔名，也是執行時 `load(id)`、靜態圖與姿勢表用的名字。
 */

export type ShapeRecipe =
  | { kind: 'figure'; figure: string }
  | { kind: 'weapon'; name: 'jian' | 'miaodao' | 'spear' }
  | { kind: 'seal' }
  | { kind: 'compose'; parts: { figure: string; scale: number; x: number }[] };

/** 三件兵器（與 `src/qi/data/weapons/*.geo` 一一對應）。 */
export const WEAPON_NAMES = ['jian', 'miaodao', 'spear'] as const;

/** 朱印的世界尺寸：遮罩全寬（512 px）對應的世界單位。比 land 的身高 2 略小，收成「一顆印」。 */
export const SEAL_WORLD_SIZE = 1.6;
/** 朱印中心的世界 y（與人形身高一半、兵器的中點高度同一帶，姿勢切換時光點不必上下大幅位移）。 */
export const SEAL_CENTER_Y = 1.0;

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
