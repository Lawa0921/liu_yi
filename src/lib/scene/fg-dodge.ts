/**
 * 首頁前景在文字經過時淡出的純函式（複審 Critical：前景在文字之上，捲動途中文字從前景底下經過會被蓋住）。
 * 前景（簷角、窗櫺）固定在視窗角落、蓋在海報與光點前面（`styles/depth.css`），所以不能留在文字上面：腳本（`scripts/home/depth.ts`）
 * 每一格量「前景不透明部分的外框」與「每個文字矩形」，有相交就把那一張前景淡出（`data-fg-hide`），文字走過去再淡入。
 * 這裡只放不碰 DOM 的部分，單元測試（tests/unit/fg-dodge.test.ts）守住；整體行為由 e2e 的連續捲動（home-depth.spec）驗。
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 每張前景「不透明部分」（原圖 alpha > 40 的像素範圍）的外框，占整張圖的比例；單元測試用真圖核對。 */
export const FG_OPAQUE_BOX: Record<string, { x0: number; x1: number; y0: number; y1: number }> = {
  // 簷角：原圖左側 38% 是空的（簷角從右上伸進來）
  'fg-eave': { x0: 582 / 1536, x1: 1, y0: 0, y1: 1 },
  'fg-lattice': { x0: 0, x1: 1, y0: 0, y1: 1 },
  'fg-steps': { x0: 0, x1: 1, y0: 8 / 302, y1: 1 },
  'fg-rack-close': { x0: 0, x1: 909 / 1536, y0: 8 / 825, y1: 1 },
};

/** 整張前景圖的矩形（已含視差位移與翻轉）→ 不透明部分的外框。`flipped`：scaleX(-1)，左右對調。沒有登記的素材保守地用整張圖。 */
export function opaqueBox(image: Box, asset: string, flipped: boolean): Box {
  const fraction = FG_OPAQUE_BOX[asset];
  if (!fraction) return { ...image };
  const width = image.right - image.left;
  const height = image.bottom - image.top;
  const x0 = flipped ? 1 - fraction.x1 : fraction.x0;
  const x1 = flipped ? 1 - fraction.x0 : fraction.x1;
  return { left: image.left + x0 * width, right: image.left + x1 * width, top: image.top + fraction.y0 * height, bottom: image.top + fraction.y1 * height };
}

/** 前景外框（往外加 `margin`）與任一文字矩形有面積相交（只是相切不算）。 */
export function overlapsAny(box: Box, texts: readonly Box[], margin: number): boolean {
  const left = box.left - margin;
  const right = box.right + margin;
  const top = box.top - margin;
  const bottom = box.bottom + margin;
  for (const text of texts) {
    if (Math.min(right, text.right) - Math.max(left, text.left) > 0 && Math.min(bottom, text.bottom) - Math.max(top, text.top) > 0) return true;
  }
  return false;
}

// ── 提前淡出（複審 Important：真實速度連續捲動時，前景「等文字進來才開始淡出」會短暫壓字）──────────────────
// 文字以每秒上千 px 掃過前景，淡出要時間（FG_FADE_OUT_S），所以要依「捲動速度 × 淡出時間」往文字來的那一側看遠一點（`leadBox`）：
// 文字還沒進到前景，前景就已經在淡出，等文字真的碰到時前景已經（接近）透明。

/** 前景淡出的時間（秒）：要與 `styles/depth.css` 的 `[data-fg-hide]` 轉場一致（單元測試只守住這個常數；e2e 以真實速度捲動驗整體）。淡入維持較慢（0.3 s）。 */
export const FG_FADE_OUT_S = 0.1;

/**
 * 提前量多留的餘裕（秒）：淡出要剛好在文字進來時走完，沒有餘裕；負載高時轉場晚一兩格才開始，完整 e2e 下桌機的窗櫺曾在文字進來時
 * 還剩一點不透明（蓋住 5–6%）。多看遠約三格。
 */
export const FG_LEAD_SLACK_S = 0.05;

/** 捲動速度的上限（px/s）：程式叫頁面一口氣跳很遠時，不讓提前量大到整個前景消失太久。 */
const MAX_SCROLL_SPEED = 6000;
/** 隔了這麼久（ms）才又有一格，視為停下來之後重新開始：速度歸零。 */
const SCROLL_IDLE_MS = 300;

export interface ScrollTrack {
  y: number;
  /** rAF 的時間戳（ms）。 */
  t: number;
  /** px/s。 */
  speed: number;
  /** +1 往下捲（內容往上跑，文字從下方進到前景）、−1 往上捲、0 不明。 */
  dir: -1 | 0 | 1;
}

/**
 * 依這一格的 scrollY 與時間更新捲動速度與方向。速度取「這一格量到的」與「上一格的 0.8 倍」兩者較大的（減速時不會一格就掉到 0，
 * 前景才不會在減速的瞬間就以為安全了）；位移為 0（視窗改變、換對象觸發的那一格）時方向沿用、速度衰減。
 */
export function trackScroll(previous: ScrollTrack | undefined, y: number, now: number): ScrollTrack {
  if (!previous || now <= previous.t || now - previous.t > SCROLL_IDLE_MS) return { y, t: now, speed: 0, dir: 0 };
  const dy = y - previous.y;
  if (dy === 0) return { y, t: now, speed: previous.speed * 0.8, dir: previous.dir };
  const instant = (Math.abs(dy) / (now - previous.t)) * 1000;
  return { y, t: now, speed: Math.min(MAX_SCROLL_SPEED, Math.max(instant, previous.speed * 0.8)), dir: dy > 0 ? 1 : -1 };
}

/** 前景外框往四邊各加 `margin`（文字離前景這麼近就先淡出，不要等它真的碰到）。 */
export function inflateBox(box: Box, margin: number): Box {
  return { left: box.left - margin, right: box.right + margin, top: box.top - margin, bottom: box.bottom + margin };
}

/**
 * 「提前量」那一段：前景外框只往文字來的那一側加大 `speed × (淡出時間 ＋ 餘裕 ＋ 一格的時間)`（往下捲＝文字從下方來，加下緣；往上捲加上緣；
 * 方向不明但有速度就兩側都加）。左右不加（文字不會從左右來）。一格的時間最多算 0.1 秒（卡頓時不要加到整個畫面）。
 * 文字還在這一段裡、還沒碰到前景，前景就先開始淡出。這一段可以伸到景深層的矩形之外（例如窗櫺下緣以下、正在從外框底下進來的文字）：
 * 那些文字雖然現在看不到，但下一兩格就會進來，所以提前量這一段用「沒有夾過」的文字矩形比。
 */
export function leadBox(box: Box, speed: number, dir: -1 | 0 | 1, frameSeconds: number): Box {
  const lead = speed * (FG_FADE_OUT_S + FG_LEAD_SLACK_S + Math.min(Math.max(frameSeconds, 0), 0.1));
  return { left: box.left, right: box.right, top: box.top - (dir <= 0 ? lead : 0), bottom: box.bottom + (dir >= 0 ? lead : 0) };
}

/** 把矩形夾進「看得見的區域」（景深層的矩形：頁首在它上面、外框下緣在它下面）；完全在外面就沒有看得見的部分，回傳 undefined。 */
export function clipBox(box: Box, area: Box): Box | undefined {
  const left = Math.max(box.left, area.left);
  const right = Math.min(box.right, area.right);
  const top = Math.max(box.top, area.top);
  const bottom = Math.min(box.bottom, area.bottom);
  return right > left && bottom > top ? { left, top, right, bottom } : undefined;
}

// ── 停下之後回來（複審 Important）＋固定文字不算提前量（複審 Important）──────────────────
// 速度只在 scroll 事件那一格更新：突然停下時最後一格的速度會一直留著，前景就一直躲著。腳本在最後一個 scroll 事件之後 FG_SETTLE_MS
// 再重算一次（`settleTrack`：速度歸零），前景就淡回來。等的時間不短於 SCROLL_IDLE_MS：滾輪刻度之間的空檔不算停下。

/** 最後一個 scroll 事件之後多久（ms）做尾端重算（速度歸零）。加上淡入 0.3 s，停下後約 0.62 s 內前景完全回來。 */
export const FG_SETTLE_MS = 320;

/**
 * 尾端重算那一格：位置與上一格一樣（真的停了）就速度與方向歸零（時間記這一格，下次再捲動時從這裡重新量速度）；
 * 位置變了（頁面卡住一陣子、計時器比畫格先跑，其實還在動）就照一般的速度追蹤，不歸零。
 */
export function settleTrack(track: ScrollTrack, y: number, now: number): ScrollTrack {
  if (y !== track.y) return trackScroll(track, y, now);
  return { y, t: now, speed: 0, dir: 0 };
}

export interface DodgeInput {
  /** 前景看得見的那一塊（不透明外框夾進景深層的矩形）。 */
  visible: Box;
  /** 景深層的矩形（頁首在它上面、外框下緣在它下面）。 */
  area: Box;
  /** 會隨頁面捲動的文字矩形（視窗座標，沒夾過）。 */
  moving: readonly Box[];
  /** 固定在畫面上的文字矩形（切換鈕、段落導覽；視窗座標，沒夾過）：不會隨捲動靠近，只算「現在」相交。 */
  fixed: readonly Box[];
  speed: number;
  dir: -1 | 0 | 1;
  frameSeconds: number;
  margin: number;
}

/**
 * 這一格前景要不要淡出（`hide`）、要不要不等轉場直接切掉（`cut`）：
 *   1. 現在：看得見的文字（會捲動的與固定的都算，夾進景深層的矩形）離前景 `margin` 以內。
 *   2. 提前量：只看會捲動的文字（沒夾過：正在從頁首或外框底下進來的也算），往它們來的那一側看遠 速度 ×（淡出＋一格）。
 *      固定的文字不會隨捲動靠近（複審：桌機 800 px/s 時簷角被藏的格數有九成是段落導覽觸發的），不算提前量。
 *   3. 已經壓上來（提前量沒趕上）：直接切掉。
 */
export function dodgeDecision(input: DodgeInput): { hide: boolean; cut: boolean } {
  const { visible, area } = input;
  const seen: Box[] = [];
  for (const text of [...input.moving, ...input.fixed]) {
    const clipped = clipBox(text, area);
    if (clipped) seen.push(clipped);
  }
  const near = clipBox(inflateBox(visible, input.margin), area);
  const hitNow = near !== undefined && overlapsAny(near, seen, 0);
  const hitAhead = input.speed > 0 && overlapsAny(leadBox(visible, input.speed, input.dir, input.frameSeconds), input.moving, 0);
  const hide = hitNow || hitAhead;
  return { hide, cut: hide && overlapsAny(visible, seen, 0) };
}
