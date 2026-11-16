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

describe('home.css 的退回與海報規則（Task 20）', () => {
  it('海報盒子要 max-width: none：全站的 picture { max-width: 100% } 會把盒子縮回內容寬，兩側的 inset 就沒了、人形偏位', () => {
    const rule = /\.opening__poster\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/max-width\s*:\s*none/);
  });

  it('引擎接手後海報淡出（data-qi-ready），退回時拿掉那個屬性海報就回來（不另寫 qi-static 規則）', () => {
    expect(css).toMatch(/html\[data-qi-ready\]\s+\.opening__poster\s*\{[^}]*opacity\s*:\s*0/);
    expect(css).not.toMatch(/qi-static[^{]*\.opening__poster/);
  });

  it('靜態圖只在 html.js 且非 qi-static 時隱藏（沒有 JS、減少動態、沒有 WebGL 都露出）', () => {
    expect(css).toMatch(/html\.js:not\(\.qi-static\)\s+\.beat__still\s*\{[^}]*display\s*:\s*none/);
  });

  it('沒有 JS 時段落導覽不顯示，且優先序高於桌機的 display:block', () => {
    expect(css).toMatch(/html:not\(\.js\)\s+\.home-rail\s*\{[^}]*display\s*:\s*none/);
  });

  it('海報人形的位置與大小是依引擎取景推出的算式（橫向與直向各一組），不是寫死的百分比', () => {
    const landscape = /\.opening\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(landscape).toMatch(/--poster-h\s*:\s*min\(/);
    expect(landscape).toMatch(/--poster-x\s*:\s*calc\(/);
    expect(landscape).toMatch(/--poster-y\s*:\s*calc\(/);
    const portrait = /@media \(max-aspect-ratio: 1\/1\)\s*\{\s*\.opening\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(portrait).toMatch(/--poster-h\s*:\s*min\(/);
    expect(portrait).toMatch(/--poster-x\s*:\s*50%/);
    expect(portrait).toMatch(/--poster-y\s*:\s*calc\(/);
  });

  it('海報的橫向／直向切換與引擎取景同一個條件（畫布寬高比 1）：算式不放在寬度斷點（60rem）的區塊裡', () => {
    // 引擎（engine/stage.ts 的 fit）用 aspect >= 1 選取景，與視窗寬度無關；海報用寬度切換會讓橫放手機、直式平板錯位
    const widthBlock = /@media \(max-width: 59\.999rem\)\s*\{([\s\S]*?)\n\}\n/.exec(css)?.[1] ?? '';
    expect(widthBlock).toMatch(/\.opening\s*\{/); // 區塊存在（版面仍依寬度）
    expect(widthBlock).not.toMatch(/--poster-/);
    // 海報圖的 <source media> 也是同一個條件
    const opening = readFileSync(new URL('../../src/components/home/Opening.astro', import.meta.url), 'utf8');
    expect(opening).toMatch(/media="\(max-aspect-ratio: 1\/1\)"/);
  });

  it('程式移到 main 的焦點不畫外框（退回時焦點在略過鈕上，先移到 main）', () => {
    expect(css).toMatch(/\[data-home\]:focus\s*\{[^}]*outline\s*:\s*none/);
  });
});
