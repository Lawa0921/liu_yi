import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = join(ROOT, 'src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const rel = (file: string) => relative(ROOT, file).split('\\').join('/');
const read = (file: string) => readFileSync(file, 'utf8');

const sourceFiles = walk(SRC).filter((file) => ['.css', '.astro', '.ts', '.js', '.mjs', '.md', '.mdx'].includes(extname(file)));
const styleFiles = sourceFiles.filter((file) => ['.css', '.astro'].includes(extname(file)));

/** TW-Kai 只有一種粗細：所有 font-weight 宣告只能是這些值，否則瀏覽器會合成假粗體。 */
const ALLOWED_WEIGHTS = new Set(['400', 'normal', 'inherit', 'unset']);

function fontWeightDeclarations(file: string): { where: string; value: string }[] {
  const found: { where: string; value: string }[] = [];
  read(file)
    .split('\n')
    .forEach((line, index) => {
      for (const match of line.matchAll(/font-weight\s*:\s*([^;}"'\n]*)/gi)) {
        found.push({ where: `${rel(file)}:${index + 1}`, value: match[1]!.trim().toLowerCase() });
      }
    });
  return found;
}

describe('style guard：TW-Kai 單一字重', () => {
  it('有掃到 css 與 astro 檔（防止掃描路徑錯了而空過）', () => {
    expect(styleFiles.length).toBeGreaterThan(10);
    expect(styleFiles.flatMap(fontWeightDeclarations).length).toBeGreaterThan(5);
  });

  it('src/**/*.{css,astro} 的 font-weight 只能是 400、normal、inherit、unset', () => {
    const offenders = styleFiles
      .flatMap(fontWeightDeclarations)
      .filter(({ value }) => !ALLOWED_WEIGHTS.has(value))
      .map(({ where, value }) => `${where}  font-weight: ${value}`);

    expect(offenders).toEqual([]);
  });

  it('global.css 的 html 設了 font-synthesis: none', () => {
    const css = read(join(SRC, 'styles', 'global.css'));
    const htmlRule = /(?:^|\n)html\s*\{([^}]*)\}/.exec(css);

    expect(htmlRule, 'global.css 找不到 html { … } 規則').not.toBeNull();
    expect(htmlRule![1]).toMatch(/font-synthesis\s*:\s*none\s*;/);
  });
});

describe('style guard：Noto Serif TC 已全部移除', () => {
  it('src/ 與 astro.config.mjs 不得出現 Noto Serif TC、noto-serif-tc', () => {
    const files = [...sourceFiles, join(ROOT, 'astro.config.mjs')];
    const offenders = files.filter((file) => /noto[ -]serif[ -]tc/i.test(read(file))).map(rel);

    expect(offenders).toEqual([]);
  });
});

describe('style guard：字型變數', () => {
  it('--font-display 與 --font-body 都以 --font-twkai 開頭，並退到 Songti TC、PMingLiU、serif', () => {
    const tokens = read(join(SRC, 'styles', 'tokens.css'));
    for (const name of ['--font-display', '--font-body']) {
      const declaration = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(tokens);
      expect(declaration, `tokens.css 找不到 ${name}`).not.toBeNull();
      expect(declaration![1]!.replace(/\s+/g, ' ').trim()).toBe("var(--font-twkai), 'Songti TC', 'PMingLiU', serif");
    }
  });
});

describe('style guard：課程卡大字是平面古金（Task 22b）', () => {
  const card = read(join(SRC, 'components', 'CourseCard.astro'));

  it('CourseCard.astro 沒有 background-clip（不做漸層字，設計 §4 反目標：金色漸層立體字）', () => {
    expect(card).not.toMatch(/background-clip\s*:/); // 宣告；說明文字裡提到這個詞不算
  });

  it('.course-card__glyph 用平面的古金 token（--color-accent），沒有 linear-gradient', () => {
    const rule = /\.course-card__glyph\s*\{([^}]*)\}/.exec(card)?.[1] ?? '';
    expect(rule).toMatch(/color\s*:\s*var\(--color-accent\)/);
    expect(rule).not.toMatch(/gradient/);
  });
});

describe('style guard：全站不做漸層字（設計 §4 反目標：金色漸層立體字）', () => {
  /** 去掉 CSS／JS 註解後的宣告：說明文字裡提到 background-clip 不算。 */
  const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

  it('src/**/*.{css,astro} 沒有任何 background-clip 宣告（含 -webkit- 前綴）：靜止時不會有 background-clip:text', () => {
    const offenders = styleFiles
      .filter((file) => /background-clip\s*:/.test(stripComments(read(file))))
      .map((file) => rel(file));
    expect(offenders).toEqual([]);
  });
});
