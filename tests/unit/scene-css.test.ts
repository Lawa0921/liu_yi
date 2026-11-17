import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FG_FADE_OUT_S } from '../../src/lib/scene/fg-dodge';

// 剪影場景與首頁景深層的樣式／標記守則（Task 27）：只用 CSS transform／opacity、不用 WebGL、不用漸層字、減少動態時關閉飄塵。
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const sceneCss = read('src/styles/scene.css');
const depthCss = read('src/styles/depth.css');
const sceneAstro = read('src/components/Scene.astro');
const depthAstro = read('src/components/home/Depth.astro');
const sceneTs = read('src/scripts/scene.ts');
const depthTs = read('src/scripts/home/depth.ts');
const homeCss = read('src/styles/home.css');

describe('子頁場景（Scene）', () => {
  it('不用 WebGL：標記沒有 canvas、腳本不 import three 或光點引擎', () => {
    expect(sceneAstro).not.toMatch(/<canvas/i);
    for (const source of [sceneTs, depthTs, depthAstro]) {
      expect(source).not.toMatch(/from\s+['"]three['"]/);
      expect(source).not.toMatch(/qi\/engine\/(qi-stage|stage|sim)/);
      expect(source).not.toMatch(/WebGLRenderer|getContext\(\s*['"]webgl/);
    }
  });

  it('整個場景純裝飾：aria-hidden、圖的 alt 是空的、不接收指標事件', () => {
    expect(sceneAstro).toMatch(/<div class="scene"[^\r\n]*aria-hidden="true"/);
    expect(sceneAstro).not.toMatch(/alt="[^"]+"/);
    expect(sceneCss).toMatch(/\.scene\s*\{[^}]*pointer-events\s*:\s*none/);
  });

  it('視差只動 transform：層的位移寫在 transform，不碰 top／left／width／height 的動畫', () => {
    expect(sceneTs).toMatch(/style\.transform/);
    expect(sceneTs).not.toMatch(/style\.(top|left|width|height|margin)/);
    expect(depthTs).toMatch(/style\.transform/);
    expect(depthTs).not.toMatch(/style\.(top|left|width|height|margin)/);
  });

  it('捲動、縮放與指標監聽都是 passive（每個 addEventListener 都帶 { passive: true }）', () => {
    for (const source of [sceneTs, depthTs]) {
      const listeners = [...source.matchAll(/addEventListener\(\s*'(scroll|pointermove|resize)'/g)].length;
      const passive = [...source.matchAll(/\{\s*passive:\s*true\s*\}/g)].length;
      expect(listeners).toBeGreaterThan(0);
      expect(passive).toBe(listeners);
    }
  });

  it('減少動態：腳本不掛視差（回傳前標 off），CSS 的飄塵動畫只在 no-preference 才掛、reduce 時整層不顯示', () => {
    expect(sceneTs).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(sceneTs).toMatch(/sceneMotion\s*=\s*'off'/);
    expect(sceneCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{[^@]*animation\s*:\s*scene-dust/);
    expect(sceneCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^@]*\.scene__dust\s*\{[^}]*display\s*:\s*none/);
  });

  it('不用 background-clip:text 與金色漸層字；飄塵動畫只動 transform 與 opacity', () => {
    for (const css of [sceneCss, depthCss]) {
      expect(css).not.toMatch(/background-clip\s*:\s*text/);
      expect(css).not.toMatch(/-webkit-text-fill-color/);
    }
    const keyframes = /@keyframes\s+scene-dust\s*\{([\s\S]*?)\n\}/.exec(sceneCss)?.[1] ?? '';
    const properties = new Set([...keyframes.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]));
    expect([...properties].sort()).toEqual(['opacity', 'transform']);
  });

  it('文字不被前景遮：場景是 <main> 的第一個區塊，在內容之前輸出（版面上在內容上方），自己不超出自己的盒子（overflow:hidden）', () => {
    expect(sceneCss).toMatch(/\.scene\s*\{[^}]*overflow\s*:\s*hidden/);
    const layout = read('src/layouts/BaseLayout.astro');
    expect(layout.indexOf('<Scene {...scene} />')).toBeGreaterThan(0);
    expect(layout.indexOf('<Scene {...scene} />')).toBeLessThan(layout.indexOf('<slot />'));
  });
});

describe('首頁景深層（Depth）', () => {
  it('遠景與中景用 lighten 疊在最上面（只把比後面亮的地方提亮：靜態海報與靜態圖的暗底、光點與文字都原樣透出，景深層在每個狀態都看得見）；前景（近黑的簷角與窗櫺）也在最上面，用一般混合', () => {
    expect(depthCss).toMatch(/\.depth\s*\{[^}]*z-index\s*:\s*2\b[^}]*mix-blend-mode\s*:\s*lighten/);
    expect(depthCss).toMatch(/\.depth-fg\s*\{[^}]*z-index\s*:\s*2\b/);
    expect(depthCss).not.toMatch(/\.depth-fg\s*\{[^}]*mix-blend-mode/);
  });

  it('畫布用 screen（純黑底對頁面底色是中性的；景深層另外用 lighten 疊在上面）', () => {
    expect(homeCss).toMatch(/\.home-canvas\s*\{[^}]*mix-blend-mode\s*:\s*screen/);
  });

  it('五種中景都有「目前段落」的顯示規則', () => {
    for (const key of ['gate', 'rack', 'drum', 'banner', 'dummy']) {
      expect(depthCss, key).toContain(`.depth[data-depth-mid='${key}'] .depth__img[data-mid='${key}']`);
    }
  });

  it('前景預設透明：腳本第一次量過文字才標 data-fg-ready 才顯示（沒有 JS 不顯示）；有文字經過的那一張標 data-fg-hide 就淡出；轉場是 opacity', () => {
    expect(depthCss).toMatch(/\.depth-fg \.depth__img\s*\{[^}]*opacity\s*:\s*0[^}]*transition\s*:\s*opacity/);
    expect(depthCss).toContain(".depth-fg[data-fg-ready] .depth__img:not([data-fg-hide])");
    const script = read('src/scripts/home/depth.ts');
    for (const attribute of ['data-fg-hide', 'data-fg-ready', 'fgSync']) expect(script, attribute).toContain(attribute);
  });

  it('前景淡出要快、淡入要慢：[data-fg-hide] 的轉場時間＝FG_FADE_OUT_S（0.1 s），基本的轉場（淡入）0.3 s；已壓上來的（data-fg-cut）不轉場', () => {
    const hide = /\.depth-fg \.depth__img\[data-fg-hide\]\s*\{[^}]*transition-duration\s*:\s*([\d.]+)s/.exec(depthCss);
    expect(hide, '有 [data-fg-hide] 的轉場時間').not.toBeNull();
    expect(Number(hide![1])).toBeCloseTo(FG_FADE_OUT_S, 5);
    expect(depthCss).toMatch(/\.depth-fg \.depth__img\s*\{[^}]*transition\s*:\s*opacity\s+0\.3s/);
    expect(depthCss).toMatch(/\[data-fg-hide\]\[data-fg-cut\]\s*\{[^}]*transition-duration\s*:\s*0s/);
    expect(read('src/scripts/home/depth.ts')).toContain('data-fg-cut');
  });

  it('左下窗櫺只有 .depth-fg[data-depth-left=on]（腳本依 HOME_FG_LEFT_BEATS 設）才顯示；腳本有設這個屬性', () => {
    expect(depthCss).toContain(".depth-fg[data-fg-ready]:not([data-depth-left='on']) .depth__img[data-asset='fg-lattice']");
    expect(read('src/scripts/home/depth.ts')).toContain('depthLeft');
  });

  it('不接收指標事件、aria-hidden', () => {
    expect(depthCss).toMatch(/\.depth,\s*\.depth-fg\s*\{[^}]*pointer-events\s*:\s*none/);
    expect(depthAstro).toMatch(/class="depth"[^>]*aria-hidden="true"/);
    expect(depthAstro).toMatch(/class="depth-fg"[^>]*aria-hidden="true"/);
  });
});
