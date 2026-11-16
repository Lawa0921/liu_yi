import type { Page } from '@playwright/test';

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
