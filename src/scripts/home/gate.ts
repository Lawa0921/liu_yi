// 入館閘門的接線（Task 25）：首頁腳本一開始就呼叫 `initGate`，之後引擎與開場都要等閘門收起。
//
//   - 要不要顯示由 <head> 的行內腳本在首繪前決定（BaseLayout 標 `html[data-gate="open"]`；判斷式見 `intro-gate.ts` 的 `shouldShowGate`）。
//     沒有這個屬性就沒有閘門（`initGate` 回一個「已收起」的 Gate）。
//   - 「入館」按鈕在腳本接手（對話框標 `data-ready`）之前不可見、不可點。
//   - 閘門開著：`html[data-gate]` 讓 home.css 鎖住捲動（`overflow: hidden` 於 html）、顯示閘門、把引擎的畫布抬到閘門的背板之上（光點飄在閘門上）；
//     這裡再把 body 底下閘門以外的內容設 `inert`（背景不可聚焦、不進無障礙樹）、焦點放在「入館」按鈕。
//   - 進入（點按鈕、Enter、空白鍵）：記「這個工作階段進過館」、`data-gate="leaving"`（CSS 淡出，`GATE_FADE_MS`），淡出結束才真正收起：
//     還原捲動（拿掉屬性）、還原 inert、焦點移到 main（不捲動），`closed` 此時 resolve——首頁腳本接著才開始開場。
//   - 任何退出路徑都要還原：進入、`removeNow`（引擎掛不上、退回靜態圖、離開頁面）都走同一個 `finish`，只進一次。
//   - 保險：腳本若載不到（網路、被擋），閘門就永遠沒人收——<head> 的行內腳本在 `GATE_SAFETY_MS` 後（若這個檔案沒有接手，`window.__qiGate`）自己拿掉屬性。
// 這個檔案會被打進首頁的腳本：程式字串只用英文（字型守門會掃 JS 裡的中文字）。

import { markIntroSeen } from './intro-gate';

/** 閘門淡出的時間（毫秒）：需求 ≤ 600 ms。home.css 的 transition 與它同一個數字（單元測試對照）。 */
export const GATE_FADE_MS = 500;
/** <head> 行內腳本的保險：這麼久（毫秒）之後首頁腳本還沒接手，就拿掉閘門。BaseLayout 寫死同一個數字（單元測試對照）。 */
export const GATE_SAFETY_MS = 10_000;

export type GateOutcome = 'entered' | 'removed';

export interface Gate {
  /** 閘門還擋著嗎：開著或淡出中都算（淡出結束、真正收起才是 false）。 */
  isHolding(): boolean;
  /** 閘門收起時 resolve（進入或被移除）；沒有閘門時一開始就是 resolved。 */
  readonly closed: Promise<GateOutcome>;
  /** 立刻收起（不淡出）：引擎掛不上、退回靜態圖。重複呼叫無妨。 */
  removeNow(): void;
}

declare global {
  interface Window {
    /** 首頁腳本已接手閘門（<head> 的保險計時器看到它就不動作）。 */
    __qiGate?: boolean;
  }
}

const NO_GATE: Gate = { isHolding: () => false, closed: Promise.resolve('removed'), removeNow: () => undefined };

/** 閘門開著時要設 inert 的 body 子節點：閘門自己、不是 HTML 元素的（內嵌的 svg 濾鏡定義）與不是內容的標籤不算。 */
function backgroundNodes(skip: Element[]): HTMLElement[] {
  return Array.from(document.body.children).filter((el): el is HTMLElement => {
    if (skip.includes(el) || !(el instanceof HTMLElement)) return false;
    return !(el instanceof HTMLScriptElement || el instanceof HTMLStyleElement || el instanceof HTMLLinkElement || el.hasAttribute('inert'));
  });
}

export function initGate(session: Pick<Storage, 'setItem'> | null): Gate {
  const root = document.documentElement;
  if (root.dataset.gate !== 'open') return NO_GATE;
  const dialog = document.querySelector<HTMLElement>('[data-gate-dialog]');
  const backdrop = document.querySelector<HTMLElement>('[data-gate-backdrop]');
  const button = dialog?.querySelector<HTMLButtonElement>('[data-gate-enter]');
  if (!dialog || !backdrop || !button) {
    delete root.dataset.gate; // 標記說要開、但閘門的標記不在：不能留一個鎖住捲動的空殼
    return NO_GATE;
  }
  window.__qiGate = true;

  let state: 'open' | 'leaving' | 'closed' = 'open';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveClosed!: (outcome: GateOutcome) => void;
  const closed = new Promise<GateOutcome>((resolve) => {
    resolveClosed = resolve;
  });

  // 背景不可聚焦、不進無障礙樹（只設我們自己設的，收起時只還原這些）
  const inerted = backgroundNodes([dialog, backdrop]);
  for (const el of inerted) el.setAttribute('inert', '');

  // 館徽圖載入後才淡入（閘門是第一印象，不讓圖「啪」地跳出來）；載入失敗也照樣露出（空白而已，按鈕仍可用）
  const crest = dialog.querySelector<HTMLElement>('[data-crest]');
  if (crest) {
    const images = Array.from(crest.querySelectorAll('img'));
    for (const img of images) img.loading = 'eager'; // 閘門開著才會走到這裡：立刻載，不等延後載入
    const reveal = (): void => {
      crest.dataset.ready = '';
    };
    const pending = images.filter((img) => !(img.complete && img.naturalWidth > 0));
    if (pending.length === 0) reveal();
    else {
      let left = pending.length;
      for (const img of pending) {
        const done = (): void => {
          if (--left === 0) reveal();
        };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }
    }
  }

  const finish = (outcome: GateOutcome): void => {
    if (state === 'closed') return;
    state = 'closed';
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    for (const el of inerted) el.removeAttribute('inert');
    const active = document.activeElement;
    const hadFocus = !active || active === document.body || dialog.contains(active);
    delete root.dataset.gate; // 還原捲動與顯示（任何退出路徑都經過這裡）
    if (hadFocus) {
      const main = document.querySelector<HTMLElement>('main');
      if (main) {
        main.tabIndex = -1;
        main.focus({ preventScroll: true }); // 不捲動：進入後停在頁首
      }
    }
    resolveClosed(outcome);
  };

  const enter = (): void => {
    if (state !== 'open') return;
    state = 'leaving';
    markIntroSeen(session); // 這個工作階段進過館了：再訪不再顯示閘門，也不再演開場
    root.dataset.gate = 'leaving';
    timer = setTimeout(() => finish('entered'), GATE_FADE_MS);
  };

  // Enter／空白鍵：焦點在按鈕上時由按鈕自己的 click 處理；焦點掉到別處（點了背板）時也要能進入
  const onKey = (event: KeyboardEvent): void => {
    if (state !== 'open') return;
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    if (event.target === button) return;
    event.preventDefault();
    enter();
  };
  document.addEventListener('keydown', onKey);
  button.addEventListener('click', enter);
  dialog.dataset.ready = ''; // 接線完成：按鈕這時才看得到、點得到（home.css；先於 focus，隱藏的元素聚焦不了）
  button.focus({ preventScroll: true });

  return {
    isHolding: () => state !== 'closed',
    closed,
    removeNow: () => finish('removed'),
  };
}
