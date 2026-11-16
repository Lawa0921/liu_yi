import { expect, test, type Response } from '@playwright/test';

const PAGES = [
  { name: '首頁', path: './' },
  { name: '課程總覽', path: './courses/' },
  { name: '收費', path: './pricing/' },
];

/**
 * 單一 woff2 的位元組上限（回應本身，不是壓縮後傳輸量）。
 * 簡報原訂 160 KB，但實測 729 個字的子集就有 361.9 KB（TW-Kai 每字約 0.5 KB，Astro 的本機字型是整檔下載、不分片），
 * 所以上限不是簡報的數字，而是「實測大小 × 1.1，向上取整到 KB」：Task 22 刪除 /lab/ 後重跑 `npm run fonts:subset`，
 * 子集由 787 字縮成 729 字、404 404 → 370 596 bytes（361.9 KB）；361.9 × 1.1 = 398.1 → 399 KB。
 * 字數再增加、子集長大超過 10% 就會紅燈，逼著重新檢討（改文案後 `fonts:subset` 的結果若變大，要有意識地調這個數字並寫明新的實測值）。
 */
const MAX_WOFF2_BYTES = 399 * 1024;

for (const { name, path } of PAGES) {
  test.describe(`字型（${name}）`, () => {
    test('TW-Kai 載入、標題用楷體且字重 400、沒有合成粗體、不向 Google 要字型、只下載一個 woff2', async ({ page }) => {
      const googleRequests: string[] = [];
      const woff2Responses: Response[] = [];
      page.on('request', (request) => {
        if (/fonts\.(gstatic|googleapis)\.com/.test(request.url())) googleRequests.push(request.url());
      });
      page.on('response', (response) => {
        if ((response.headers()['content-type'] ?? '').includes('font/woff2')) woff2Responses.push(response);
      });

      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);

      const loaded = await page.evaluate(() =>
        [...document.fonts].some((face) => /TW-Kai/.test(face.family) && face.status === 'loaded'),
      );
      expect(loaded, 'TW-Kai 沒有載入完成').toBe(true);

      const h1 = await page.locator('h1').first().evaluate((el) => {
        const style = getComputedStyle(el);
        return { family: style.fontFamily, weight: style.fontWeight };
      });
      // Astro 會在字型名稱後面加雜湊（TW-Kai-8f4e…），所以只比開頭。
      expect(h1.family).toMatch(/^"?TW-Kai/);
      expect(h1.weight).toBe('400');

      const synthesis = await page.evaluate(() => getComputedStyle(document.body).fontSynthesis);
      expect(synthesis).toContain('none');

      expect(googleRequests).toEqual([]);

      expect(woff2Responses).toHaveLength(1);
      const bytes = (await woff2Responses[0]!.body()).length;
      expect(bytes).toBeGreaterThan(0);
      expect(bytes).toBeLessThanOrEqual(MAX_WOFF2_BYTES);
    });
  });
}
