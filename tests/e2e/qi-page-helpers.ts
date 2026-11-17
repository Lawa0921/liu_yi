import { expect, type Page } from './fixtures';
import type { QiDebug } from '../../src/qi/engine/qi-stage';
import { boxOf, overlapOfBox, type Box } from './helpers';

// 非首頁的頁面光點層（Task 26）的 e2e 共用輔助：qi-pages.spec（課程總覽與課程內頁）與 qi-pages-site.spec（師資、教練、場地、收費、課表、404）。
// headless 的 WebGL 是軟體繪製：一律 ?qi-tier=min&qi-debug=1（量亮度的測試例外，要看真實的預設 tier）；只用 page.*，不碰 OS 層級的滑鼠鍵盤。

export const QUERY = '?qi-tier=min&qi-debug=1';
export const READY = { timeout: 60_000 };
/** 軟體 GL（SwiftShader）在讀回像素時印的效能提示；已知的雜訊，其餘 warning 一律不允許。 */
export const KNOWN_WARNING = /GPU stall due to ReadPixels/;

export type W = { __qi: { ready: boolean; frames: number; tier: string; mode: string; debug: QiDebug } };

interface Seen {
  errors: string[];
  warnings: string[];
  /** 這個測試刻意製造的錯誤（其餘一律不允許）。 */
  allowErrors: RegExp[];
}
const seen = new WeakMap<Page, Seen>();

export function watch(page: Page): Seen {
  const log: Seen = { errors: [], warnings: [], allowErrors: [] };
  seen.set(page, log);
  page.on('pageerror', (error) => log.errors.push(`pageerror: ${error}`));
  page.on('console', (message) => {
    if (message.type() === 'error') log.errors.push(`console.error: ${message.text()}`);
    if (message.type() === 'warning') log.warnings.push(`console.warning: ${message.text()}`);
  });
  return log;
}

/** 放進 `test.afterEach`：頁面全程不得有 pageerror、console.error 或 console.warning（已知的軟體繪製提示與測試刻意製造的除外）。 */
export async function expectClean(page: Page): Promise<void> {
  const log = seen.get(page);
  if (!log) return;
  expect(log.errors.filter((e) => !log.allowErrors.some((re) => re.test(e))), '頁面全程不得有 pageerror 或 console.error').toEqual([]);
  expect(log.warnings.filter((w) => !KNOWN_WARNING.test(w)), '頁面全程不得有 console.warning（軟體繪製的 ReadPixels 效能提示除外）').toEqual([]);
}

/** 這個頁面已經有記錄就沿用（測試先 `watch` 並登記允許的錯誤，之後 `open` 不能把它洗掉），否則新開一份。 */
export const ensureWatch = (page: Page): Seen => seen.get(page) ?? watch(page);

export const html = (page: Page) => page.locator('html');

/** 開頁面、等引擎 ready。`query` 預設 `QUERY`（最低一級）。 */
export async function open(page: Page, path: string, query: string = QUERY): Promise<Seen> {
  const log = ensureWatch(page);
  await page.goto(`${path}${query}`);
  await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
  return log;
}

export const meanError = (page: Page) => page.evaluate(() => (window as unknown as W).__qi.debug.meanError());
export const extent = (page: Page) => page.evaluate(() => (window as unknown as W).__qi.debug.extent());
export const draws = (page: Page) => page.evaluate(() => (window as unknown as W).__qi.debug.draws());
export const pose = (page: Page) => page.evaluate(() => (window as unknown as W).__qi.debug.pose());
export const pulses = (page: Page) => page.evaluate(() => (window as unknown as W).__qi.debug.pulseCount());
export const scatterOf = async (page: Page) => Number(await html(page).getAttribute('data-qi-scatter'));

/** 光點聚合之後（讀回的平均誤差夠小）才量外框：量到的是姿勢的外框，不是飛行中的光點。 */
export async function settledExtent(page: Page): Promise<Box> {
  await expect.poll(() => meanError(page), { timeout: 60_000, message: '光點聚成形體' }).toBeLessThan(0.05);
  const box = await extent(page);
  return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
}

export const backdropBox = async (page: Page): Promise<Box> => (await boxOf(page, '[data-qi-backdrop]'))[0]!;

/** 主要文字與內容區塊：光點外框與它們重疊 ≤ 5%。 */
export const KEY_TEXT = [
  'h1',
  'h2',
  'h3',
  '.lead',
  '.button',
  '.page-head',
  '[data-course-body] p',
  '.course-head__media',
  '.course-head__plate',
  '.coach-card',
  '.coach__text',
  '.coach__poster',
  '.poster',
  '.facility-photos',
  '.lost__text',
  '.lost__glyph',
]
  .map((selector) => `main ${selector}`) // main 之內（頁尾在 main 外面、有不透明的底，捲到底時蓋在固定的右側欄上，不是光點底下的文字）
  .join(', ');
export const OVERLAP_LIMIT = 0.05;

/** 光點外框 `shape` 與 `selector` 符合的每個元素重疊（占該元素面積）都 ≤ 5%。 */
export async function expectNoOverlap(page: Page, shape: Box, selector: string = KEY_TEXT): Promise<void> {
  const worst: string[] = [];
  for (const box of await boxOf(page, selector)) {
    const fraction = overlapOfBox(shape, box);
    if (fraction > OVERLAP_LIMIT) worst.push(`${(fraction * 100).toFixed(1)}%`);
  }
  expect(worst, '光點外框與主要文字的重疊').toEqual([]);
}
