import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 首頁改版「氣聚成人」收尾（Task 22）：舊首頁（三幕、釘選、刀光、震腳、獅子掃光）與 /lab/ 試作已刪除，不得有東西再指回它們。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = normalize(fileURLToPath(import.meta.url));

/** 已刪除的路徑（相對專案根）。 */
const DELETED = [
  'src/components/Hero.astro',
  'src/components/Acts.astro',
  'src/scripts/acts.ts',
  'src/scripts/acts-pin.ts',
  'src/scripts/slash.ts',
  'src/scripts/stomp.ts',
  'src/scripts/hero-sheen.ts',
  'src/lib/arsenal/slash.ts',
  'tests/unit/arsenal-slash.test.ts',
  'src/lab',
  'src/pages/lab',
];

const TEXT_EXT = new Set(['.ts', '.mts', '.tsx', '.astro', '.mjs', '.js', '.css', '.html', '.md', '.json']);

function textFiles(dir: string): string[] {
  const out: string[] = [];
  const base = join(ROOT, dir);
  if (!existsSync(base)) return out;
  for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = normalize(join(entry.parentPath, entry.name));
    const ext = entry.name.slice(entry.name.lastIndexOf('.'));
    if (!TEXT_EXT.has(ext)) continue;
    if (full.includes(`${sep}assets${sep}generated${sep}`)) continue; // 建置產物
    if (full === SELF) continue; // 這支測試本身必然寫著這些字串
    out.push(full);
  }
  return out;
}

const rel = (file: string) => relative(ROOT, file).split(sep).join('/');
const sources = [...textFiles('src'), ...textFiles('tests'), ...textFiles('scripts'), ...textFiles('integrations')];

describe('舊首頁與試作已移除', () => {
  it.each(DELETED)('%s 不存在', (path) => {
    expect(existsSync(join(ROOT, path)), `${path} 應該已刪除`).toBe(false);
  });

  it('沒有任何檔案 import 指向被刪的模組（相對路徑，含動態 import 與 CSS @import）', () => {
    const gone = new Set(DELETED.map((p) => p.replace(/\.(ts|astro)$/, '')));
    const specifier = /(?:from\s+|import\s*\(\s*|import\s+|@import\s+)['"](\.{1,2}\/[^'"]*)['"]/g;
    const offenders: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(specifier)) {
        const target = rel(resolve(dirname(file), match[1]!)).replace(/\.(ts|astro)$/, '');
        const hit = [...gone].some((g) => target === g || target.startsWith(`${g}/`));
        if (hit) offenders.push(`${rel(file)} → ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('src/ 與 tests/ 沒有舊首頁的標記與試作路徑', () => {
    const banned = ['data-acts', '.pin-spacer', 'slash-layer', 'data-stomp', 'hero__', 'src/lab/qi'];
    const offenders: string[] = [];
    for (const file of [...textFiles('src'), ...textFiles('tests')]) {
      const text = readFileSync(file, 'utf8');
      for (const needle of banned) if (text.includes(needle)) offenders.push(`${rel(file)}：${needle}`);
    }
    expect(offenders).toEqual([]);
  });

  it('astro.config.mjs 的 sitemap 篩選仍在（/lab/ 不進 sitemap；D26 保留）', () => {
    const config = readFileSync(join(ROOT, 'astro.config.mjs'), 'utf8');
    expect(config).toMatch(/sitemap\(\{ filter:[^}]*includes\('\/lab\/'\)/);
  });

  it('package.json 若仍列 gsap，src/ 內必須有人 import 它（D30：沒人用就不留依賴）', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const listed = 'gsap' in (pkg.dependencies ?? {}) || 'gsap' in (pkg.devDependencies ?? {});
    const used = textFiles('src').some((file) => /from\s+['"]gsap(\/|['"])/.test(readFileSync(file, 'utf8')));
    if (listed) expect(used, 'gsap 在 package.json 裡但 src/ 沒有人 import').toBe(true);
    else expect(used, 'src/ 還在 import gsap，但 package.json 沒有列它').toBe(false);
  });
});
