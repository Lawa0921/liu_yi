import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { GATE_FADE_MS, GATE_OPEN_MS, GATE_SAFETY_MS, GATE_VEIL_MS } from '../../src/scripts/home/gate';
import { INTRO_STORAGE_KEY, shouldShowGate } from '../../src/scripts/home/intro-gate';

// <head> 的行內腳本（BaseLayout）在首繪前決定要不要顯示入館閘門（html[data-gate="open"]）。腳本不能 import，
// 所以判斷式寫了兩份：這裡把那段腳本原封不動丟進 vm、用假的 window／document 跑，結果必須與純函式 `shouldShowGate` 完全一致。
const layout = readFileSync(new URL('../../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');
const script = /<script is:inline data-probe-engine=\{home \? '' : undefined\}[^>]*>([\s\S]*?)<\/script>/.exec(layout)?.[1] ?? '';

interface Scenario {
  reducedMotion: boolean;
  webgl2: boolean;
  visited: boolean;
  hash: string;
  referrer: string;
  /** 首頁才探測（`data-probe-engine`）；其他頁沒有。 */
  home?: boolean;
  /** sessionStorage 讀取丟例外（隱私模式）。 */
  blockedStorage?: boolean;
  base?: string;
}

const ORIGIN = 'https://site.example';

function runHead(s: Scenario): {
  gate: string | undefined;
  qiStatic: boolean;
  crest: string | undefined;
  timers: { fn: () => void; ms: number }[];
  win: Record<string, unknown>;
  links: Record<string, string>[];
} {
  const dataset: Record<string, string | undefined> = { base: s.base ?? '/liu_yi/', audienceKey: 'k' };
  const classes = new Set<string>();
  const timers: { fn: () => void; ms: number }[] = [];
  const links: Record<string, string>[] = [];
  const win: Record<string, unknown> = {
    localStorage: { getItem: () => null },
    sessionStorage: {
      getItem: (key: string) => {
        if (s.blockedStorage) throw new DOMException('blocked', 'SecurityError');
        return key === INTRO_STORAGE_KEY && s.visited ? '1' : null;
      },
    },
    matchMedia: (query: string) => ({ matches: /prefers-reduced-motion/.test(query) && s.reducedMotion }),
    location: { hash: s.hash, origin: ORIGIN },
    setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }),
  };
  const document = {
    documentElement: { dataset, classList: { add: (name: string) => classes.add(name) } },
    currentScript:
      s.home === false
        ? { hasAttribute: () => false, getAttribute: () => null }
        : { hasAttribute: (name: string) => name === 'data-probe-engine', getAttribute: (name: string) => (name === 'data-gate-css' ? '/liu_yi/_astro/gate.x.css' : null) },
    referrer: s.referrer,
    head: { appendChild: (el: Record<string, string>) => links.push(el) },
    createElement: (tag: string) => {
      if (tag === 'link') {
        const el: Record<string, string> & { setAttribute?: (k: string, v: string) => void } = {};
        el.setAttribute = (k: string, v: string) => {
          el[k] = v;
        };
        return el;
      }
      return {
        getContext: (type: string) => (type === 'webgl2' && s.webgl2 ? { getExtension: () => ({ loseContext: () => undefined }) } : null),
      };
    },
  };
  win.document = document;
  win.window = win;
  runInNewContext(script, { ...win, window: win, document });
  return { gate: dataset.gate, qiStatic: classes.has('qi-static'), crest: dataset.qiCrest, timers, win, links };
}

describe('<head> 行內腳本的閘門判斷與 shouldShowGate 一致', () => {
  it('抽得到行內腳本（防止改了 BaseLayout 之後這支測試空轉）', () => {
    expect(script.length).toBeGreaterThan(200);
    expect(script).toContain("root.dataset.gate = 'open'");
  });

  it('鍵與純函式的檔案同一把：行內腳本讀的是 liuyi:qi-intro', () => {
    expect(script).toContain(`'${INTRO_STORAGE_KEY}'`);
  });

  it('reducedMotion × WebGL2 × 進過館 × 錨點 × 站內來 的 32 種組合：與 shouldShowGate 逐一相同', () => {
    let shown = 0;
    for (let bits = 0; bits < 32; bits++) {
      const reducedMotion = (bits & 1) !== 0;
      const webgl2 = (bits & 2) === 0;
      const visited = (bits & 4) !== 0;
      const hasHash = (bits & 8) !== 0;
      const fromSite = (bits & 16) !== 0;
      const result = runHead({
        reducedMotion,
        webgl2,
        visited,
        hash: hasHash ? '#booking' : '',
        referrer: fromSite ? `${ORIGIN}/liu_yi/courses/` : '',
      });
      const expected = shouldShowGate({ reducedMotion, noWebgl: !webgl2, visited, hasHash, fromSite });
      expect(result.gate === 'open', `reducedMotion=${reducedMotion} webgl2=${webgl2} visited=${visited} hash=${hasHash} fromSite=${fromSite}`).toBe(expected);
      if (expected) shown++;
    }
    expect(shown).toBe(1);
  });

  it('只有 "#" 沒有錨點名稱：不算帶錨點（location.hash 是空字串，仍擋）', () => {
    expect(runHead({ reducedMotion: false, webgl2: true, visited: false, hash: '', referrer: '' }).gate).toBe('open');
  });

  it('referrer 是別的網站、或同網域但不在本站 base 底下：不算站內來，照擋', () => {
    expect(runHead({ reducedMotion: false, webgl2: true, visited: false, hash: '', referrer: 'https://www.google.com/' }).gate).toBe('open');
    expect(runHead({ reducedMotion: false, webgl2: true, visited: false, hash: '', referrer: `${ORIGIN}/another-project/` }).gate).toBe('open');
    expect(runHead({ reducedMotion: false, webgl2: true, visited: false, hash: '', referrer: `${ORIGIN}/liu_yi/` }).gate, '本站首頁自己').toBeUndefined();
  });

  it('根路徑建置（base = "/"）：同網域的 referrer 都算站內', () => {
    expect(runHead({ reducedMotion: false, webgl2: true, visited: false, hash: '', referrer: `${ORIGIN}/courses/`, base: '/' }).gate).toBeUndefined();
    expect(runHead({ reducedMotion: false, webgl2: true, visited: false, hash: '', referrer: 'https://other.example/', base: '/' }).gate).toBe('open');
  });

  it('sessionStorage 被封鎖（讀取丟例外）：當作沒進過，照樣顯示閘門（RF3）', () => {
    const result = runHead({ reducedMotion: false, webgl2: true, visited: false, hash: '', referrer: '', blockedStorage: true });
    expect(result.gate).toBe('open');
    expect(result.crest).toBeUndefined();
  });

  it('不是首頁（沒有 data-probe-engine）：不探測、不顯示閘門', () => {
    const result = runHead({ reducedMotion: false, webgl2: true, visited: false, hash: '', referrer: '', home: false });
    expect(result.gate).toBeUndefined();
    expect(result.qiStatic).toBe(false);
  });

  it('進過館的訪客：館徽直接是終態（data-qi-crest="shown"），沒有閘門', () => {
    const result = runHead({ reducedMotion: false, webgl2: true, visited: true, hash: '', referrer: '' });
    expect(result.crest).toBe('shown');
    expect(result.gate).toBeUndefined();
  });
});

describe('閘門的保險計時器', () => {
  const open = () => runHead({ reducedMotion: false, webgl2: true, visited: false, hash: '', referrer: '' });

  it('顯示閘門時排一個 GATE_SAFETY_MS 的計時器（沒顯示就不排）', () => {
    expect(GATE_SAFETY_MS).toBe(10_000);
    expect(open().timers.map((t) => t.ms)).toEqual([GATE_SAFETY_MS]);
    expect(runHead({ reducedMotion: false, webgl2: true, visited: true, hash: '', referrer: '' }).timers).toEqual([]);
  });

  it('首頁腳本沒接手（window.__qiGate 沒設）：時間到就拿掉 data-gate，閘門不會永遠擋著', () => {
    const result = open();
    const root = (result.win.document as { documentElement: { dataset: Record<string, string | undefined> } }).documentElement;
    expect(root.dataset.gate).toBe('open');
    result.timers[0]!.fn();
    expect(root.dataset.gate).toBeUndefined();
  });

  it('首頁腳本已接手（window.__qiGate 為真）：計時器不動作，閘門由腳本自己收', () => {
    const result = open();
    const root = (result.win.document as { documentElement: { dataset: Record<string, string | undefined> } }).documentElement;
    result.win.__qiGate = true;
    result.timers[0]!.fn();
    expect(root.dataset.gate).toBe('open');
  });
});

describe('門的樣式只在閘門顯示時才載入（Task 28：再訪不下載）', () => {
  it('閘門顯示：<head> 的行內腳本插入 gate.css 的 <link>，標 blocking="render"（樣式到之前不首繪，門不會閃一下沒排版的樣子）', () => {
    const result = runHead({ reducedMotion: false, webgl2: true, visited: false, hash: '', referrer: '' });
    expect(result.gate).toBe('open');
    expect(result.links).toHaveLength(1);
    expect(result.links[0]).toMatchObject({ rel: 'stylesheet', href: '/liu_yi/_astro/gate.x.css', blocking: 'render' });
  });

  it('閘門不顯示（再訪、減少動態、帶錨點）或不是首頁：不插入、不下載', () => {
    expect(runHead({ reducedMotion: false, webgl2: true, visited: true, hash: '', referrer: '' }).links).toEqual([]);
    expect(runHead({ reducedMotion: true, webgl2: true, visited: false, hash: '', referrer: '' }).links).toEqual([]);
    expect(runHead({ reducedMotion: false, webgl2: true, visited: false, hash: '#booking', referrer: '' }).links).toEqual([]);
    expect(runHead({ reducedMotion: false, webgl2: true, visited: false, hash: '', referrer: '', home: false }).links).toEqual([]);
  });
});

describe('閘門的時間常數與 CSS 一致', () => {
  // 門本身的規則在 gate.css（只在閘門顯示時載入），外殼與淡出在 home.css：兩份接起來看
  const css = ['home.css', 'gate.css']
    .map((name) => readFileSync(new URL(`../../src/styles/${name}`, import.meta.url), 'utf8'))
    .join('\n')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  /** 某條規則（選擇器原文）的宣告區塊。 */
  const block = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    return at === -1 ? '' : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };
  /** `transition: <prop> <dur>s <easing> [<delay>s]` → 毫秒。 */
  const timing = (decl: string, prop: string): { duration: number; delay: number } | null => {
    const m = new RegExp(`${prop}\\s+([\\d.]+)s\\s+[^,;]*?(?:\\s([\\d.]+)s)?\\s*[,;]`).exec(decl);
    return m ? { duration: Math.round(Number(m[1]) * 1000), delay: Math.round(Number(m[2] ?? 0) * 1000) } : null;
  };

  it('進入（開門 → 推進 → 淡出）整段 ≤ 1.6 s；GATE_FADE_MS 就是整段，CSS 的最後淡出剛好在這一刻結束', () => {
    expect(GATE_FADE_MS).toBeGreaterThan(GATE_VEIL_MS);
    expect(GATE_FADE_MS).toBeLessThanOrEqual(1600);
    const fade = block("html[data-gate='leaving'] .gate,\nhtml[data-gate='leaving'] .gate-backdrop");
    expect(fade).toMatch(/opacity\s*:\s*0/);
    const t = timing(fade, 'opacity');
    expect(t, '淡出的 transition').not.toBeNull();
    expect(t!.duration).toBe(GATE_VEIL_MS);
    expect(t!.duration + t!.delay, '淡出結束＝GATE_FADE_MS').toBe(GATE_FADE_MS);
  });

  it('門扇向內打開用 GATE_OPEN_MS（在淡出開始前開到底）；場景往前推用整段 GATE_FADE_MS', () => {
    const leaf = timing(block('.gate__leaf'), 'transform');
    expect(leaf, '門扇的 transform transition').not.toBeNull();
    expect(leaf!.duration).toBe(GATE_OPEN_MS);
    expect(GATE_OPEN_MS).toBeLessThanOrEqual(GATE_FADE_MS - GATE_VEIL_MS + 200);
    const push = timing(block("html[data-gate='leaving'] .gate__scene"), 'transform');
    expect(push, '場景推進的 transition').not.toBeNull();
    expect(push!.duration + push!.delay).toBe(GATE_FADE_MS);
  });
});
