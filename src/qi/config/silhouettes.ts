/**
 * 剪影素材清單。值是 `src/assets/silhouettes/` 下的檔名（無副檔名）。
 * 每個名稱都要有 `<name>.png`、`<name>.webp` 與 `provenance.json` 的紀錄；
 * `tests/unit/silhouette-assets.test.ts` 對 READY 的每一張跑機械品管閘門（`scripts/qi/silhouette-qa.ts`）。
 */

/** 已核可：可直接在首頁使用。 */
export const SILHOUETTES_READY: string[] = [
  'fig-zhenjiao',
  'fig-zhenjiao-land',
  'fig-dingzhou',
  'fig-chengchui',
  'fig-kao',
  'fig-kid-wushu',
  'fig-kid-defense-a',
  'fig-kid-defense-b',
  'fig-kid-weapon',
  'fig-salute',
  // Task 27：兵器三段改成拳師持械（`config/armed.ts`），這三張剪影（人本來就拿著兵器）升格；provenance 是 legacy（Task 6 之前就入庫、原圖備份在本機快取）
  'fig-jian',
  'fig-miaodao',
  'fig-daqiang',
  // Task 27 追加（使用者：苗刀和大槍的區塊沒有小孩版）：小孩持刀、持槍
  'fig-kid-miaodao',
  'fig-kid-daqiang',
  // 散手技擊：大人格鬥兩式改成拳擊／散打的護架與直拳（fig-jab 目前是預覽佔位，provenance 狀態 placeholder，待重生）
  'fig-guard',
  'fig-jab',
];

/** 待生成：過閘門、補上 provenance 後才移進 READY。目前沒有待生成的剪影。 */
export const SILHOUETTES_PLANNED: string[] = [];
