import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { twkaiGuard } from '../../integrations/twkai-guard';
import { checkDist, formatMissing } from '../../scripts/fonts/guard';

let root: string;
let dist: string;
let charsetFile: string;
let allowedFile: string;

const writePage = (rel: string, body: string) => {
  const file = join(dist, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `<!doctype html><html><body>${body}</body></html>`);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fonts-guard-'));
  dist = join(root, 'dist');
  mkdirSync(dist, { recursive: true });
  charsetFile = join(root, 'chars.txt');
  allowedFile = join(root, 'allowed.txt');
  writeFileSync(charsetFile, '六藝\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('checkDist', () => {
  it('頁面有字不在子集：ok:false、列出缺字與出現的檔案', async () => {
    writePage('index.html', '<p>六藝劍</p>');
    writePage('courses/index.html', '<p>劍</p>');

    const result = await checkDist({ distDir: dist, charsetFile });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['劍']);
    expect(result.pages['劍']).toEqual(['courses/index.html', 'index.html']);
  });

  it('字全在子集內：ok:true，沒有缺字', async () => {
    writePage('index.html', '<p>六藝</p>');

    const result = await checkDist({ distDir: dist, charsetFile });

    expect(result).toEqual({ ok: true, missing: [], pages: {} });
  });

  it('allowedFile 列出的字不算缺字', async () => {
    writePage('index.html', '<p>六藝劍</p>');
    writeFileSync(allowedFile, '劍\n');

    const result = await checkDist({ distDir: dist, charsetFile, allowedFile });

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('allowedFile 不存在視為空清單', async () => {
    writePage('index.html', '<p>六藝劍</p>');

    const result = await checkDist({ distDir: dist, charsetFile, allowedFile: join(root, 'nope.txt') });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['劍']);
  });

  it('ASCII 也要在子集內（D3：所有非空白字都算）；空白不算', async () => {
    writePage('index.html', '<p>六 A</p>');

    const result = await checkDist({ distDir: dist, charsetFile });

    expect(result.missing).toEqual(['A']);
  });

  it('CSS 的 content 字串與內聯 script 的 CJK 字串也算用字', async () => {
    writePage('index.html', '<style>.x::before{content:"・"}</style><script>const s="關";</script>');

    const result = await checkDist({ distDir: dist, charsetFile });

    expect(result.missing).toEqual(['・', '關']);
    expect(result.pages['關']).toEqual(['index.html']);
  });

  it('missing 依碼位排序', async () => {
    writePage('index.html', '<p>劍刀</p>');

    const result = await checkDist({ distDir: dist, charsetFile });

    expect(result.missing).toEqual(['刀', '劍']);
  });

  it('找不到字集檔就丟錯，訊息要指向 npm run fonts:subset', async () => {
    writePage('index.html', '<p>六</p>');

    await expect(checkDist({ distDir: dist, charsetFile: join(root, 'missing.txt') })).rejects.toThrow(
      /npm run fonts:subset/,
    );
  });

  it('dist 裡沒有任何 .html 就丟錯（不能對空產物報綠燈）', async () => {
    writeFileSync(join(dist, 'only.css'), '.x{content:"六"}');

    await expect(checkDist({ distDir: dist, charsetFile })).rejects.toThrow(/\.html/);
  });

  it('掃描失敗時錯誤訊息帶檔名（未知的 entity）', async () => {
    writePage('courses/index.html', '<p>&notanentity;</p>');

    await expect(checkDist({ distDir: dist, charsetFile })).rejects.toThrow(/courses\/index\.html.*&notanentity;/s);
  });
});

describe('formatMissing', () => {
  it('列出缺字、碼位、出現的檔案，並提示 npm run fonts:subset', () => {
    const text = formatMissing({
      ok: false,
      missing: ['劍'],
      pages: { 劍: ['index.html', 'courses/index.html'] },
    });

    expect(text).toContain('劍');
    expect(text).toContain('U+528D');
    expect(text).toContain('index.html');
    expect(text).toContain('courses/index.html');
    expect(text).toContain('請執行 npm run fonts:subset');
  });

  it('出現檔案太多時只列前幾個，並標出總數', () => {
    const many = Array.from({ length: 9 }, (_, i) => `p${i}/index.html`);
    const text = formatMissing({ ok: false, missing: ['劍'], pages: { 劍: many } });

    expect(text).toContain('p0/index.html');
    expect(text).not.toContain('p8/index.html');
    expect(text).toContain('9');
  });
});

describe('twkaiGuard（astro:build:done）', () => {
  const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  const run = async (env: Record<string, string | undefined>, logger = makeLogger()) => {
    const integration = twkaiGuard({ charsetFile, allowedFile, env });
    const hook = integration.hooks['astro:build:done'];
    if (!hook) throw new Error('integration 沒有 astro:build:done');
    await (hook as (params: unknown) => Promise<void>)({ dir: pathToFileURL(`${dist}/`), logger });
    return logger;
  };

  it('有缺字就丟錯：訊息含缺字、出現檔案、請執行 npm run fonts:subset', async () => {
    writePage('index.html', '<p>六藝劍</p>');

    const error = await run({}).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('劍');
    expect(message).toContain('index.html');
    expect(message).toContain('請執行 npm run fonts:subset');
  });

  it('TWKAI_GUARD=warn：只印警告，不丟錯', async () => {
    writePage('index.html', '<p>六藝劍</p>');

    const logger = await run({ TWKAI_GUARD: 'warn' });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0]![0])).toContain('劍');
  });

  it('字都在子集內：不丟錯也不警告', async () => {
    writePage('index.html', '<p>六藝</p>');

    const logger = await run({});

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('TWKAI_GUARD 是 warn 以外的值時照常守門', async () => {
    writePage('index.html', '<p>六藝劍</p>');

    await expect(run({ TWKAI_GUARD: 'off' })).rejects.toThrow(/劍/);
  });
});
