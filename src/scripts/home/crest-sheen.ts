// 開場的燙金館徽（Task 24）與入館閘門的館徽（Task 25）上的金屬掃光：一道亮帶跟著指標（滑鼠、觸控筆）移動。
// 頁面上每個 [data-crest]（開場區一個、閘門一個）各自換算：把指標位置換成館徽盒子內的百分比，寫進它的 --sheen-x／--sheen-y，並標 data-pointer；
// 樣子（光核、斜帶、漸層遮罩）與「沒有指標時自動緩慢掃過」都是 home.css 的事（.opening__crest-sheen）。
// 觸控沒有「游標」：手指拖動是捲動，不是在指東西，所以忽略觸控，讓自動掃過照常進行。
// 減少動態：不掛監聽、不排 rAF，掃光靜止（CSS 也沒有動畫）。
// 這個檔案會被打進首頁的腳本：程式字串只用英文（字型守門會掃 JS 裡的中文字）。

/** 館徽進場前一直是擦掉的（home.css），要等開場落地或提早收尾才露出；引擎或形體載入卡住時，這麼久（毫秒）之後強制以終態露出，不讓館徽永遠不見。 */
export const CREST_FAILSAFE_MS = 7000;

/** 網址參數 `?qi-crest-failsafe=<ms|off>` 的最大值（毫秒）：超過就當成非法值。 */
const FAILSAFE_MAX_MS = 600_000;

/**
 * 逾時保險的毫秒數（可由網址參數注入，讓測試不必全域吞掉 7 秒的計時器）：
 *   - 沒帶參數、或值不合法（不是非負整數、超過上限、大小寫不同的 OFF…）：預設 `CREST_FAILSAFE_MS`；
 *   - `off`：回 `null`，不設逾時保險；
 *   - 非負整數字串（含 0）：照用。
 * `search` 是 `location.search`；純函式，不碰 DOM。
 */
export function crestFailsafeMs(search: string): number | null {
  const value = new URLSearchParams(search).get('qi-crest-failsafe');
  if (value === 'off') return null;
  if (value === null || !/^\d{1,9}$/.test(value)) return CREST_FAILSAFE_MS;
  const ms = Number(value);
  return ms <= FAILSAFE_MAX_MS ? ms : CREST_FAILSAFE_MS;
}

export interface CrestBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 掃光位置的上下限（百分比）：指標離館徽太遠就不再往外跑。 */
export const SHEEN_MIN = -30;
export const SHEEN_MAX = 130;

const clamp = (value: number): number => Math.max(SHEEN_MIN, Math.min(SHEEN_MAX, value));

/** 指標（視窗座標）在館徽盒子內的位置，百分比、夾在 [SHEEN_MIN, SHEEN_MAX]；盒子沒有大小（display:none）回 null。 */
export function sheenPoint(box: CrestBox, clientX: number, clientY: number): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  return {
    x: clamp(((clientX - box.left) / box.width) * 100),
    y: clamp(((clientY - box.top) / box.height) * 100),
  };
}

/**
 * 館徽的圖在標記裡是 loading=lazy（不顯示的尺寸就不下載）；顯示的尺寸不等瀏覽器的延後載入機制——光點引擎吃重時它的觀察者要等到
 * 有空檔的那一格才發請求，館徽會比引擎 ready 還晚到——首頁腳本一開始就把它們改成立刻載（lazy 改 eager 會馬上發請求）。
 * 沒有占位（display:none）的維持 lazy：視窗之後變大、館徽出現時才由瀏覽器載。
 */
export function loadCrestNow(): void {
  for (const crest of document.querySelectorAll<HTMLElement>('[data-crest]')) {
    if (crest.getClientRects().length === 0) continue;
    for (const img of crest.querySelectorAll('img')) img.loading = 'eager';
  }
}

export function initCrestSheen(reducedMotion: boolean): void {
  if (reducedMotion) return;
  const crests = Array.from(document.querySelectorAll<HTMLElement>('[data-crest]'));
  if (crests.length === 0) return;

  // 每個館徽各自的最新位置；同一格的 rAF 一起寫（沒有位置的館徽——沒占位、捲出視窗——不寫）
  const points = new Map<HTMLElement, { x: number; y: number }>();
  let raf = 0;

  const apply = (): void => {
    raf = 0;
    for (const [crest, point] of points) {
      crest.style.setProperty('--sheen-x', `${point.x.toFixed(1)}%`);
      crest.style.setProperty('--sheen-y', `${point.y.toFixed(1)}%`);
      crest.dataset.pointer = '';
    }
    points.clear();
  };

  window.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType === 'touch') return;
      for (const crest of crests) {
        const rect = crest.getBoundingClientRect();
        // 館徽已捲出視窗（或這個尺寸下不顯示）就不用算了。
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
        const point = sheenPoint(rect, event.clientX, event.clientY);
        if (point) points.set(crest, point);
      }
      if (points.size > 0 && !raf) raf = requestAnimationFrame(apply);
    },
    { passive: true },
  );
}
