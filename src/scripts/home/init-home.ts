// 首頁的光點引擎接線（Task 19、20）：把捲動位置、大人／小孩切換、開場、視窗變動接到 `QiStage`。
//
//   - 每個 rAF 讀 `scrollY`（另有 passive scroll 監聽喚醒）→ `scrollState` → 姿勢（`poseFor(beat, audience)`）與散開量
//     `max(捲動 scatter, 切換 scatter)`；捲動速度（視窗高／秒）平滑後餵引擎。
//   - 引擎對外的狀態以 `html[data-qi-*]` 與 `window.__qi`（只有 ready／frames／tier／mode；`?qi-debug=1` 才多一個 debug）暴露。
//   - 依 fps 自動降級（Task 17）由引擎自己做（調速器接在 qi-stage 的 rAF 裡），降級時在 window 發 `qi:tier`；這裡聽它，
//     把 `html[data-qi-tier]` 與 `window.__qi.tier` 跟著改。降級不碰姿勢：引擎保留目前姿勢，`data-qi-pose` 也不動。
//   - 退回靜態圖（Task 20，`fallback.ts`）：減少動態、沒有 WebGL2（`<head>` 的探測已加 `html.qi-static`）時根本不載入引擎；
//     引擎掛不上、第一個姿勢載不到、WebGL context 中途遺失時，停掉迴圈、釋放舞台再退回。退回後這個檔案的處理器一律不再動作。
//   - 離開頁面（`pagehide`、非 bfcache）釋放引擎與 GL context；bfcache 返回（`pageshow` persisted）重設時間戳後繼續。
//   - 開場的燙金館徽（Task 24）：金屬掃光跟指標走（`crest-sheen.ts`，與引擎無關）；露出的時機用 `html[data-qi-crest]` 表示——
//     `in`（落地的衝擊波，`playIntro` 的 `onLand`）才有擦出動畫；`shown`（再訪、略過、Esc、捲走、逾時保險）直接顯示終態；退回靜態圖由 CSS 直接露出。
//   - 入館閘門（Task 25，`gate.ts`）：首次進站先蓋一層全屏閘門（<head> 的行內腳本標 html[data-gate]）。引擎在閘門後面照常載入，姿勢停在氣流（`flow`，光點飄在閘門上）；
//     按下「入館」、閘門淡出收起之後才開始開場（`playIntro({ fromAmbient: true })`：從氣流直接吸氣聚成拳師）。閘門還擋著時，姿勢、略過、逾時保險都不動作；
//     引擎掛不上或退回靜態圖就立刻收掉閘門（`onEnterStatic`）。再訪、減少動態、沒有 WebGL、帶 #錨點、從站內其他頁來都沒有閘門（head 的判斷）。
//   - 共用的那一半（殼、退回與收尾、降級事件、掛載、取景、換姿勢、每格迴圈、resize、離開頁面）在 `qi/host.ts`（Task 26 起各頁的光點層共用）；這裡只剩首頁專有的：
//     捲動模型、大人／小孩切換、開場、館徽、入館閘門、教練卡的氣息。
//   - 這個檔案會被打進首頁的腳本：程式字串與錯誤訊息只用英文（字型守門會掃 JS 裡的中文字）；也不得 import `config/copy.ts`。

import { CENTER_BAND_MARGIN } from '../card-carousel';
import { BEATS, poseFor, type BeatId } from '../../qi/config/poses';
import { switchScatter } from '../../qi/engine/forces';
import { INTRO_MAX_SCROLL, shouldPlayIntro } from '../../qi/engine/intro';
import { scrollState, type BeatRect } from '../../qi/engine/scroll-model';
import { isPortrait } from '../../qi/engine/viewport';
import { prefetchPlan } from '../../qi/shapes/loader';
import type { QiStage } from '../../qi/engine/qi-stage';
import { currentAudience, observeAudience } from './audience-sync';
import { readBeatRects } from './beats';
import { crestFailsafeMs, initCrestSheen, loadCrestNow } from './crest-sheen';
import { textInkRight, textInkTop } from './text-extent';
import { createQiHost } from '../qi/host';
import { initGate } from './gate';
import { introSeen, markIntroSeen } from './intro-gate';

/** 捲動速度的平滑時間常數（秒）。 */
const SPEED_TAU = 0.15;
/** 一格最多算多少秒（分頁切走再回來時不要讓速度暴衝）。 */
const MAX_TICK_DT = 0.1;

type IntroUi = 'playing' | 'done' | 'skipped';

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null; // blocked storage (privacy mode)
  }
}

export async function initHome(): Promise<void> {
  const main = document.querySelector<HTMLElement>('main[data-home]');
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]');
  if (!main || !canvas) return;

  const session = sessionStorageOrNull();
  // 入館閘門：一開始就接手（鎖捲動、背景 inert、焦點在按鈕）；沒有閘門就回一個「已收起」的 Gate。
  const gate = initGate(session);

  const host = createQiHost(canvas);
  const { root, reducedMotion, loader, setAttr } = host;
  // 開場館徽的金屬掃光（Task 24）：跟指標走，與引擎無關（沒有 WebGL 的靜態圖模式照樣有）；減少動態時什麼都不掛。
  initCrestSheen(reducedMotion);
  loadCrestNow(); // 館徽的圖是 lazy（不顯示的尺寸不下載）；顯示的尺寸一開始就載，不等引擎吃重時才有空檔的延後載入

  // ── 退回與收尾 ───────────────────────────────────────────────
  let crestTimer: ReturnType<typeof setTimeout> | undefined; // 館徽的逾時保險（見下方 revealCrest）；收尾時要清掉
  host.onShutdown(() => clearTimeout(crestTimer)); // 退回靜態圖（館徽由 CSS 直接露出）後不再讓遲來的計時器去標 data-qi-crest
  host.onStatic(() => gate.removeNow()); // 引擎掛不上、退回靜態圖：閘門立刻收掉（不淡出），不擋內容

  // 減少動態，或 <head> 的探測已判定沒有 WebGL2（html.qi-static）：不載入引擎、不預取形體，靜態圖就是畫面。
  if (host.stayStatic()) return;

  const willPlayIntro = shouldPlayIntro({
    reducedMotion,
    seen: introSeen(session),
    scrollY: window.scrollY,
    viewportH: window.innerHeight,
  });

  host.watchTier();
  setAttr('qiScatter', '0.00');
  if (!willPlayIntro) setAttr('qiIntro', 'skipped');
  // 開場館徽（Task 24）：有 JS 且引擎沒退回時，館徽預設是擦掉的（home.css），要等這個屬性才露出——
  //   'in'    ＝ 落地的衝擊波（`onLand`）：由下往上擦出、閃一下（只有這一條路徑有動畫）；
  //   'shown' ＝ 直接顯示終態、沒有動畫：不演開場（再訪；首繪前的行內腳本就標了，帶 #hash 進站在這裡標）、開場提早收尾（略過、Esc、捲走）、
  //             演完但沒落地過，以及引擎或形體載入卡住時的逾時保險。
  // 先到先得：已經標過就不改——落地擦出到一半不能被改成 'shown' 打斷，逾時之後遲來的落地也不能讓已露出的館徽再擦一次。
  // 退回靜態圖時 CSS 直接讓它一直在，不需要這個屬性。
  // 逾時保險（引擎或形體卡住時館徽不能永遠不見）：預設 7 秒，網址參數 ?qi-crest-failsafe=<ms|off> 可注入（測試用，見 crest-sheen.ts）；
  // 「開場一開始」（引擎說計時真的起算，`onStart`）就解除——開場自己會在落地、結束或被略過時露出館徽，慢的引擎不能讓保險搶在落地之前把館徽放出來；
  // 收尾（shutdown）時也會清掉。
  const failsafeMs = crestFailsafeMs(location.search);
  const disarmCrestFailsafe = (): void => {
    clearTimeout(crestTimer);
    crestTimer = undefined;
  };
  const revealCrest = (mode: 'in' | 'shown'): void => {
    disarmCrestFailsafe();
    if (root.dataset.qiCrest !== undefined) return;
    setAttr('qiCrest', mode);
  };
  const armCrestFailsafe = (): void => {
    if (!host.alive() || failsafeMs === null || root.dataset.qiCrest !== undefined) return;
    crestTimer = setTimeout(() => revealCrest('shown'), failsafeMs);
  };
  // 閘門還擋著時開場還沒開始（使用者可能一直不按）：保險從閘門收起才起算，不然閘門後面的館徽會被保險先放出來、之後的擦出就沒了
  if (!willPlayIntro) revealCrest('shown');
  else if (gate.isHolding()) void gate.closed.then(armCrestFailsafe);
  else armCrestFailsafe();

  /** 閘門還擋著、開場在等它：這段時間不換姿勢、不略過（開場一開始這個旗標就放下）。 */
  let gateWaiting = willPlayIntro && gate.isHolding();
  /** 引擎停在氣流（閘門的背景）：開場要從氣流直接吸氣，不接續 land 的聚合態。 */
  let ambient = false;
  /** 引擎的開場計時真的起算了（`onStart`）。沒起算＝還在等 land、lift 載入（pending）。 */
  let introEngineStarted = false;

  // ── 形體載入與預取（引擎一載入完成就用得到）──────────────────────
  let mounted: QiStage | undefined; // 掛上之後才有（refreshBeats 在掛上之前也會被叫到）
  let beats: BeatRect[] = readBeatRects(main, window.scrollY);
  const refreshBeats = (): void => {
    beats = readBeatRects(main, window.scrollY);
    // 版面或文字變了（視窗、字型載入、切換對象、圖片讓版面位移）：兵器的左界（實際文字的右緣）跟著重新量
    mounted?.relayout();
  };

  /** 視窗中央現在對到哪一個 beat；沒有任何有高度的 beat（或 beats 是空的）時回 undefined。 */
  const locate = (): { beat: BeatRect | undefined; scatter: number } => {
    const state = scrollState(beats, window.scrollY, window.innerHeight);
    const beat = beats[state.index];
    return beat && beat.height > 0 ? { beat, scatter: state.scatter } : { beat: undefined, scatter: 0 };
  };

  let intro: IntroUi | 'none' = willPlayIntro ? 'playing' : 'none';
  const prefetchAround = (beat: BeatId): void => {
    loader.prefetch(prefetchPlan(BEATS.indexOf(beat), currentAudience(), intro === 'playing'));
  };
  const first = locate().beat?.id ?? 'opening';
  prefetchAround(first);

  // ── 引擎 ─────────────────────────────────────────────────────
  const ok = await host.mount({
      // 取景的直／橫與版面（home.css 的 @media (max-aspect-ratio: 4/5)）同一條：依視窗，不是扣掉外框的畫布
      portrait: () => isPortrait(window.innerWidth, window.innerHeight),
      // 兵器的左界：該姿勢那一段實際文字的最右緣（從畫布左緣起算）。哪一段看目前對象的姿勢對應（劍＝兵器 a、妙刀＝b、大槍＝c）。
      textRight: (pose) => {
        const beat = BEATS.find((id) => poseFor(id, currentAudience()) === pose);
        const section = beat ? main.querySelector(`[data-beat="${beat}"]`) : null;
        const right = section ? textInkRight(section) : undefined;
        return right === undefined ? undefined : right - canvas.getBoundingClientRect().left;
      },
      // 直向的合成形體（others）要擺在文字之上：該姿勢那一段實際文字的上緣（從畫布上緣起算）。
      // 文字的位置會隨捲動變，而姿勢是那一段捲到視窗中央時才成形，所以量「這一段在視窗正中央時」文字上緣在哪裡：
      // 段內的位移（文字上緣 − 段的上緣）加上「段置中時的段上緣」。
      textTop: (pose) => {
        const beat = BEATS.find((id) => poseFor(id, currentAudience()) === pose);
        const section = beat ? main.querySelector<HTMLElement>(`[data-beat="${beat}"]`) : null;
        const top = section ? textInkTop(section) : undefined;
        if (!section || top === undefined) return undefined;
        const box = section.getBoundingClientRect();
        return (window.innerHeight - box.height) / 2 + (top - box.top) - canvas.getBoundingClientRect().top;
      },
  });
  if (!ok) return; // 掛不上：host 已退回靜態圖
  const stage = host.stage; // 掛上之後不會變（收尾後 dispose，各處理器都先看 host.alive()）
  mounted = stage;

  // ── 姿勢 ─────────────────────────────────────────────────────
  // 取景（`host.refit`）：載入第一個姿勢期間視窗可能變了（那時 resize 監聽器還沒掛），`firstPose` 載入完成後立刻 refit 一次（RF1 邊角）。
  const requestPose = host.requestPose;

  // 閘門擋著且要演開場：先停在氣流（光點在閘門上飄），按下「入館」才吸氣聚成拳師；其餘照目前這一段的姿勢。
  // 引擎還沒好、閘門就已經收起（使用者很快按了「入館」）：首屏海報（聚合的拳師）已經露出來了，照原本的路徑接續它（land → 散開 → 吸氣）。
  ambient = gateWaiting && gate.isHolding();
  if (!(await host.firstPose(ambient ? 'flow' : poseFor(first, currentAudience())))) return;
  setAttr('qiBeat', first);

  // ── 開場 ─────────────────────────────────────────────────────
  const skipButton = document.querySelector<HTMLButtonElement>('[data-skip-intro]');
  const setIntro = (next: IntroUi): void => {
    intro = next;
    setAttr('qiIntro', next);
    if (skipButton) skipButton.hidden = next !== 'playing';
    if (next !== 'playing') {
      revealCrest('shown'); // 演完、略過、捲走：館徽（還沒露出的話）直接顯示終態，不跑擦出動畫
      prefetchAround(locate().beat?.id ?? first);
    }
  };
  /** 開場提前收尾（略過、捲走、跳段落）：不播任何特效，引擎停在 land；之後的姿勢由捲動位置決定。 */
  const endIntro = (reason: 'done' | 'skipped'): void => {
    if (!host.alive() || intro !== 'playing' || gateWaiting) return; // 閘門還擋著：開場還沒開始，沒有東西可略過
    setIntro(reason);
    stage.playIntro({ skip: true });
    if (!introEngineStarted) {
      // 開場還在等形體（pending）就被略過、Esc 或捲走：引擎還停在氣流（閘門的背景）。引擎端的 skip 只收尾、不會自己換姿勢（`setPose('land')` 在
      // 開場 pending 時被擋下，`requested` 又已經是 land，不會重試），所以這裡重新要求目前這一段的姿勢；形體一到就聚成人形。
      // 不給衝量：略過本來就是「不播任何特效」。
      requestPose(poseFor(locate().beat?.id ?? first, currentAudience()), false);
    }
  };

  // ── 光點館徽（Task 21 的朱印，Task 25 改成館徽）──────────────────────
  // 預約段的館徽是畫在光點裡的；`.crest-hit` 是蓋在館徽上的透明連結，只有引擎量得到館徽（光點聚合之後，`getCrestRect()` 非 null）、
  // 而且整個館徽的矩形在垂直方向落在預約段（`.beat--booking`）之內才定位並顯示；之前、以及離開預約段之後都不可點
  // （home.css：`display: none`，不是一塊空白的隱形按鈕）。位置寫成 CSS 變數、取整數像素，值沒變不寫。
  // 為什麼要自己判斷「在預約段內」：頁尾在 main 外面，捲過最後一個 beat 後 scatter 恆為 0、姿勢仍是 crest，引擎照樣量得到館徽；
  // 但畫布是 fixed 的，`.crest-hit` 若留著就會蓋在頁尾的 QR 與「用 LINE 加入」上，把一般連結變成開 #line-dialog。
  // 退回靜態圖後 home.css 改用另一組規則（對齊靜態圖），這些變數就沒人讀了。
  const crestHit = document.querySelector<HTMLElement>('.crest-hit');
  const bookingBeat = document.querySelector<HTMLElement>('.beat--booking');
  let crestKey = '';
  const placeCrest = (): void => {
    if (!crestHit) return;
    let rect = stage.getCrestRect();
    if (rect && bookingBeat) {
      const section = bookingBeat.getBoundingClientRect();
      if (rect.y < section.top || rect.y + rect.h > section.bottom) rect = null; // 館徽不是整個在預約段內（含頁尾）
    } else {
      rect = null; // 沒有預約段就沒有地方可放
    }
    const key = rect ? [rect.x, rect.y, rect.w, rect.h].map(Math.round).join(',') : '';
    if (key === crestKey) return;
    crestKey = key;
    if (!rect) {
      delete crestHit.dataset.placed;
      return;
    }
    const [x, y, w, h] = key.split(',');
    crestHit.style.setProperty('--hit-x', `${x}px`);
    crestHit.style.setProperty('--hit-y', `${y}px`);
    crestHit.style.setProperty('--hit-w', `${w}px`);
    crestHit.style.setProperty('--hit-h', `${h}px`);
    crestHit.dataset.placed = '';
  };
  host.onShutdown(() => {
    if (crestHit) delete crestHit.dataset.placed;
  });

  // ── 每一格 ───────────────────────────────────────────────────
  let switchAt: number | null = null; // 對象切換的時間（performance.now）；null ＝ 還沒切換過
  let currentBeat: BeatId = first;
  let lastTick = performance.now();
  let lastY = window.scrollY;
  let speed = 0;
  const tick = (): void => {
    const now = performance.now();
    const y = window.scrollY;
    const vh = window.innerHeight;
    const dt = Math.min(Math.max((now - lastTick) / 1000, 0), MAX_TICK_DT);
    lastTick = now;
    if (dt > 0 && vh > 0) {
      const raw = Math.abs(y - lastY) / vh / dt;
      speed += (raw - speed) * (1 - Math.exp(-dt / SPEED_TAU));
    }
    lastY = y;
    if (speed < 1e-3) speed = 0;

    // RF2：開場還在演就捲走（含段落跳轉）→ 立刻收尾，姿勢直接去目標
    if (intro === 'playing' && !gateWaiting && y > INTRO_MAX_SCROLL * vh) endIntro('done');

    const { beat, scatter: scrolled } = locate();
    if (beat) {
      if (beat.id !== currentBeat) {
        currentBeat = beat.id;
        setAttr('qiBeat', beat.id);
        prefetchAround(beat.id);
      }
      const wanted = poseFor(beat.id, currentAudience());
      if (!gateWaiting && wanted !== host.requested) requestPose(wanted, true); // 閘門擋著時姿勢留在氣流
    }
    const scatter = Math.max(scrolled, switchAt === null ? 0 : switchScatter(now - switchAt));
    stage.setScatter(scatter);
    stage.setScrollSpeed(speed);
    setAttr('qiScatter', scatter.toFixed(2));
    placeCrest();
  };

  // 每個 rAF 都跑（引擎自己也是），另有 passive scroll 監聽喚醒（見 qi/host.ts 的 loop）。
  const schedule = host.loop(tick);

  // ── 對象切換 ─────────────────────────────────────────────────
  host.onShutdown(
    observeAudience((audience) => {
      if (!host.alive()) return;
      switchAt = performance.now(); // 切換的散開從 0 ms 起算
      refreshBeats();
      const beat = locate().beat?.id ?? first;
      requestPose(poseFor(beat, audience), true);
      prefetchAround(beat);
      schedule();
    }),
  );

  // ── 視窗 ─────────────────────────────────────────────────────
  host.watchResize(refreshBeats);
  const layoutObserver = new ResizeObserver(refreshBeats); // 圖片、字型等讓版面位移
  layoutObserver.observe(main);
  host.onShutdown(() => layoutObserver.disconnect());
  void document.fonts?.ready.then(() => {
    if (host.alive()) refreshBeats();
  });

  // ── 離開頁面、bfcache ────────────────────────────────────────
  host.watchLifecycle(() => {
    // 從 bfcache 回來：時間戳與捲動位置都過期了，重設後再排一格
    lastTick = performance.now();
    lastY = window.scrollY;
    speed = 0;
    refreshBeats();
  });

  // ── 略過 ─────────────────────────────────────────────────────
  skipButton?.addEventListener('click', () => endIntro('skipped'));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') endIntro('skipped');
  });

  // ── 教練卡片進入視窗中央：一下氣息 ────────────────────────────
  const coachCards = document.querySelectorAll('.coach-entry');
  if (coachCards.length > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!host.alive()) return;
        for (const entry of entries) if (entry.isIntersecting) stage.pulse();
      },
      { rootMargin: CENTER_BAND_MARGIN },
    );
    for (const card of coachCards) observer.observe(card);
    host.onShutdown(() => observer.disconnect());
  }

  // ── 就緒、開場 ───────────────────────────────────────────────
  host.markReady();
  const startIntro = (): void => {
    if (!host.alive()) return; // 等閘門的期間退回靜態圖了
    gateWaiting = false;
    markIntroSeen(session);
    setIntro('playing');
    introEngineStarted = false;
    stage.playIntro({
      fromAmbient: ambient,
      onStart: () => {
        introEngineStarted = true;
        disarmCrestFailsafe();
      },
      onLand: () => {
        if (host.alive()) revealCrest('in'); // 落地的衝擊波：館徽由下往上擦出
      },
      onEnd: (result) => {
        if (intro === 'playing') setIntro('done');
        // 開場用的形體載不到而取消（引擎還停在閘門後面的氣流；被擋下的 `setPose('land')` 不會自己重試）：重新要求目前這一段的姿勢，
        // 形體一到就聚成人形。不給衝量（開場本來就沒演）。
        if (result.failed) requestPose(poseFor(locate().beat?.id ?? first, currentAudience()), false);
      },
    });
    schedule();
  };
  if (willPlayIntro) {
    if (gate.isHolding()) void gate.closed.then(startIntro); // 閘門收起（進入或被移除）才開始；被移除時 alive 已是 false
    else startIntro();
  }
  schedule();
}
