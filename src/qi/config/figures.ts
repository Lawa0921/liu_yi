/**
 * 人形剪影的比例設定（D12）：頭部大小對齊＋腳底對齊。
 *
 * `scale = land.headPx / def.headPx`：每張圖以「頭」為準對到落地那張（`land`），而不是用外框高度等比——
 * 蹲低的架勢外框矮，人並沒有變小。腳底對齊與外框中線對齊由 `shapes/sample-figure.ts` 處理。
 *
 * `headPx` ＝ 這張剪影原圖裡的頭高（px），由 `shapes/head.ts` 的 `measureHeadHeight` 量出（`tests/unit/qi-figures-config.test.ts`
 * 以量測值驗證，容許 12%）。量不準的圖手填，依據寫在各筆註解。
 */

export interface FigureDef {
  id: string;
  /** `src/assets/silhouettes/` 下的檔名，無副檔名。 */
  src: string;
  /** 原圖中的頭高（px）。 */
  headPx: number;
  /** 直接指定 scale（試作時由使用者看過核可的值），優先於頭部對齊。 */
  scaleOverride?: number;
  audience: 'adult' | 'kid' | 'both';
}

/** 落地那張（`land`）主體高 1161 px 對應世界身高 2（搬自試作的 WORLD_HEIGHT / REFERENCE_PX）。 */
export const WORLD_UNIT_PER_LAND_PX = 2 / 1161;

export const FIGURES: Record<string, FigureDef> = {
  // ── 試作的五張：scaleOverride 為原值（D12，使用者看過），headPx 見各筆註解 ──
  // 前傾、縮肩或手臂貼頭的架勢在列寬輪廓裡沒有頸谷，measureHeadHeight 在這四張量不準
  // （量測值：lift 103、dingzhou 84、chengchui 125、kao 286，與核可的視覺比例差 20–70%）。
  // 所以它們的 headPx 由核可過的 scaleOverride 反推（round(land.headPx / override)），
  // 是「與落地那張對齊時應有的頭高」，不是剪影自身實際的頭高；實際縮放以 scaleOverride 為準。
  lift: { id: 'lift', src: 'fig-zhenjiao', headPx: 177, scaleOverride: 1.02, audience: 'both' },
  // 側面站姿，頸谷緊貼領口，量得最準：其餘由量測決定的圖都以它為基準。
  land: { id: 'land', src: 'fig-zhenjiao-land', headPx: 181, scaleOverride: 1, audience: 'both' },
  dingzhou: { id: 'dingzhou', src: 'fig-dingzhou', headPx: 145, scaleOverride: 1.25, audience: 'adult' },
  chengchui: { id: 'chengchui', src: 'fig-chengchui', headPx: 153, scaleOverride: 1.18, audience: 'adult' },
  kao: { id: 'kao', src: 'fig-kao', headPx: 162, scaleOverride: 1.12, audience: 'adult' },

  // ── 新增的剪影（Task 6–7）：headPx 為 measureHeadHeight 的四捨五入值 ──
  // 正面像：頸最窄處（量測值 141）落在頸的中段，而側面像的頸谷貼著領口（land：谷在肩線上方 23 px，這張是 44 px），
  // 量法本身偏高約半個頸長；取 150（比量測值高 6%，在 12% 閘門內）。
  // 這張剪影約 8.5 頭身（落地那張約 6.4），頭部對齊後世界身高約 2.5，比 land 的 2.0 高。
  salute: { id: 'salute', src: 'fig-salute', headPx: 150, audience: 'both' },
  'kid-wushu': { id: 'kid-wushu', src: 'fig-kid-wushu', headPx: 158, audience: 'kid' },
  'kid-defense-a': { id: 'kid-defense-a', src: 'fig-kid-defense-a', headPx: 202, audience: 'kid' },
  'kid-defense-b': { id: 'kid-defense-b', src: 'fig-kid-defense-b', headPx: 177, audience: 'kid' },
  'kid-weapon': { id: 'kid-weapon', src: 'fig-kid-weapon', headPx: 171, audience: 'kid' },
};

/** 這張圖要用的 scale（相對於落地那張）：有 `scaleOverride` 用它，否則頭部對齊。 */
export function figureScale(def: FigureDef, land: FigureDef): number {
  return def.scaleOverride ?? land.headPx / def.headPx;
}
