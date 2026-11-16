// 首頁退回靜態圖（D20）：減少動態、沒有 WebGL2、引擎掛不上、WebGL context 中途遺失、離開頁面（引擎釋放），都走同一個 `enterStatic`。
//
//   - `<head>` 的行內腳本（BaseLayout）在首繪前先加 `html.qi-static`（減少動態或探測不到 WebGL2）；靜態圖是否顯示只由 CSS 決定。
//   - 這裡補上腳本能做的部分：`data-qi-mode="static"` 與 `data-qi-reason`、拿掉 `data-qi-ready`（海報淡出的條件，拿掉它海報才會回來）、
//     開場記為 skipped、收起略過鈕（`hidden`，不從 DOM 移除；焦點正在鈕上就先移到 main，不讓鍵盤使用者掉回頁面開頭），
//     並通知引擎端停掉自己的東西（rAF、舞台、觀察者；用 `onEnterStatic` 登記）。
//   - 只進一次：第二次呼叫沒有作用，原因以第一次為準。
// 這個檔案會被打進首頁的腳本：程式字串與錯誤訊息只用英文（字型守門會掃 JS 裡的中文字）。

export type StaticReason = 'reduced-motion' | 'no-webgl' | 'context-lost' | 'init-failed' | 'page-hide';

type Listener = (reason: StaticReason) => void;

const listeners = new Set<Listener>();

/** 已經退回靜態圖了嗎（以 `<html data-qi-mode>` 為準）。 */
export function isStatic(): boolean {
  return document.documentElement.dataset.qiMode === 'static';
}

/**
 * 登記「進入靜態後要停掉什麼」。進入靜態時各呼叫一次（依登記順序，帶原因）；回傳取消登記的函式。
 * 已經是靜態才登記：立刻呼叫一次，不會漏掉。
 */
export function onEnterStatic(listener: Listener): () => void {
  if (isStatic()) {
    listener(document.documentElement.dataset.qiReason as StaticReason);
    return () => undefined;
  }
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * 收起略過鈕。焦點正在鈕上（鍵盤使用者按 Tab 停在它上面時引擎掉了）就先移到 `main`：
 * 鈕一隱藏，焦點會掉回 `body`，下一次 Tab 又從頁面最前面開始。`main` 要有 tabindex 才接得住焦點（外框由 home.css 關掉）。
 */
function hideSkipButtons(): void {
  const active = document.activeElement;
  for (const button of document.querySelectorAll<HTMLElement>('[data-skip-intro]')) {
    if (active && button.contains(active)) {
      const main = document.querySelector<HTMLElement>('main');
      if (main) {
        main.tabIndex = -1;
        main.focus({ preventScroll: true });
      }
    }
    button.hidden = true;
  }
}

export function enterStatic(reason: StaticReason): void {
  if (isStatic()) return;
  const root = document.documentElement;
  root.classList.add('qi-static');
  root.dataset.qiMode = 'static';
  root.dataset.qiReason = reason;
  delete root.dataset.qiReady;
  // 還在播的（或從沒演過的）開場記為 skipped；已經演完的保留 done。
  if (root.dataset.qiIntro === undefined || root.dataset.qiIntro === 'playing') root.dataset.qiIntro = 'skipped';
  hideSkipButtons();

  const pending = [...listeners];
  listeners.clear();
  for (const listener of pending) {
    try {
      listener(reason);
    } catch (error) {
      console.warn('A static-fallback listener failed.', error);
    }
  }
}
