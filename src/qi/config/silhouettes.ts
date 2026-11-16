/**
 * 剪影素材清單。值是 `src/assets/silhouettes/` 下的檔名（無副檔名）。
 * 每個名稱都要有 `<name>.png`、`<name>.webp` 與 `provenance.json` 的紀錄；
 * `tests/unit/silhouette-assets.test.ts` 對 READY 的每一張跑機械品管閘門（`scripts/qi/silhouette-qa.ts`）。
 */

/** 已核可：可直接在首頁使用。 */
export const SILHOUETTES_READY: string[] = ['fig-zhenjiao', 'fig-zhenjiao-land', 'fig-dingzhou', 'fig-chengchui', 'fig-kao'];

/** 待生成（Task 6–7）：過閘門、補上 provenance 後才移進 READY。 */
export const SILHOUETTES_PLANNED: string[] = ['fig-salute', 'fig-kid-wushu', 'fig-kid-defense-a', 'fig-kid-defense-b', 'fig-kid-weapon'];
