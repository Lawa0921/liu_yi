import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPortrait, PORTRAIT_ASPECT } from '../../src/qi/engine/viewport';

/**
 * 首頁樣式的守則（Task 19）：畫布與各 beat 的高度用 `lvh`／`svh`，不用會隨網址列抖動的 `vh`，也不用強制 scroll-snap。
 * 檔案內容先去掉註解再比對：說明文字裡提到這些詞不算。
 */
const css = readFileSync(new URL('../../src/styles/home.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** 所有 `@media <query> { … }` 區塊的內容（依大括號配對，不靠換行），多個同條件的區塊接在一起。 */
function mediaBody(query: string): string {
  const head = `@media ${query}`;
  const bodies: string[] = [];
  for (let at = css.indexOf(head); at !== -1; at = css.indexOf(head, at + head.length)) {
    const open = css.indexOf('{', at);
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}' && --depth === 0) break;
    }
    bodies.push(css.slice(open + 1, end));
  }
  return bodies.join('\n');
}

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

  it('段落導覽沒有 JS 也可見（錨點連結不需要 JS）：不再有 html:not(.js) 隱藏它的規則；桌機（≥ 60rem）顯示、手機預設不顯示', () => {
    expect(css).not.toMatch(/html:not\(\.js\)\s+\.home-rail/);
    expect(/(?:^|\})\s*\.home-rail\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '').toMatch(/display\s*:\s*none/); // 手機預設
    const desktop = /@media \(min-width: 60rem\)\s*\{([\s\S]*)$/.exec(css)?.[1] ?? '';
    expect(/\.home-rail\s*\{([^}]*)\}/.exec(desktop)?.[1] ?? '').toMatch(/display\s*:\s*block/);
  });

  it('海報人形的位置與大小是依引擎取景推出的算式（橫向與直向各一組），不是寫死的百分比', () => {
    const landscape = /\.opening\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(landscape).toMatch(/--poster-h\s*:\s*min\(/);
    expect(landscape).toMatch(/--poster-x\s*:\s*calc\(/);
    expect(landscape).toMatch(/--poster-y\s*:\s*calc\(/);
    const portrait = /@media \(max-aspect-ratio: 4\/5\)\s*\{\s*\.opening\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(portrait).toMatch(/--poster-h\s*:\s*min\(/);
    expect(portrait).toMatch(/--poster-x\s*:\s*50%/);
    expect(portrait).toMatch(/--poster-y\s*:\s*calc\(/);
  });

  it('版面與海報的橫向／直向切換是同一個寬高比條件（4:5，與引擎的 isPortrait 同源），不是寬度斷點（60rem）', () => {
    // 引擎（engine/viewport.ts 的 isPortrait）與這裡都用「寬 ≤ 高 × 4/5 才是直向」：橫放手機、直式平板、近方形視窗才不會錯位。
    expect(css).not.toMatch(/max-aspect-ratio\s*:\s*1\/1/);
    const stacked = mediaBody('(max-aspect-ratio: 4/5)');
    expect(stacked, '海報人形的直向算式在 @media (max-aspect-ratio: 4/5)').toMatch(/\.opening\s*\{[^}]*--poster-h\s*:/);
    // 文字在下、光點在上的堆疊版面也在這個條件裡，而不是寬度斷點
    expect(stacked).toMatch(/\.beat__panel\s*\{[^}]*grid-template-columns\s*:\s*minmax\(0,\s*1fr\)/);
    expect(stacked).toMatch(/\.beat__text\s*\{[^}]*grid-row\s*:\s*2/);
    // 寬度斷點只留尺寸微調，不再決定版面方向，也不碰海報算式
    const widthBlock = mediaBody('(max-width: 59.999rem)');
    expect(widthBlock).not.toMatch(/--poster-/);
    expect(widthBlock).not.toMatch(/\.beat__panel\s*\{/);
    expect(widthBlock).not.toMatch(/\.beat__text\s*\{/);
    // 切換鈕靠右是窄螢幕（含橫放手機）的事，不是直向的事：放在直向區塊裡，橫放手機（寬 < 60rem、橫向）就會被排除而蓋住文字
    expect(widthBlock).toMatch(/\.audience-switch__inner\s*\{[^}]*left\s*:\s*auto[^}]*right\s*:\s*var\(--gutter\)/);
    expect(stacked).not.toMatch(/\.audience-switch__inner/);
    // 海報圖的 <source media> 也是同一個條件
    const opening = readFileSync(new URL('../../src/components/home/Opening.astro', import.meta.url), 'utf8');
    expect(opening).toContain('max-aspect-ratio: ${PORTRAIT_ASPECT}');
    expect(PORTRAIT_ASPECT, '引擎端的常數與 CSS 寫死的 4/5 是同一個數字').toBe('4/5');
    expect(isPortrait(800, 1000)).toBe(true); // 4:5 恰在直向這邊（媒體查詢的 max-aspect-ratio 含等號）
    expect(opening).not.toMatch(/max-aspect-ratio: 1\/1/);
  });

  it('直向版面的站名依人形下緣縮放（--poster-h、--poster-y），站名不壓到人形（手機首屏）', () => {
    const stacked = mediaBody('(max-aspect-ratio: 4/5)');
    const titleRules = [...stacked.matchAll(/\.opening__title\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    const adaptive = titleRules.find((rule) => /--title-room/.test(rule)) ?? '';
    expect(adaptive).toMatch(/font-size\s*:[^;]*var\(--title-room\)/);
    const room = /--title-room\s*:\s*([^;]*);/.exec(adaptive)?.[1] ?? '';
    expect(room).toContain('var(--poster-y)');
    expect(room).toContain('var(--poster-h)');
  });

  it('程式移到 main 的焦點不畫外框（退回時焦點在略過鈕上，先移到 main）', () => {
    expect(css).toMatch(/\[data-home\]:focus\s*\{[^}]*outline\s*:\s*none/);
  });
});

describe('home.css 的館徽點擊區規則（Task 21 的朱印點擊區，Task 25 改成館徽）', () => {
  it('引擎在跑（html.js:not(.qi-static)）時 .crest-hit 預設 display:none，要等腳本標 data-placed 才顯示、定位在 --hit-* 上', () => {
    const base = /html\.js:not\(\.qi-static\)\s+\.crest-hit\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(base).toMatch(/position\s*:\s*fixed/);
    expect(base).toMatch(/display\s*:\s*none/);
    for (const name of ['--hit-x', '--hit-y', '--hit-w', '--hit-h']) expect(base).toContain(`var(${name}`);
    expect(css).toMatch(/html\.js:not\(\.qi-static\)\s+\.crest-hit\[data-placed\]\s*\{[^}]*display\s*:\s*block/);
  });

  it('靜態圖（其餘情況）時 .crest-hit 絕對定位在館徽靜態圖的盒子裡、對齊圖上的館徽，不是隱藏也不是 pointer-events:none', () => {
    const rule = /(?:^|\})\s*\.crest-hit\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/position\s*:\s*absolute/);
    expect(rule).toMatch(/inset\s*:/);
    expect(rule).not.toMatch(/display\s*:\s*none|pointer-events\s*:\s*none/);
    expect(/\.crest-stage\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/position\s*:\s*relative/);
  });

  it('BookingBeat 把靜態圖與 .crest-hit 包在同一個 .crest-stage 裡（同一個座標系），.crest-hit 對讀屏與 Tab 隱藏', () => {
    const booking = readFileSync(new URL('../../src/components/home/BookingBeat.astro', import.meta.url), 'utf8');
    expect(booking).toMatch(/<div class="crest-stage">\s*<Still name="crest" \/>\s*<a class="crest-hit"[^>]*tabindex="-1"[^>]*aria-hidden="true"/);
  });

  it('按鈕旁的小朱印：aria-hidden 的純裝飾、不可點、約 56–72 px（4rem）、用朱印遮罩填 --color-seal；按鈕在小印之前（鍵盤順序不受影響）', () => {
    const booking = readFileSync(new URL('../../src/components/home/BookingBeat.astro', import.meta.url), 'utf8');
    expect(booking).toMatch(/<span class="booking__seal"[^>]*aria-hidden="true"><\/span>/);
    expect(booking).toMatch(/<a class="button button--solid"[\s\S]*<span class="booking__seal"/);
    expect(booking).toContain("import sealMask from '../../assets/seal/seal-liuyi.png'");
    const rule = /\.booking__seal\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/width\s*:\s*4rem/);
    expect(rule).toMatch(/height\s*:\s*4rem/);
    expect(rule).toMatch(/background\s*:\s*var\(--color-seal\)/);
    expect(rule).toMatch(/mask\s*:\s*var\(--seal-mask\)/);
    expect(rule).toMatch(/pointer-events\s*:\s*none/);
  });

  it('PricingBeat 有竹簡的靜態圖（<Still name="scroll" />），放在文字之外（與其他 beat 一樣在 .beat__panel 的第二欄）', () => {
    const pricing = readFileSync(new URL('../../src/components/home/PricingBeat.astro', import.meta.url), 'utf8');
    expect(pricing).toMatch(/<\/div>\s*<Still name="scroll" \/>\s*<\/div>\s*<\/section>/);
  });
});

describe('home.css 的入館閘門規則（Task 25）', () => {
  /** 門本身的樣式（Task 28）：只在閘門顯示時由 <head> 的行內腳本載入（再訪不下載）。 */
  const gateCss = readFileSync(new URL('../../src/styles/gate.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('沒有 html[data-gate] 時整層不渲染（無 JS、減少動態、再訪都沒有閘門）；有了才顯示', () => {
    expect(/(?:^|\})\s*\.gate,\s*\.gate-backdrop\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '').toMatch(/display\s*:\s*none/);
    expect(css).toMatch(/html\[data-gate\]\s+\.gate-backdrop\s*\{[^}]*display\s*:\s*block/);
    expect(css).toMatch(/html\[data-gate\]\s+\.gate\s*\{[^}]*display\s*:\s*grid/);
  });

  it('閘門期間 html 不可捲動：overflow:hidden 於 html（拿掉 data-gate 就還原）、留著捲軸的位置不讓版面位移', () => {
    const rule = /html\[data-gate\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/overflow\s*:\s*hidden/);
    expect(rule).toMatch(/scrollbar-gutter\s*:\s*stable/);
  });

  it('疊放：背板 200（不透明黑底）→ 對話框 202（透明，只有門與按鈕接收指標）；閘門期間引擎畫布不抬到背板之上（沒有光點）', () => {
    expect(/html\[data-gate\]\s+\.gate-backdrop\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/z-index\s*:\s*200[\s\S]*background\s*:\s*var\(--color-bg\)/);
    expect(css + gateCss, '閘門期間不得改畫布的疊放').not.toMatch(/html\[data-gate[^\]]*\][^{]*\.home-canvas/);
    const dialog = /html\[data-gate\]\s+\.gate\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(dialog).toMatch(/z-index\s*:\s*202/);
    expect(dialog).toMatch(/pointer-events\s*:\s*none/);
    expect(dialog).not.toMatch(/background/);
    expect(css).toMatch(/html\[data-gate\]\s+\.gate\s*>\s*\.gate__enter\s*\{[^}]*pointer-events\s*:\s*auto/);
    // 只有門洞接收指標（場景在桌機蓋滿整個畫面：指到牆上門不動、點牆不進）；門框圖疊在門扇之上，不得攔下指標
    expect(gateCss).toMatch(/html\[data-gate\]\s+\.gate__door\s*\{[^}]*pointer-events\s*:\s*auto/);
    expect(gateCss).not.toMatch(/html\[data-gate\]\s+\.gate__scene\s*\{[^}]*pointer-events\s*:\s*auto/);
    expect(/(?:^|\n)\.gate__frame\s*\{([^}]*)\}/.exec(gateCss)?.[1] ?? '').toMatch(/pointer-events\s*:\s*none/);
    // 樣式表沒到（gate.css 載入失敗）時場景不顯示（只剩黑底與按鈕，仍進得去）
    expect(/(?:^|\n)\.gate__scene\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/opacity\s*:\s*0/);
  });

  it('門的樣式只在閘門顯示時才下載：home.css 只留閘門的外殼（背板、對話框、按鈕、淡出），門本身的規則在 gate.css；<head> 的行內腳本只在首頁帶它的網址', () => {
    for (const selector of ['.gate__door', '.gate__leaf', '.gate__frame', '.gate__plaque', '.gate__light']) {
      expect(css, `home.css 不得有 ${selector}`).not.toContain(selector);
      expect(gateCss, `gate.css 有 ${selector}`).toContain(selector);
    }
    const layout = readFileSync(new URL('../../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');
    expect(layout).toMatch(/import gateCss from '\.\.\/styles\/gate\.css\?url';/);
    expect(layout).toMatch(/data-gate-css=\{home \? gateCss : undefined\}/);
  });

  it('「入館」按鈕在腳本接手（.gate[data-ready]）之前 visibility:hidden，不是一顆點了沒反應的按鈕；腳本先標 data-ready 再聚焦', () => {
    const rule = /html\[data-gate\]\s+\.gate:not\(\[data-ready\]\)\s+\.gate__enter\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/visibility\s*:\s*hidden/);
    const script = readFileSync(new URL('../../src/scripts/home/gate.ts', import.meta.url), 'utf8');
    expect(script).toMatch(/dialog\.dataset\.ready = '';[\s\S]*button\.focus\(/);
  });

  it('焦點看得見（WCAG 2.4.7）：一進站就照常 focus-visible，不關掉焦點樣式；閘門的按鈕聚焦時是低調的細框（全站的 :focus-visible outline），不是金色填滿', () => {
    const script = readFileSync(new URL('../../src/scripts/home/gate.ts', import.meta.url), 'utf8');
    expect(script).not.toMatch(/focusVisible\s*:\s*false/);
    const focus = gateCss
      .split('}')
      .filter((rule) => /\.gate__enter:focus-visible/.test(rule.split('{')[0] ?? ''))
      .join('}');
    expect(focus).toMatch(/::before[^{]*\{[^}]*transform\s*:\s*scaleX\(0\)/);
    expect(focus).not.toMatch(/outline\s*:\s*(none|0)/);
  });

  it('武館大門：舊的閘門館徽（兩張 <img> 疊掃光）已拿掉、匾上的館徽改由 gate.css 的背景圖；門的動態只用 transform／opacity（不動版面、不用 WebGL）；沒有 background-clip:text、混色模式、外發光', () => {
    expect(css + gateCss).not.toMatch(/gate__crest-(img|sheen)/);
    expect(css).not.toMatch(/gate__crest/);
    const gateRules = (css + gateCss)
      .split('}')
      .filter((rule) => /\.gate(__|\b)/.test(rule) && !rule.includes('@keyframes'))
      .join('}');
    expect(gateRules).not.toMatch(/background-clip|mix-blend-mode|text-shadow|box-shadow/);
    for (const [, value] of gateRules.matchAll(/transition\s*:\s*([^;]*);/g)) {
      for (const part of value!.split(/,(?![^(]*\))/)) expect(part.trim().split(/\s+/)[0], `transition「${part.trim()}」`).toMatch(/^(transform|opacity)$/);
    }
    // 三層的位置是同一組百分比（門洞 x 448–1061、y 228–805，圖 1536×1024）
    const scene = /(?:^|\n)\.gate__scene\s*\{([^}]*)\}/.exec(gateCss)?.[1] ?? '';
    expect(scene).toMatch(/aspect-ratio\s*:\s*1536\s*\/\s*1024/);
    // 場景寬用 svh（與 Gate.astro 的 sizes 同一把尺，不用會隨網址列抖動的 vh）
    expect(scene).toMatch(/width\s*:\s*min\(max\(100vw,\s*150svh\),\s*168svh,\s*230vw\)/);
    const gate = readFileSync(new URL('../../src/components/home/Gate.astro', import.meta.url), 'utf8');
    for (const [, sizes] of gate.matchAll(/sizes:\s*'([^']*)'/g)) expect(sizes).not.toMatch(/\d(vh)\b/);
    expect(gate).toContain('min(max(100vw, 150svh), 168svh, 230vw)');
  });

  it('門扇以門軸為中心向內開：左扇 transform-origin 在左、右扇在右；進入時 rotateY（左正右負）；指到門、或用鍵盤操作過之後按鈕聚焦時微開', () => {
    expect(/\.gate__leaf--left\s*\{([^}]*)\}/.exec(gateCss)?.[1] ?? '').toMatch(/transform-origin\s*:\s*left/);
    expect(/\.gate__leaf--right\s*\{([^}]*)\}/.exec(gateCss)?.[1] ?? '').toMatch(/transform-origin\s*:\s*right/);
    expect(/html\[data-gate='leaving'\]\s+\.gate__leaf--left\s*\{([^}]*)\}/.exec(gateCss)?.[1] ?? '').toMatch(/rotateY\(\s*[1-9]\d*deg\)/);
    expect(/html\[data-gate='leaving'\]\s+\.gate__leaf--right\s*\{([^}]*)\}/.exec(gateCss)?.[1] ?? '').toMatch(/rotateY\(\s*-[1-9]\d*deg\)/);
    expect(gateCss).toMatch(/\.gate__door:hover[^{]*\.gate__leaf--left[^{]*\{[^}]*rotateY\(\s*[0-3](\.\d+)?deg\)/);
    expect(gateCss).not.toMatch(/\.gate__scene:hover/);
    // 一進站按鈕就有焦點（看得見的細框），門不能因此一開始就微開：鍵盤操作過（gate.ts 標 data-keyed）才跟著焦點微開
    expect(gateCss).toMatch(/\.gate\[data-keyed\]\s+\.gate__enter:focus-visible[^{]*\.gate__leaf--left/);
    expect(gateCss).not.toMatch(/(^|[,}\s])html\[data-gate='open'\]\s+\.gate__enter:focus-visible/);
  });

  it('淡出：html[data-gate="leaving"] 把背板與對話框的 opacity 降到 0；按鈕不再接收指標', () => {
    const fade = /html\[data-gate='leaving'\]\s+\.gate,\s*html\[data-gate='leaving'\]\s+\.gate-backdrop\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(fade).toMatch(/opacity\s*:\s*0/);
    expect(css).toMatch(/html\[data-gate='leaving'\]\s+\.gate\s*>\s*\.gate__enter\s*\{[^}]*pointer-events\s*:\s*none/);
  });

  it('閘門還在（開著或開門、淡出中）時站名組不演進場動畫、先不透明度 0；閘門收起才演（不會在門後演完）', () => {
    // 特異度要高過 `html.js .opening__lockup > *`（進場動畫，排在後面）：html.js[data-gate]
    const rule = /html\.js\[data-gate\]\s+\.opening__lockup\s*>\s*\*\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/animation\s*:\s*none/);
    expect(rule).toMatch(/opacity\s*:\s*0/);
    expect(css).not.toMatch(/html\[data-gate='open'\]\s+\.opening__lockup/);
  });

  it('Gate.astro：role=dialog、aria-modal、aria-label="入館"；按鈕沿用 .button；門純裝飾（aria-hidden、圖 alt 為空）、三層圖、匾上的字是 HTML 文字', () => {
    const gate = readFileSync(new URL('../../src/components/home/Gate.astro', import.meta.url), 'utf8');
    expect(gate).toMatch(/<div class="gate" data-gate-dialog role="dialog" aria-modal="true" aria-label="入館">/);
    expect(gate).toMatch(/<button type="button" class="button gate__enter" data-gate-enter>入館<\/button>/);
    expect(gate).toMatch(/<div class="gate__scene" data-gate-door aria-hidden="true">/);
    expect(gate).toMatch(/alt: ''/);
    expect(gate).not.toMatch(/crest-lion|data-crest/);
    for (const layer of ['gate-frame', 'gate-leaf-left', 'gate-leaf-right']) expect(gate).toContain(`images/gate/${layer}.webp`);
    expect(gate).toMatch(/loading: 'lazy'/);
    // 匾：「六藝」「武術」是 HTML 真字型，燙金館徽在正中（Task 28 第二輪，使用者要求「大門應該要有六藝的 logo，且也是要有金屬光澤」）
    expect(gate).toMatch(/<span class="gate__plaque"><span>六藝<\/span><span class="gate__crest" data-gate-crest><\/span><span>武術<\/span><\/span>/);
  });

  it('匾上的館徽：沿用開場區那一張燙金獅子（gate.ts 取它挑到的同一個檔案，快取命中、不多下載；閘門沒顯示就不設、不下載），金屬掃光（同一套 --sheen-x 斜帶遮罩與 crest-sweep），指到門上掃一次；不發光、不用漸層字', () => {
    const rule = /(?:^|\n)\.gate__crest\s*\{([^}]*)\}/.exec(gateCss)?.[1] ?? '';
    expect(rule).toMatch(/background\s*:[^;]*var\(--crest\)/);
    const sheen = /(?:^|\n)\.gate__crest::after\s*\{([^}]*)\}/.exec(gateCss)?.[1] ?? '';
    expect(sheen).toMatch(/mask-image\s*:[^;]*var\(--sheen-x\)/);
    expect(sheen).toMatch(/filter\s*:\s*brightness\(/);
    expect(gateCss).toMatch(/\.gate__crest::after\s*\{[^}]*animation\s*:\s*crest-sweep/);
    expect(gateCss).toMatch(/\.gate__door:hover\)[^{]*\.gate__crest::after\s*\{[^}]*animation\s*:\s*crest-sweep/);
    const crestRules = gateCss.split('}').filter((r) => r.includes('gate__crest')).join('}');
    expect(crestRules).not.toMatch(/background-clip|text-shadow|box-shadow|drop-shadow/);
    const script = readFileSync(new URL('../../src/scripts/home/gate.ts', import.meta.url), 'utf8');
    expect(script).toMatch(/querySelector<HTMLImageElement>\('\.opening__crest-img'\)/);
    expect(script).toMatch(/setProperty\('--crest'/);
  });

  it('gate.ts：任何退出路徑都拿掉自己掛的監聽（keydown、點按鈕、點門）', () => {
    const script = readFileSync(new URL('../../src/scripts/home/gate.ts', import.meta.url), 'utf8');
    const finish = /const finish = [\s\S]*?\n {2}\};/.exec(script)?.[0] ?? '';
    expect(finish).toMatch(/document\.removeEventListener\('keydown', onKey\)/);
    expect(finish).toMatch(/button\.removeEventListener\('click', enter\)/);
    expect(finish).toMatch(/hit\?\.removeEventListener\('click', enter\)/);
  });

  it('首頁把 Gate 放在 <BaseLayout> 的 overlay 插槽（body 的最後，不改變內容的 DOM 順序）', () => {
    const index = readFileSync(new URL('../../src/pages/index.astro', import.meta.url), 'utf8');
    expect(index).toContain('<Gate slot="overlay" />');
    const layout = readFileSync(new URL('../../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');
    expect(layout.indexOf('<PosterDialog />')).toBeLessThan(layout.indexOf('<slot name="overlay" />'));
    expect(layout.indexOf('<slot />')).toBeLessThan(layout.indexOf('<slot name="overlay" />'));
  });
});
