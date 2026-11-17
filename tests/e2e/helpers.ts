import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { QiDebug } from '../../src/qi/engine/qi-stage';
import { decodeShape } from '../../src/qi/shapes/format';

export const ADULT_COURSES = [
  { title: '中式兵器', slug: 'chinese-weapons' },
  { title: '八極專修', slug: 'bajiquan' },
  { title: '散手技擊', slug: 'sanshou' },
];

export const KID_COURSES = [
  { title: '防身兵器', slug: 'kids-weapons' },
  { title: '兒童武術', slug: 'kids-martial-arts' },
  { title: '防身格鬥', slug: 'kids-self-defense' },
];

export const OTHER_COURSES = [
  { title: '巴西柔術', slug: 'bjj' },
  { title: '核心瑜珈', slug: 'core-yoga' },
];

export const PUBLISHED_COURSES = [...ADULT_COURSES, ...KID_COURSES, ...OTHER_COURSES];
export const UNPUBLISHED_COURSE_SLUGS = ['internal-arts', 'street-dance', 'youth-combat', 'toddler-martial-arts'];

export const COACHES = [
  { name: '詹前賢', slug: 'chan' },
  { name: '猴子', slug: 'monkey' },
  { name: 'LISA', slug: 'lisa' },
  { name: '歐文', slug: 'owen' },
];

export const AUDIENCE_STORAGE_KEY = 'liuyi:audience';

/** base 路徑（'/liu_yi/' 或 '/'），從 Playwright 的 baseURL 取得。 */
export function basePath(baseURL: string | undefined): string {
  return new URL(baseURL ?? 'http://localhost/').pathname;
}

/** 指定對象那一組卡片裡的課程名稱（依畫面順序）。 */
export function cardTitles(page: Page, audience: 'adult' | 'kid') {
  return page.locator(`[data-audience-panel="${audience}"] .course-card h3`);
}

/** 首頁課程段的順序：拳 → 格鬥 → 兵器（設計 §7；課程總覽頁仍是兵器 → 拳術 → 格鬥）。 */
export const HOME_ADULT_ORDER = ['八極專修', '散手技擊', '中式兵器'];
export const HOME_KID_ORDER = ['兒童武術', '防身格鬥', '防身兵器'];

/** 首頁指定對象那一組面板裡的課名（依畫面順序）。 */
export function homeTitles(page: Page, audience: 'adult' | 'kid') {
  return page.locator(`#courses [data-audience-panel="${audience}"] [data-course-title]`);
}

/** 區塊內被樣式藏起來（透明或 visibility:hidden）的元素。 */
export function hiddenByStyle(page: Page, scope: string) {
  return page.evaluate((selector) => {
    const hidden: string[] = [];
    for (const root of document.querySelectorAll(selector)) {
      for (const el of root.querySelectorAll<HTMLElement>('h1, h2, h3, p, a, li, img')) {
        if (el.closest('[aria-hidden="true"]')) continue;
        // 輪播裡不是目前那一張的照片本來就該是透明的。
        if (el.matches('[data-slide]:not(.is-active)')) continue;
        let node: HTMLElement | null = el;
        while (node && node !== document.body) {
          const style = getComputedStyle(node);
          if (Number(style.opacity) < 0.99 || style.visibility === 'hidden') {
            hidden.push(`${el.tagName}.${el.className}: ${(el.textContent ?? '').trim().slice(0, 12)}`);
            break;
          }
          node = node.parentElement;
        }
      }
    }
    return hidden;
  }, scope);
}

/** 記錄每個回應的大小（靜態伺服器不壓縮，所以這是保守的上限）。 */
export function trackTransfers(page: Page) {
  const transfers: { url: string; type: string; bytes: number }[] = [];
  page.on('response', async (response) => {
    try {
      const body = await response.body();
      transfers.push({ url: response.url(), type: response.request().resourceType(), bytes: body.length });
    } catch {
      // 導覽中斷的請求沒有內容，略過。
    }
  });
  return transfers;
}

export const totalBytes = (transfers: { bytes: number }[]) => transfers.reduce((sum, item) => sum + item.bytes, 0);

// ── 首屏人形的外框（海報與引擎）──────────────────────────────────────
// 原在 home-fallback.spec；館徽的幾何檢查（home-crest.spec）也要量同樣的外框，所以搬到這裡共用。

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 兩個矩形在 x、y 兩軸上各自重疊多少 px（負數＝分開）。 */
export function overlap(a: Box, b: Box): { x: number; y: number } {
  return { x: Math.min(a.right, b.right) - Math.max(a.left, b.left), y: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) };
}

/**
 * 首屏人形的外框（視窗座標）：
 *   - 海報：把圖解碼後取亮度 > 100 的像素外框（只剩人形與輪廓；更低的門檻會連光暈與環境煙一起算進去），再換算成視窗座標。
 *   - 引擎：land 形體的 xy 外框四角投影到螢幕。
 */
export async function figureBoxes(page: Page): Promise<{ poster: Box; engine: Box }> {
  const land = decodeShape(new Uint8Array(readFileSync(fileURLToPath(new URL('../../src/assets/generated/qi/shapes/land.bin', import.meta.url)))));
  const bounds = { minX: land.min[0], maxX: land.max[0], minY: land.min[1], maxY: land.max[1] };

  const poster = await page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('.opening__poster img')!;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(img, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    let x0 = width;
    let x1 = -1;
    let y0 = height;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        if (0.2126 * data[o]! + 0.7152 * data[o + 1]! + 0.0722 * data[o + 2]! <= 100) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    const rect = img.getBoundingClientRect();
    const sx = rect.width / width;
    const sy = rect.height / height;
    return { left: rect.left + x0 * sx, right: rect.left + (x1 + 1) * sx, top: rect.top + y0 * sy, bottom: rect.top + (y1 + 1) * sy };
  });

  const engine = await page.evaluate(({ minX, maxX, minY, maxY }) => {
    const { project } = (window as unknown as { __qi: { debug: QiDebug } }).__qi.debug;
    const corners = [project(minX, minY, 0), project(maxX, minY, 0), project(minX, maxY, 0), project(maxX, maxY, 0)];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  }, bounds);

  return { poster, engine };
}

// ── 幾何量測（Task 27 的場景與景深 e2e 用；位置原本是 Task 26 的頁面光點層留下的）──────────────

/** 符合選擇器、有大小的元素的視窗座標外框（display:none 的不算）。 */
export function boxOf(page: Page, selector: string): Promise<Box[]> {
  return page.evaluate((sel) => {
    return [...document.querySelectorAll<HTMLElement>(sel)]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
  }, selector);
}

/** `a` 與 `b` 的交集面積占 `b` 面積的比例（0–1）；不相交是 0。 */
export function overlapOfBox(a: Box, b: Box): number {
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (x <= 0 || y <= 0) return 0;
  const area = (b.right - b.left) * (b.bottom - b.top);
  return area > 0 ? (x * y) / area : 0;
}

/**
 * 推門換頁（Task 27，styles/transition.css）的已知瀏覽器雜訊：Chromium 在跨文件轉場被下一次換頁打斷時，會把
 * 「Transition was aborted because of invalid state. ViewTransition opt-in disabled」當成沒人接的 promise rejection 報成 pageerror。
 * 那些 promise 是瀏覽器內部建立的（轉場在 pagereveal 之前就被取消，事件沒有觸發，頁面腳本接不到），不是頁面程式的錯；
 * 偶爾在站內連續換頁的測試（點連結、上一頁、再點）裡看到。
 * 不得當成整支 spec 的預設容許（那會讓真正的 pageerror 也被這條正規式以外的漏洞蓋掉）：只有「真的連續換頁」的那幾個測試才用，
 * 而且只吃這一則。稽核過的 spec（有監看 pageerror 的）：home-fallback 的 `expectClickThrough`（點連結換頁之後立刻 goto 下一輪）才容許；
 * home-gate、home-crest、home-engine、visual、screen-polish、scene、arsenal、qi-engine、qi-effects 的每個測試只有一次 `goto`（home-gate／home-crest／home-engine 另有
 * `reload`，是重新載入同一頁、不是轉場進行中又換到另一頁），一律嚴格；之後若有測試開始連續換頁，要在那個測試裡明寫容許並說明。
 */
export const VIEW_TRANSITION_ABORT_NOISE = /Transition was aborted because of invalid state/;
