import { expect, test } from './fixtures';
import { COACHES, PUBLISHED_COURSES, basePath } from './helpers';

// 這支在 /liu_yi 與 / 兩種 base 的建置下都會跑（見 playwright.config.ts 的 projects）。

interface PageReport {
  path: string;
  links: string[];
  assets: string[];
  imagesWithoutAlt: string[];
}

const EXPECTED_ROUTES = [
  '',
  'courses/',
  ...PUBLISHED_COURSES.map((c) => `courses/${c.slug}/`),
  'coaches/',
  ...COACHES.map((c) => `coaches/${c.slug}/`),
  'facility/',
  'pricing/',
  'schedule/',
];

test('從首頁爬完全站：所有內部連結與資源都在 base 底下，而且沒有 404', async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  const base = basePath(baseURL);
  const origin = new URL(baseURL!).origin;

  const queue: string[] = [base];
  const visited = new Map<string, PageReport>();
  const outsideBase: string[] = [];

  while (queue.length > 0) {
    const path = queue.shift()!;
    if (visited.has(path)) continue;

    const response = await page.goto(origin + path);
    expect(response?.status(), `page ${path}`).toBe(200);

    const report = await page.evaluate((): Omit<PageReport, 'path'> => {
      const abs = (value: string) => new URL(value, document.baseURI).href;
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map((a) => a.href);
      const assets = new Set<string>();
      for (const img of document.querySelectorAll<HTMLImageElement>('img')) {
        if (img.getAttribute('src')) assets.add(abs(img.getAttribute('src')!));
      }
      for (const el of document.querySelectorAll<HTMLElement>('img[srcset], source[srcset]')) {
        for (const candidate of el.getAttribute('srcset')!.split(',')) {
          const src = candidate.trim().split(/\s+/)[0];
          if (src) assets.add(abs(src));
        }
      }
      for (const el of document.querySelectorAll<HTMLLinkElement>('link[href]')) {
        if (el.rel !== 'canonical') assets.add(el.href);
      }
      for (const el of document.querySelectorAll<HTMLScriptElement>('script[src]')) assets.add(el.src);
      const imagesWithoutAlt = Array.from(document.querySelectorAll('img:not([alt])')).map((img) => img.outerHTML);
      return { links, assets: [...assets], imagesWithoutAlt };
    });
    visited.set(path, { path, ...report });

    for (const href of report.links) {
      const target = new URL(href);
      if (target.origin !== origin) continue;
      if (!target.pathname.startsWith(base)) {
        outsideBase.push(`${path} -> ${target.pathname}`);
        continue;
      }
      const isPage = target.pathname.endsWith('/');
      if (isPage && !visited.has(target.pathname)) queue.push(target.pathname);
    }
  }

  expect(outsideBase, '內部連結沒有經過 base').toEqual([]);
  expect([...visited.keys()].sort()).toEqual(EXPECTED_ROUTES.map((r) => base + r).sort());

  // 每個連結目標與資源各請求一次。
  const targets = new Set<string>();
  const missingAlt: string[] = [];
  for (const report of visited.values()) {
    missingAlt.push(...report.imagesWithoutAlt.map((html) => `${report.path}: ${html}`));
    for (const href of [...report.links, ...report.assets]) {
      const target = new URL(href);
      if (target.origin !== origin) continue;
      target.hash = '';
      if (!target.pathname.startsWith(base)) outsideBase.push(`${report.path} -> ${target.pathname}`);
      targets.add(target.href);
    }
  }
  expect(outsideBase, '資源沒有經過 base').toEqual([]);
  expect(missingAlt, '圖片缺 alt 屬性').toEqual([]);
  expect(targets.size).toBeGreaterThan(50);

  const broken: string[] = [];
  for (const target of targets) {
    const response = await request.get(target);
    if (response.status() !== 200) broken.push(`${response.status()} ${target}`);
  }
  expect(broken).toEqual([]);
});

test('sitemap 列出所有頁面，網址帶 base', async ({ request, baseURL }) => {
  const base = basePath(baseURL);
  const index = await request.get('./sitemap-index.xml');
  expect(index.status()).toBe(200);
  expect(await index.text()).toContain(`https://lawa0921.github.io${base}sitemap-0.xml`);

  const sitemap = await request.get('./sitemap-0.xml');
  expect(sitemap.status()).toBe(200);
  const locs = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  expect(locs).toEqual(EXPECTED_ROUTES.map((r) => `https://lawa0921.github.io${base}${r}`).sort());
});

test('找不到的網址回 404 頁，頁上有回首頁的連結', async ({ page, baseURL }) => {
  const response = await page.goto('./no-such-page/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('找不到');
  await expect(page.getByRole('link', { name: '回首頁' })).toHaveAttribute('href', basePath(baseURL));
});
