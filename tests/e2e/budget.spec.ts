import { expect, rawTest, test, type Page } from './fixtures';
import { totalBytes, trackTransfers } from './helpers';

// 首頁傳輸量預算（Task 23；設計 §5、決定 D28）：
//   - 首屏：載入到 html[data-qi-ready]、尚未捲動為止，≤ 1.5 MB（硬門檻；> 1.3 MB 只記警示，目標未達不算失敗）。
//     three 的 chunk 與引擎 chunk 在首屏內（ready 之前已載）；新 context（開場待演）只抓 land、lift 兩個形體。
//   - 整頁：每 700 px 往下捲到底（每一步等 networkidle），切到「小孩」再捲一次，累計 ≤ 5 MB。
//   - 沒有 3D 的頁面不載入 three、也不載入引擎。
// 量測用「真實預設 tier」（不帶 ?qi-tier）：桌機寬 ≥ 960 起於 high，手機起於 low；用真實時鐘，不裝假時鐘。
// 數字是未壓縮的 decoded bytes（`trackTransfers` 慣例；靜態伺服器不壓縮，GitHub Pages 會 gzip，所以是保守上限）。
// 只用 page.*，不碰 OS 層級的滑鼠鍵盤。
test.describe.configure({ mode: 'default', timeout: 240_000 });

const MB = 1024 * 1024;
const FIRST_SCREEN_LIMIT = 1.5 * MB;
const FIRST_SCREEN_TARGET = 1.3 * MB;
const FULL_PAGE_LIMIT = 5 * MB;
/** 軟體 GL 上建出高階 tier 的 GPGPU 要花一陣子。 */
const READY = { timeout: 90_000 };

const DEVICES = [
  { name: '桌機 1440×900', viewport: { width: 1440, height: 900 } },
  { name: '手機 390×844', viewport: { width: 390, height: 844 } },
];

type Transfer = ReturnType<typeof trackTransfers>[number];

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const mb = (bytes: number) => `${(bytes / MB).toFixed(3)} MB`;
const fileName = (url: string) => new URL(url).pathname.split('/').pop() ?? url;

/** 依資源類型加總（報告用）。 */
function breakdown(transfers: Transfer[]): string {
  const byType = new Map<string, number>();
  for (const item of transfers) byType.set(item.type, (byType.get(item.type) ?? 0) + item.bytes);
  return [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, bytes]) => `${type} ${kb(bytes)}`)
    .join('、');
}

/** 最大的幾個回應（報告用）。 */
function biggest(transfers: Transfer[], count = 6): string {
  return [...transfers]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, count)
    .map((item) => `${fileName(item.url)} ${kb(item.bytes)}`)
    .join('、');
}

/** 等「已記錄的回應」追上瀏覽器已收到的回應（`trackTransfers` 要等 body 讀完才記，會比事件晚幾毫秒）。 */
const settleRecording = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));

for (const device of DEVICES) {
  rawTest.describe(`首屏傳輸量：${device.name}`, () => {
    rawTest.use({ viewport: device.viewport });

    rawTest('載入到 data-qi-ready（未捲動）：≤ 1.5 MB；three 與引擎 chunk 已載；新 context 只抓 land、lift 兩個 .bin', async ({ page }) => {
      const transfers = trackTransfers(page);
      await page.goto('./');
      // ready（光點引擎接手）或 static（退回靜態圖）才算首屏載完
      await page.waitForFunction(
        () => document.documentElement.hasAttribute('data-qi-ready') || document.documentElement.dataset.qiMode === 'static',
        undefined,
        READY,
      );
      await settleRecording(page);
      const first = [...transfers]; // 此刻起不再累計：之後的請求（預取）不算首屏

      expect(await page.evaluate(() => window.scrollY), '量測時尚未捲動').toBe(0);
      const mode = await page.locator('html').getAttribute('data-qi-mode');
      expect(mode, '預設 tier 下引擎要真的接手（退回靜態圖就量不到光點路徑的傳輸量）').not.toBe('static');
      await expect(page.locator('html')).toHaveAttribute('data-qi-ready', 'true');

      const bytes = totalBytes(first);
      const tier = await page.locator('html').getAttribute('data-qi-tier');
      test.info().annotations.push({
        type: 'first-screen-bytes',
        description: `${mb(bytes)}（${bytes} B）＝ ${breakdown(first)}；tier ${tier}；最大：${biggest(first)}`,
      });
      if (bytes > FIRST_SCREEN_TARGET) {
        test.info().annotations.push({
          type: 'warning',
          description: `首屏 ${mb(bytes)} 超過目標 1.3 MB（硬門檻 1.5 MB 內，不算失敗）`,
        });
      }
      expect(bytes, `首屏 ${mb(bytes)} 不得超過 1.5 MB；最大的回應：${biggest(first)}`).toBeLessThanOrEqual(FIRST_SCREEN_LIMIT);

      // 入館閘門（Task 25）：第一次進站首頁先蓋著閘門（量到的就是使用者真實的第一次造訪）。閘門沿用 Task 24 的館徽圖（同一個來源、同樣的候選寬度，
      // DPR ≥ 2 的裝置與開場區共用同一個檔案），不得再下載別的大檔：館徽圖最多兩個（開場區一個、閘門一個），合計 ≤ 80 KB。
      await expect(page.locator('html'), '前提：第一次進站，閘門擋著').toHaveAttribute('data-gate', 'open');
      const crestImages = first.filter((item) => /crest-lion[^/]*\.webp(\?|$)/.test(item.url));
      test.info().annotations.push({
        type: 'gate-crest-bytes',
        description: `${crestImages.length} 張：${crestImages.map((item) => `${fileName(item.url)} ${kb(item.bytes)}`).join('、')}（合計 ${kb(totalBytes(crestImages))}）`,
      });
      expect(crestImages.length, '館徽圖最多兩個候選（開場區與閘門）').toBeLessThanOrEqual(2);
      expect(crestImages.length, '閘門的館徽有載入').toBeGreaterThanOrEqual(1);
      expect(totalBytes(crestImages), '館徽圖合計').toBeLessThanOrEqual(80 * 1024);

      // three 與引擎 chunk 都在 ready 之前載完
      const three = first.filter((item) => /\/three\.module[^/]*\.js(\?|$)/.test(item.url));
      const engine = first.filter((item) => /\/qi-stage[^/]*\.js(\?|$)/.test(item.url));
      expect(three, 'three 的 chunk 在首屏內').toHaveLength(1);
      expect(engine, '引擎（qi-stage）的 chunk 在首屏內').toHaveLength(1);
      test.info().annotations.push({
        type: 'chunks',
        description: `three ${kb(three[0]!.bytes)}、qi-stage ${kb(engine[0]!.bytes)}`,
      });

      // 新 context＝這個工作階段還沒看過開場：只預取 land（落地）與 lift（吸氣）
      const bins = first.filter((item) => /\.bin(\?|$)/.test(item.url));
      const binNames = bins.map((item) => fileName(item.url).split('.')[0]);
      test.info().annotations.push({ type: 'bins', description: `${bins.length} 個：${binNames.join('、')}（${kb(totalBytes(bins))}）` });
      expect(bins.length, `首屏的 .bin：${binNames.join('、')}`).toBeLessThanOrEqual(3);
      expect(binNames, '含落地').toContain('land');
      expect(binNames, '含吸氣').toContain('lift');
    });
  });
}

/** 每 700 px 往下捲到頁底，每一步等 networkidle；回傳捲了幾步。 */
async function scrollThrough(page: Page): Promise<number> {
  let steps = 0;
  for (;;) {
    const done = await page.evaluate((step) => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const next = Math.min(window.scrollY + step, max);
      window.scrollTo(0, next);
      return next >= max;
    }, 700);
    steps++;
    await page.waitForLoadState('networkidle');
    if (done) return steps;
    if (steps > 200) throw new Error('scrollThrough did not reach the bottom in 200 steps');
  }
}

for (const device of DEVICES) {
  test.describe(`整頁傳輸量：${device.name}`, () => {
    test.use({ viewport: device.viewport });

    test('每 700 px 捲到底，切到小孩再捲一次：累計 ≤ 5 MB', async ({ page }) => {
      const transfers = trackTransfers(page);
      await page.goto('./');
      await page.waitForFunction(
        () => document.documentElement.hasAttribute('data-qi-ready') || document.documentElement.dataset.qiMode === 'static',
        undefined,
        READY,
      );

      const adultSteps = await scrollThrough(page);
      await settleRecording(page);
      const afterAdult = totalBytes(transfers);

      // 切到小孩：先捲到課程段（切換鈕黏在課程段內），按下去，再回到頁首重捲一次
      await page.evaluate(() => document.querySelector('#courses')!.scrollIntoView());
      await page.getByRole('button', { name: '小孩' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-audience', 'kid');
      await page.evaluate(() => window.scrollTo(0, 0));
      const kidSteps = await scrollThrough(page);
      await settleRecording(page);

      const bytes = totalBytes(transfers);
      const bins = transfers.filter((item) => /\.bin(\?|$)/.test(item.url));
      test.info().annotations.push({
        type: 'full-page-bytes',
        description:
          `${mb(bytes)}（${bytes} B）；大人捲完 ${mb(afterAdult)}（${adultSteps} 步）、小孩再捲 ${kidSteps} 步；` +
          `${breakdown(transfers)}；.bin ${bins.length} 個 ${kb(totalBytes(bins))}；最大：${biggest(transfers)}`,
      });
      expect(bytes, `整頁累計 ${mb(bytes)} 不得超過 5 MB；最大的回應：${biggest(transfers)}`).toBeLessThanOrEqual(FULL_PAGE_LIMIT);
    });
  });
}

// 沒有 3D 的頁面（收費、課表、場地）：不載入 three，也不載入首頁引擎與形體（沿用 arsenal.spec 的舊斷言，換成整頁都不載）。
test.describe('沒有 3D 的頁面不載入 three', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const path of ['./pricing/', './schedule/', './facility/']) {
    test(`${path} 完全不載入 three、引擎與形體`, async ({ page }) => {
      const transfers = trackTransfers(page);
      await page.goto(path);
      await scrollThrough(page);
      await settleRecording(page);
      expect(transfers.filter((item) => /\/three\.module[^/]*\.js(\?|$)/.test(item.url)).map((item) => item.url), 'three').toEqual([]);
      expect(transfers.filter((item) => /\/qi-stage[^/]*\.js(\?|$)/.test(item.url)).map((item) => item.url), '引擎').toEqual([]);
      expect(transfers.filter((item) => /\.bin(\?|$)/.test(item.url)).map((item) => item.url), '形體').toEqual([]);
      await expect(page.locator('html')).not.toHaveAttribute('data-three', /.+/);
      await expect(page.locator('html')).not.toHaveAttribute('data-qi-ready', /.*/);
      const scripts = transfers.filter((item) => item.type === 'script');
      expect(Math.max(0, ...scripts.map((item) => item.bytes)), '最大的 script 不到 250 KB').toBeLessThan(250_000);
    });
  }
});
