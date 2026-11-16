import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 首頁退回靜態圖（Task 20）：`enterStatic` 只動 <html> 的 class／data 屬性、收起略過鈕（焦點在上面就先移到 main），
 * 並通知引擎端停掉自己的東西。測試環境是 node，沒有 DOM，所以只給 `fallback.ts` 用到的那一點：
 * `document.documentElement`（classList、dataset）、`document.querySelectorAll('[data-skip-intro]')`、
 * `document.querySelector('main')`、`document.activeElement`。
 */
type Dataset = Record<string, string | undefined>;

interface FakeButton {
  hidden: boolean;
  contains(node: unknown): boolean;
}

function fakeDocument(initial: Dataset = {}, skipButtons = 1, focusedButton: number | null = null) {
  const classes = new Set<string>();
  const dataset: Dataset = { ...initial };
  const buttons: FakeButton[] = Array.from({ length: skipButtons }, () => ({
    hidden: false,
    contains(this: FakeButton, node: unknown) {
      return node === this;
    },
  }));
  const log: string[] = []; // 動作先後：'focus-main'、'hide-0'…
  const main = {
    tabIndex: 0,
    focusOptions: undefined as unknown,
    focus(options?: unknown) {
      main.focusOptions = options;
      log.push(`focus-main(tabIndex=${main.tabIndex})`);
    },
  };
  buttons.forEach((button, index) => {
    let hidden = button.hidden;
    Object.defineProperty(button, 'hidden', {
      get: () => hidden,
      set: (value: boolean) => {
        hidden = value;
        if (value) log.push(`hide-${index}`);
      },
    });
  });
  const body = {};
  const document = {
    documentElement: { classList: { add: (name: string) => void classes.add(name), contains: (name: string) => classes.has(name) }, dataset },
    activeElement: focusedButton === null ? body : buttons[focusedButton],
    querySelectorAll: (selector: string) => (selector === '[data-skip-intro]' ? buttons : []),
    querySelector: (selector: string) => (selector === 'main' ? main : null),
  };
  return { document, classes, dataset, buttons, main, log };
}

async function load() {
  vi.resetModules();
  return import('../../src/scripts/home/fallback');
}

beforeEach(() => {
  vi.stubGlobal('document', fakeDocument().document);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('enterStatic', () => {
  it('加 html.qi-static、data-qi-mode="static"、記下原因，並收起（hidden）[data-skip-intro]——不從 DOM 移除', async () => {
    const env = fakeDocument({}, 2);
    vi.stubGlobal('document', env.document);
    const { enterStatic } = await load();
    enterStatic('reduced-motion');
    expect(env.classes.has('qi-static')).toBe(true);
    expect(env.dataset.qiMode).toBe('static');
    expect(env.dataset.qiReason).toBe('reduced-motion');
    expect(env.buttons.map((button) => button.hidden)).toEqual([true, true]);
  });

  it('六種原因都收：reduced-motion、no-webgl、context-lost、init-failed、tier-failed、page-hide', async () => {
    for (const reason of ['reduced-motion', 'no-webgl', 'context-lost', 'init-failed', 'tier-failed', 'page-hide'] as const) {
      const env = fakeDocument();
      vi.stubGlobal('document', env.document);
      const { enterStatic } = await load();
      enterStatic(reason);
      expect(env.dataset.qiReason, reason).toBe(reason);
    }
  });

  it('焦點正在略過鈕上：先把焦點移到 main（不掉回 body；preventScroll、tabIndex 設成 -1 才能接焦點），再收起鈕', async () => {
    const env = fakeDocument({}, 1, 0);
    vi.stubGlobal('document', env.document);
    const { enterStatic } = await load();
    enterStatic('context-lost');
    expect(env.log).toEqual(['focus-main(tabIndex=-1)', 'hide-0']);
    expect(env.main.focusOptions).toEqual({ preventScroll: true });
  });

  it('焦點不在略過鈕上：不動焦點', async () => {
    const env = fakeDocument({}, 1, null);
    vi.stubGlobal('document', env.document);
    const { enterStatic } = await load();
    enterStatic('context-lost');
    expect(env.log).toEqual(['hide-0']);
  });

  it('引擎中途掉了：拿掉 data-qi-ready（海報才會回來），播放中的開場改成 skipped', async () => {
    const env = fakeDocument({ qiReady: 'true', qiIntro: 'playing', qiMode: 'webgl' });
    vi.stubGlobal('document', env.document);
    const { enterStatic } = await load();
    enterStatic('context-lost');
    expect(env.dataset.qiReady).toBeUndefined();
    expect(env.dataset.qiIntro).toBe('skipped');
    expect(env.dataset.qiMode).toBe('static');
  });

  it('開場已經演完（done）就保留 done；從沒演過（沒有屬性）記為 skipped', async () => {
    const done = fakeDocument({ qiIntro: 'done' });
    vi.stubGlobal('document', done.document);
    (await load()).enterStatic('context-lost');
    expect(done.dataset.qiIntro).toBe('done');

    const none = fakeDocument();
    vi.stubGlobal('document', none.document);
    (await load()).enterStatic('no-webgl');
    expect(none.dataset.qiIntro).toBe('skipped');
  });

  it('只進一次：第二次呼叫不重複通知，原因以第一次為準', async () => {
    const env = fakeDocument();
    vi.stubGlobal('document', env.document);
    const { enterStatic, onEnterStatic } = await load();
    const seen: string[] = [];
    onEnterStatic((reason) => seen.push(reason));
    enterStatic('context-lost');
    enterStatic('init-failed');
    expect(seen).toEqual(['context-lost']);
    expect(env.dataset.qiReason).toBe('context-lost');
  });

  it('沒有 [data-skip-intro]、沒有 main 也不丟錯', async () => {
    const env = fakeDocument({}, 0);
    vi.stubGlobal('document', { ...env.document, querySelector: () => null });
    const { enterStatic } = await load();
    expect(() => enterStatic('no-webgl')).not.toThrow();
  });
});

describe('onEnterStatic：引擎端登記「進入靜態後要停掉什麼」', () => {
  it('進入靜態時依登記順序各呼叫一次，帶原因；取消登記的不呼叫', async () => {
    const { enterStatic, onEnterStatic } = await load();
    const calls: string[] = [];
    onEnterStatic((reason) => calls.push(`a:${reason}`));
    const off = onEnterStatic((reason) => calls.push(`b:${reason}`));
    onEnterStatic((reason) => calls.push(`c:${reason}`));
    off();
    enterStatic('init-failed');
    expect(calls).toEqual(['a:init-failed', 'c:init-failed']);
  });

  it('某個登記者丟錯，其餘照常呼叫、enterStatic 不丟錯', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { enterStatic, onEnterStatic } = await load();
    const calls: string[] = [];
    onEnterStatic(() => {
      throw new Error('boom');
    });
    onEnterStatic(() => calls.push('after'));
    expect(() => enterStatic('context-lost')).not.toThrow();
    expect(calls).toEqual(['after']);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('已經是靜態時才登記：立刻呼叫一次（不會漏掉）', async () => {
    const env = fakeDocument({ qiMode: 'static', qiReason: 'reduced-motion' });
    vi.stubGlobal('document', env.document);
    const { onEnterStatic } = await load();
    const calls: string[] = [];
    onEnterStatic((reason) => calls.push(reason));
    expect(calls).toEqual(['reduced-motion']);
  });
});

describe('isStatic', () => {
  it('以 data-qi-mode 為準', async () => {
    const { enterStatic, isStatic } = await load();
    expect(isStatic()).toBe(false);
    enterStatic('no-webgl');
    expect(isStatic()).toBe(true);
  });
});
