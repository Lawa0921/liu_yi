import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 首頁樣式的守則（Task 19）：畫布與各 beat 的高度用 `lvh`／`svh`，不用會隨網址列抖動的 `vh`，也不用強制 scroll-snap。
 * 檔案內容先去掉註解再比對：說明文字裡提到這些詞不算。
 */
const css = readFileSync(new URL('../../src/styles/home.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('home.css 的高度與捲動守則', () => {
  it('畫布高度用 100lvh（大視窗高：網址列伸縮時畫布不跟著變）', () => {
    expect(css).toMatch(/100lvh/);
  });

  it('beat 高度用 --stage-height（svh）', () => {
    expect(css).toMatch(/var\(--stage-height\)/);
  });

  it('不使用 100vh', () => {
    expect(css).not.toMatch(/100vh/);
  });

  it('不使用強制 scroll-snap（只有 none 可以）', () => {
    const types = [...css.matchAll(/scroll-snap-type\s*:\s*([^;}]*)/g)].map((m) => m[1]!.trim());
    expect(types.filter((value) => value !== 'none')).toEqual([]);
  });

  it('畫布固定在視窗、不接收指標事件、在內容底下（z-index 0）', () => {
    const rule = /\.home-canvas\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/position\s*:\s*fixed/);
    expect(rule).toMatch(/z-index\s*:\s*0\b/);
    expect(rule).toMatch(/pointer-events\s*:\s*none/);
  });
});
