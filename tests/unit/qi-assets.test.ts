import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { qiAssets } from '../../integrations/qi-assets';
import { SHAPES } from '../../src/qi/config/shapes';

/**
 * `qiAssets`（astro:config:setup）的整合測試只在這一處：形體與靜態圖兩段都接上了。
 * 各段的細節（取樣、渲染、跳過、故障）在 qi-build-shapes、qi-stills、qi-staged-output；這裡只驗「產物真的出現在專案的約定位置」。
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const IDS = Object.keys(SHAPES);

const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

/** 把建置的輸入複製成一份暫存的專案根目錄（剪影只複製 .png）。 */
function copyRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qi-assets-'));
  tmpDirs.push(dir);
  for (const rel of ['src/qi', 'src/assets/seal', 'scripts/qi']) cpSync(join(ROOT, rel), join(dir, rel), { recursive: true });
  mkdirSync(join(dir, 'src/assets/silhouettes'), { recursive: true });
  for (const name of readdirSync(join(ROOT, 'src/assets/silhouettes'))) {
    if (name.endsWith('.png')) cpSync(join(ROOT, 'src/assets/silhouettes', name), join(dir, 'src/assets/silhouettes', name));
  }
  return dir;
}

describe('qiAssets（astro:config:setup）', () => {
  const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  const run = async (root: string, logger = makeLogger()) => {
    const hook = qiAssets().hooks['astro:config:setup'];
    if (!hook) throw new Error('integration 沒有 astro:config:setup');
    await (hook as (params: unknown) => Promise<void>)({ config: { root: pathToFileURL(`${root}/`) }, logger });
    return logger;
  };

  it('名稱是 qi-assets；只註冊 astro:config:setup：不碰 dev watch 與建置後的鉤子', () => {
    expect(qiAssets().name).toBe('qi-assets');
    expect(Object.keys(qiAssets().hooks)).toEqual(['astro:config:setup']);
  });

  it('產出形體（src/assets/generated/qi/shapes/）與靜態圖（…/stills/），沒有警告；輸入沒變時第二次不重寫任何產物', async () => {
    const root = copyRoot();
    const shapesDir = join(root, 'src/assets/generated/qi/shapes');
    const stillsDir = join(root, 'src/assets/generated/qi/stills');

    const logger = await run(root);

    for (const id of IDS) {
      expect(existsSync(join(shapesDir, `${id}.bin`)), `${id}.bin`).toBe(true);
      expect(existsSync(join(stillsDir, `${id}.webp`)), `${id}.webp`).toBe(true);
    }
    expect(existsSync(join(shapesDir, 'shapes.json'))).toBe(true);
    expect(existsSync(join(stillsDir, 'stills.json'))).toBe(true);
    expect(existsSync(join(stillsDir, 'hero-wide.webp'))).toBe(true);
    expect(existsSync(join(stillsDir, 'hero-tall.webp'))).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();

    const old = new Date('2001-01-01T00:00:00Z');
    const touched = [join(shapesDir, 'land.bin'), join(stillsDir, 'land.webp'), join(stillsDir, 'hero-wide.webp')];
    for (const file of touched) utimesSync(file, old, old);
    await run(root);
    for (const file of touched) expect(statSync(file).mtimeMs, file).toBe(old.getTime());
    expect(readFileSync(join(stillsDir, 'stills.json'), 'utf8')).toContain('hero-wide');
  }, 240_000);
});
