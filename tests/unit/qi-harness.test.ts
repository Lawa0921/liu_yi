import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { QI_HARNESS_PATH, qiHarness } from '../../integrations/qi-harness';

// 引擎 e2e 的 harness 頁只在 QI_HARNESS=1 的測試建置才存在；一般建置（含部署）一個字都不能多。
const setup = (env: Record<string, string | undefined>) => {
  const injectRoute = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const hook = qiHarness({ env }).hooks['astro:config:setup'];
  if (!hook) throw new Error('integration 沒有 astro:config:setup');
  (hook as (params: unknown) => void)({ injectRoute, logger });
  return { injectRoute, logger };
};

describe('qiHarness', () => {
  it('沒有 QI_HARNESS：不註冊任何路由', () => {
    expect(setup({}).injectRoute).not.toHaveBeenCalled();
  });

  it.each(['0', '', 'true', 'yes', ' 1'])('QI_HARNESS=%j：不算開啟（只認 1）', (value) => {
    expect(setup({ QI_HARNESS: value }).injectRoute).not.toHaveBeenCalled();
  });

  it('QI_HARNESS=1：註冊 /__test/qi-harness，entrypoint 指到存在的檔案，並警告這份建置不得部署', () => {
    const { injectRoute, logger } = setup({ QI_HARNESS: '1' });

    expect(injectRoute).toHaveBeenCalledTimes(1);
    const route = injectRoute.mock.calls[0]![0] as { pattern: string; entrypoint: string };
    expect(route.pattern).toBe(QI_HARNESS_PATH);
    expect(QI_HARNESS_PATH.startsWith('/__test/')).toBe(true);
    expect(existsSync(new URL(`../../${route.entrypoint}`, import.meta.url))).toBe(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('harness 頁自己標 noindex（雙重保險）', () => {
    const page = readFileSync(new URL('../../tests/harness/qi-harness.astro', import.meta.url), 'utf8');
    expect(page).toMatch(/<meta name="robots" content="noindex, nofollow"/);
  });

  it('astro.config.mjs 註冊了這個 integration，sitemap 排除 /lab/ 與 harness 路徑', () => {
    const config = readFileSync(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
    expect(config).toMatch(/qiHarness\(\)/);
    expect(config).toMatch(/sitemap\(\{ filter:[^}]*'\/lab\/'/);
    expect(config).toMatch(/sitemap\(\{ filter:[^}]*QI_HARNESS_PATH/);
  });
});
