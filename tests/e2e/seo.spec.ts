import { expect, test } from './fixtures';
import { basePath } from './helpers';

const PAGES = [
  { path: './', title: /六藝武術工作室/ },
  { path: './courses/', title: /^課程/ },
  { path: './courses/bajiquan/', title: /^八極專修/ },
  { path: './courses/kids-self-defense/', title: /^防身格鬥/ },
  { path: './coaches/', title: /^師資/ },
  { path: './coaches/monkey/', title: /^猴子/ },
  { path: './facility/', title: /^場地/ },
  { path: './schedule/', title: /^課表/ },
];

for (const { path, title } of PAGES) {
  test(`SEO meta：${path}`, async ({ page, request, baseURL }) => {
    await page.goto(path);
    const base = basePath(baseURL);
    const expectedCanonical = `https://lawa0921.github.io${base}${path.slice(2)}`;

    await expect(page).toHaveTitle(title);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant-TW');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', 'width=device-width, initial-scale=1');

    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description?.length ?? 0).toBeGreaterThan(5);

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', expectedCanonical);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', expectedCanonical);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', title);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', description!);

    // og:image 是完整網址；換成本機的同一路徑確認檔案存在。
    const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(ogImage).toMatch(new RegExp(`^https://lawa0921\\.github\\.io${base}`));
    const local = await request.get(new URL(baseURL!).origin + new URL(ogImage!).pathname);
    expect(local.status()).toBe(200);
    expect(local.headers()['content-type']).toContain('image/jpeg');

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });
}

test('每頁的 title 都不同', async ({ page }) => {
  const titles: string[] = [];
  for (const { path } of PAGES) {
    await page.goto(path);
    titles.push(await page.title());
  }
  expect(new Set(titles).size).toBe(titles.length);
});
