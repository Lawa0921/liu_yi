import { test as base } from '@playwright/test';

// 首頁有「入館閘門」（Task 25）：新的工作階段第一次進站，首頁會被全屏閘門擋住，要按「入館」才進得去。
// 絕大多數測試不是在測閘門，所以這裡的 `test` 預設把「這個工作階段進過館」標起來（sessionStorage 的 liuyi:qi-intro = '1'），
// 與使用者按過「入館」之後完全一樣的狀態——這些測試看到的首頁沒有閘門、也不演開場（與閘門出現之前的行為相同）。
//
// 要測閘門本身、或需要「第一次進站」（開場演出）的 spec（home-gate、home-crest、home-engine、home-fallback、visual、budget 的閘門測試）
// 直接用 `@playwright/test` 的 `test`，自己決定要不要標記（`seenSession`／`enterGate` 在 helpers.ts）。
export * from '@playwright/test';

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      try {
        sessionStorage.setItem('liuyi:qi-intro', '1');
      } catch {
        // 封鎖 storage 的測試自己處理
      }
    });
    await use(context);
  },
});

/** 沒有預設標記的原版 `test`（要在同一支 spec 裡同時測「進過館」與「第一次進站」時用）。 */
export const rawTest = base;
