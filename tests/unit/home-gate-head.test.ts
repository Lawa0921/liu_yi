import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { GATE_FADE_MS, GATE_SAFETY_MS } from '../../src/scripts/home/gate';
import { INTRO_STORAGE_KEY, shouldShowGate } from '../../src/scripts/home/intro-gate';

// <head> 的行內腳本（BaseLayout）在首繪前決定要不要顯示入館閘門（html[data-gate="open"]）。腳本不能 import，
// 所以判斷式寫了兩份：這裡把那段腳本原封不動丟進 vm、用假的 window／document 跑，結果必須與純函式 `shouldShowGate` 完全一致。
const layout = readFileSync(new URL('../../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');
const script = /<script is:inline data-probe-engine=\{home \|\| qi \? '' : undefined\} data-probe-gate=\{home \? '' : undefined\}>([\s\S]*?)<\/script>/.exec(layout)?.[1] ?? '';

interface Scenario {
  reducedMotion: boolean;
  webgl2: boolean;
  visited: boolean;
  hash: string;
  referrer: string;
  /**
   * 哪一種頁面：'home'（預設）＝首頁，有 `data-probe-engine` 與 `data-probe-gate`；'qi'＝其他有光點層的頁面（Task 26），只有 `data-probe-engine`（探測 WebGL2，不做閘門）；
   * 'none'＝沒有光點的頁面，什麼都沒有。
   */
  page?: 'home' | 'qi' | 'none';
  /** sessionStorage 讀取丟例外（隱私模式）。 */
  blockedStorage?: boolean;
  base?: string;
}

const ORIGIN = 'https://site.example';

function runHead(s: Scenario): { gate: string | undefined; qiStatic: boolean; crest: string | undefined; timers: { fn: () => void; ms: number }[]; win: Record<string, unknown> } {
  const dataset: Record<string, string | undefined> = { base: s.base ?? '/liu_yi/', audienceKey: 'k' };
  const classes = new Set<string>();
  const timers: { fn: () => void; ms: number }[] = [];
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
    currentScript: {
      hasAttribute: (name: string) => {
        const page = s.page ?? 'home';
        if (name === 'data-probe-engine') return page !== 'none';
        if (name === 'data-probe-gate') return page === 'home';
        return false;
      },
    },
    referrer: s.referrer,
    createElement: () => ({
      getContext: (type: string) => (type === 'webgl2' && s.webgl2 ? { getExtension: () => ({ loseContext: () => undefined }) } : null),
    }),
  };
  win.document = document;
  win.window = win;
  runInNewContext(script, { ...win, window: win, document });
  return { gate: dataset.gate, qiStatic: classes.has('qi-static'), crest: dataset.qiCrest, timers, win };
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

  it('沒有光點的頁面（沒有 data-probe-engine）：不探測、不顯示閘門', () => {
    const result = runHead({ reducedMotion: false, webgl2: false, visited: false, hash: '', referrer: '', page: 'none' });
    expect(result.gate).toBeUndefined();
    expect(result.qiStatic).toBe(false);
  });

  // Task 26：其他頁面也有光點層，head 要在首繪前判定 html.qi-static（靜態圖要不要顯示只由 CSS 決定），但閘門與館徽只屬於首頁。
  describe('有光點層的其他頁面（只有 data-probe-engine，沒有 data-probe-gate）', () => {
    it('減少動態或沒有 WebGL2：標 html.qi-static；有 WebGL2 且沒減少動態：不標', () => {
      expect(runHead({ reducedMotion: true, webgl2: true, visited: false, hash: '', referrer: '', page: 'qi' }).qiStatic).toBe(true);
      expect(runHead({ reducedMotion: false, webgl2: false, visited: false, hash: '', referrer: '', page: 'qi' }).qiStatic).toBe(true);
      expect(runHead({ reducedMotion: false, webgl2: true, visited: false, hash: '', referrer: '', page: 'qi' }).qiStatic).toBe(false);
    });

    it('永遠不顯示閘門、不標館徽、不排保險計時器（那是首頁的事），不論有沒有進過館、帶不帶錨點、從哪裡來', () => {
      for (const visited of [false, true]) {
        for (const hash of ['', '#booking']) {
          for (const referrer of ['', `${ORIGIN}/liu_yi/courses/`]) {
            const result = runHead({ reducedMotion: false, webgl2: true, visited, hash, referrer, page: 'qi' });
            expect(result.gate, `${visited}/${hash}/${referrer}`).toBeUndefined();
            expect(result.crest, `${visited}/${hash}/${referrer}`).toBeUndefined();
            expect(result.timers).toEqual([]);
          }
        }
      }
    });
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

describe('閘門的時間常數與 CSS 一致', () => {
  const css = readFileSync(new URL('../../src/styles/home.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('淡出 ≤ 600 ms，CSS 的 transition 與 GATE_FADE_MS 是同一個數字', () => {
    expect(GATE_FADE_MS).toBeGreaterThan(0);
    expect(GATE_FADE_MS).toBeLessThanOrEqual(600);
    const fade = /html\[data-gate='leaving'\][^{]*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(fade).toMatch(/opacity\s*:\s*0/);
    expect(fade).toContain(`transition: opacity ${GATE_FADE_MS / 1000}s`);
  });
});
