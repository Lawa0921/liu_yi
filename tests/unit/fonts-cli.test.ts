import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCharList, toCharsetText } from '../../scripts/fonts/charset';
import { parseArgs, runSubset } from '../../scripts/fonts/cli';
import { SITE } from '../../src/lib/site';

const TTF = new URL('../../.cache/fonts/TW-Kai.ttf', import.meta.url);
const hasTtf = existsSync(TTF);

describe('parseArgs', () => {
  it('沒有參數、或只有 --from-dir <dir>', () => {
    expect(parseArgs([])).toEqual({});
    expect(parseArgs(['--from-dir', 'dist'])).toEqual({ fromDir: 'dist' });
  });

  it('--from-dir 少了值、或出現不認得的參數就丟錯', () => {
    expect(() => parseArgs(['--from-dir'])).toThrow(/--from-dir/);
    expect(() => parseArgs(['--from-dir', '--other'])).toThrow(/--from-dir/);
    expect(() => parseArgs(['--wat'])).toThrow(/--wat/);
  });
});

describe.skipIf(!hasTtf)('runSubset', () => {
  let root: string;
  const woff2Path = () => join(root, 'src/assets/fonts/twkai-subset.woff2');
  const charsPath = () => join(root, 'src/assets/fonts/twkai-subset.chars.txt');
  const ensureFont = vi.fn(async (_cacheDir: string) => fileURLToPath(TTF));
  let lines: string[];
  const log = (line: string) => lines.push(line);

  const writeHtml = (dir: string, body: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), `<!doctype html><html><body>${body}</body></html>`);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fonts-cli-'));
    lines = [];
    ensureFont.mockClear();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('--from-dir：不建置，掃指定資料夾，寫出 woff2 與 chars.txt，回傳 0', async () => {
    const dist = join(root, 'somewhere');
    writeHtml(dist, '<p>六藝武術 A</p>');
    const build = vi.fn(async () => {});

    const code = await runSubset({ root, fromDir: dist, ensureFont, build, log });

    expect(code).toBe(0);
    expect(build).not.toHaveBeenCalled();
    expect(ensureFont).toHaveBeenCalledWith(join(root, '.cache', 'fonts'));
    expect(String.fromCharCode(...readFileSync(woff2Path()).subarray(0, 4))).toBe('wOF2');
    expect(readFileSync(charsPath(), 'utf8')).toBe(`${toCharsetText(new Set([...'六藝武術A']))}\n`);
    const out = lines.join('\n');
    expect(out).toContain('字數：5');
    expect(out).toContain(`${readFileSync(woff2Path()).byteLength} bytes`);
  });

  it('只出現在其他頁面的字寫進延伸檔（twkai-extra），首頁的字留在核心檔', async () => {
    const dist = join(root, 'out');
    writeHtml(dist, '<p>六藝</p>');
    writeHtml(join(dist, 'courses'), '<p>六劍</p>');

    const code = await runSubset({ root, fromDir: dist, ensureFont, log });

    expect(code).toBe(0);
    expect(parseCharList(readFileSync(charsPath(), 'utf8'))).toEqual(new Set(['六', '藝']));
    expect(parseCharList(readFileSync(join(root, 'src/assets/fonts/twkai-extra.chars.txt'), 'utf8'))).toEqual(new Set(['劍']));
    expect(String.fromCharCode(...readFileSync(join(root, 'src/assets/fonts/twkai-extra.woff2')).subarray(0, 4))).toBe('wOF2');
    expect(lines.join('\n')).toMatch(/twkai-extra\.woff2/);
  });

  it('沒有只在其他頁面出現的字：刪掉舊的延伸檔', async () => {
    const dist = join(root, 'out');
    writeHtml(dist, '<p>六藝</p>');
    mkdirSync(join(root, 'src/assets/fonts'), { recursive: true });
    writeFileSync(join(root, 'src/assets/fonts/twkai-extra.woff2'), 'OLD');
    writeFileSync(join(root, 'src/assets/fonts/twkai-extra.chars.txt'), '劍\n');

    await runSubset({ root, fromDir: dist, ensureFont, log });

    expect(existsSync(join(root, 'src/assets/fonts/twkai-extra.woff2'))).toBe(false);
    expect(existsSync(join(root, 'src/assets/fonts/twkai-extra.chars.txt'))).toBe(false);
  });

  it('字型沒有的字：仍寫出檔案，但回傳 1、列出該字，且不寫進 chars.txt', async () => {
    const dist = join(root, 'out');
    writeHtml(dist, '<p>六😀</p>');

    const code = await runSubset({ root, fromDir: dist, ensureFont, log });

    expect(code).toBe(1);
    expect(existsSync(woff2Path())).toBe(true);
    expect(parseCharList(readFileSync(charsPath(), 'utf8'))).toEqual(new Set(['六']));
    expect(lines.join('\n')).toMatch(/😀|1F600/);
  });

  it('fallback-allowed.txt 列出的字不算失敗（仍不在子集裡）', async () => {
    const dist = join(root, 'out');
    writeHtml(dist, '<p>六😀</p>');
    mkdirSync(join(root, 'scripts/fonts'), { recursive: true });
    writeFileSync(join(root, 'scripts/fonts/fallback-allowed.txt'), '😀\n');

    const code = await runSubset({ root, fromDir: dist, ensureFont, log });

    expect(code).toBe(0);
    expect(parseCharList(readFileSync(charsPath(), 'utf8'))).toEqual(new Set(['六']));
  });

  it('沒有現成子集時先產生暫時版（ASCII＋站名），再以 TWKAI_GUARD=warn 建置，最後以掃描結果覆寫', async () => {
    let seenEnv: Record<string, string | undefined> = {};
    let provisionalChars = new Set<string>();
    const build = vi.fn(async (env: Record<string, string | undefined>) => {
      seenEnv = env;
      expect(existsSync(woff2Path())).toBe(true);
      provisionalChars = parseCharList(readFileSync(charsPath(), 'utf8'));
      writeHtml(join(root, 'dist'), '<p>劍</p>');
    });

    const code = await runSubset({ root, ensureFont, build, log, env: {} });

    expect(code).toBe(0);
    expect(build).toHaveBeenCalledTimes(1);
    expect(seenEnv.TWKAI_GUARD).toBe('warn');
    for (const ch of SITE.name) expect(provisionalChars.has(ch), ch).toBe(true);
    for (const ch of '!A~z09') expect(provisionalChars.has(ch), ch).toBe(true);
    expect(provisionalChars.has('劍')).toBe(false);
    expect(parseCharList(readFileSync(charsPath(), 'utf8'))).toEqual(new Set(['劍']));
  });

  it('已有子集時不重做暫時版（建置時看到的仍是原檔）', async () => {
    mkdirSync(join(root, 'src/assets/fonts'), { recursive: true });
    writeFileSync(woff2Path(), 'SENTINEL');
    let during = '';
    const build = vi.fn(async () => {
      during = readFileSync(woff2Path(), 'utf8');
      writeHtml(join(root, 'dist'), '<p>劍</p>');
    });

    const code = await runSubset({ root, ensureFont, build, log, env: {} });

    expect(code).toBe(0);
    expect(during).toBe('SENTINEL');
    expect(readFileSync(woff2Path(), 'utf8')).not.toBe('SENTINEL');
  });

  it('OUT_DIR 環境變數改變掃描的建置資料夾', async () => {
    const build = vi.fn(async () => {
      writeHtml(join(root, 'dist-root'), '<p>藝</p>');
    });

    const code = await runSubset({ root, ensureFont, build, log, env: { OUT_DIR: 'dist-root' } });

    expect(code).toBe(0);
    expect(parseCharList(readFileSync(charsPath(), 'utf8'))).toEqual(new Set(['藝']));
  });

  describe('掃不到東西時報錯，不用空字集覆寫既有子集', () => {
    const seedExisting = () => {
      mkdirSync(join(root, 'src/assets/fonts'), { recursive: true });
      writeFileSync(woff2Path(), 'SENTINEL');
      writeFileSync(charsPath(), '六藝\n');
    };
    const untouched = () => {
      expect(readFileSync(woff2Path(), 'utf8')).toBe('SENTINEL');
      expect(readFileSync(charsPath(), 'utf8')).toBe('六藝\n');
    };

    it('資料夾裡沒有任何 .html（--from-dir 指錯地方）', async () => {
      seedExisting();
      const dist = join(root, 'wrong');
      mkdirSync(dist, { recursive: true });
      writeFileSync(join(dist, 'only.css'), '.x::before{content:"六"}');

      await expect(runSubset({ root, fromDir: dist, ensureFont, log })).rejects.toThrow(/\.html/);
      untouched();
    });

    it('有 .html 但一個字都沒掃到', async () => {
      seedExisting();
      const dist = join(root, 'blank');
      writeHtml(dist, '<p>  </p>');

      await expect(runSubset({ root, fromDir: dist, ensureFont, log })).rejects.toThrow(/0 個字/);
      untouched();
    });

    it('建置沒有產出 .html（建置成功但 outDir 是空的）', async () => {
      seedExisting();
      const build = vi.fn(async () => {
        mkdirSync(join(root, 'dist'), { recursive: true });
      });

      await expect(runSubset({ root, ensureFont, build, log, env: {} })).rejects.toThrow(/\.html/);
      untouched();
    });
  });

  it('建置失敗：錯誤往外丟，且不動到既有的子集檔', async () => {
    mkdirSync(join(root, 'src/assets/fonts'), { recursive: true });
    writeFileSync(woff2Path(), 'SENTINEL');
    const build = vi.fn(async () => {
      throw new Error('astro build 失敗');
    });

    await expect(runSubset({ root, ensureFont, build, log, env: {} })).rejects.toThrow('astro build 失敗');

    expect(readFileSync(woff2Path(), 'utf8')).toBe('SENTINEL');
  });
});
