import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 推門換頁（Task 27）的樣式守則：宣告在 prefers-reduced-motion: no-preference 之內、只動快照的 clip-path、總長 0.6 s、動畫保持終態（both）。
const css = readFileSync(new URL('../../src/styles/transition.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // 去掉註解
const global = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');

/** 取出頂層的 `@media (prefers-reduced-motion: no-preference) { … }` 區塊（以大括號配對）。 */
function noPreferenceBlock(): string {
  const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  expect(start, '有 no-preference 區塊').toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('unbalanced braces');
}

describe('transition.css', () => {
  it('由 global.css 引入', () => {
    expect(global).toContain("@import './transition.css'");
  });

  it('@view-transition { navigation: auto } 與兩張快照的動畫都只在 prefers-reduced-motion: no-preference 之內（減少動態時整組不生效）', () => {
    const block = noPreferenceBlock();
    expect(block).toMatch(/@view-transition\s*\{\s*navigation\s*:\s*auto\s*;?\s*\}/);
    expect(block).toMatch(/::view-transition-old\(root\)/);
    expect(block).toMatch(/::view-transition-new\(root\)/);
    // 區塊之外沒有任何 @view-transition 或 ::view-transition 規則
    const outside = css.replace(block, '');
    expect(outside).not.toMatch(/@view-transition/);
    expect(outside).not.toMatch(/::view-transition/);
  });

  it('舊頁 0.3 s 關門、新頁延後 0.3 s 再 0.3 s 開門（總長 0.6 s），兩個都是 both（延遲期間停在門縫、關完不彈回全開）', () => {
    const block = noPreferenceBlock();
    const old = /::view-transition-old\(root\)\s*\{[^}]*animation\s*:\s*([^;]+);/.exec(block)?.[1] ?? '';
    const next = /::view-transition-new\(root\)\s*\{[^}]*animation\s*:\s*([^;]+);/.exec(block)?.[1] ?? '';
    expect(old).toMatch(/^0\.3s\s/);
    expect(old).toMatch(/\bboth\b/);
    expect(old).toMatch(/door-close/);
    expect(next).toMatch(/^0\.3s\s+0\.3s\s/);
    expect(next).toMatch(/\bboth\b/);
    expect(next).toMatch(/door-open/);
  });

  it('兩個 keyframes 只動 clip-path：關門是全開 → 中線，開門是中線 → 全開', () => {
    for (const name of ['door-close', 'door-open']) {
      const body = new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? '';
      const properties = new Set([...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]));
      expect([...properties], name).toEqual(['clip-path']);
    }
    expect(/@keyframes\s+door-close\s*\{\s*from\s*\{\s*clip-path:\s*inset\(0 0 0 0\)[\s\S]*?to\s*\{\s*clip-path:\s*inset\(0 50% 0 50%\)/.test(css)).toBe(true);
    expect(/@keyframes\s+door-open\s*\{\s*from\s*\{\s*clip-path:\s*inset\(0 50% 0 50%\)[\s\S]*?to\s*\{\s*clip-path:\s*inset\(0 0 0 0\)/.test(css)).toBe(true);
  });
});
