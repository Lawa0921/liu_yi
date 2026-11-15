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
