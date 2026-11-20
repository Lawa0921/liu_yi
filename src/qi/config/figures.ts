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
  /**
   * 原圖中的頭高（px）。多數是 `measureHeadHeight` 的實測值；lift／dingzhou／chengchui／kao 四張是由
   * `scaleOverride` 反推的值，不是實測（見 `FIGURES` 內註解）。
   */
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
  // headPx 141 是實測值。這張剪影約 8.5 頭身（落地那張約 6.4），照頭部對齊會得到 scale 1.28、世界身高 2.67，
  // 比 land 的 2.0 高三成（教練段的取景是照 2.0 左右的人形抓的），所以比照舊五張給 scaleOverride：
  // 0.96 讓世界身高 ≈ 1.99，與 land 相差 < 1%（控制者裁定；單元測試要求 ≤ 5%）。
  salute: { id: 'salute', src: 'fig-salute', headPx: 141, scaleOverride: 0.96, audience: 'both' },
  // 散手技擊（大人格鬥 combat-a，取代首頁的撐捶；第二式直拳業主 2026-11-20 要求刪掉）。
  // headPx 是 measureHeadHeight 的實測值（護拳貼在下巴前，頸谷量不準），所以比照 salute 給 scaleOverride：
  // 1 ＝與落地那張同一個像素尺度；護架主體 1115 px（land 1161 px），膝微屈的站姿約為 land 身高的 96%。
  guard: { id: 'guard', src: 'fig-guard', headPx: 114, scaleOverride: 1, audience: 'adult' },
  'kid-wushu': { id: 'kid-wushu', src: 'fig-kid-wushu', headPx: 158, audience: 'kid' },
  'kid-defense-a': { id: 'kid-defense-a', src: 'fig-kid-defense-a', headPx: 202, audience: 'kid' },
  'kid-defense-b': { id: 'kid-defense-b', src: 'fig-kid-defense-b', headPx: 177, audience: 'kid' },
  // 小孩持劍（fig-kid-weapon）是持械形體，比例與兵器的擺放在 `config/armed.ts`（headPx 171 是這裡原本的量測值）。
};

/** 這張圖要用的 scale（相對於落地那張）：有 `scaleOverride` 用它，否則頭部對齊。 */
export function figureScale(def: FigureDef, land: FigureDef): number {
  return def.scaleOverride ?? land.headPx / def.headPx;
}
