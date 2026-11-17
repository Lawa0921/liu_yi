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
//   - 這個檔案會被打進首頁的腳本：程式字串與錯誤訊息只用英文（字型守門會掃 JS 裡的中文字）；也不得 import `config/copy.ts`。

import { CENTER_BAND_MARGIN } from '../card-carousel';
import { BEATS, poseFor, type BeatId, type PoseId } from '../../qi/config/poses';
import { switchScatter } from '../../qi/engine/forces';
import { INTRO_MAX_SCROLL, shouldPlayIntro } from '../../qi/engine/intro';
import { scrollState, type BeatRect } from '../../qi/engine/scroll-model';
import { initialTier, TIER_ORDER, type TierId } from '../../qi/engine/tiers';
import { isPortrait, viewportChanged } from '../../qi/engine/viewport';
import { fetchBytes } from '../../qi/shapes/fetch';
import { createShapeLoader, prefetchPlan } from '../../qi/shapes/loader';
import { resolveShapeUrl } from '../../qi/shapes/urls';
import type { QiDebug, QiStage } from '../../qi/engine/qi-stage';
import { currentAudience, observeAudience } from './audience-sync';
import { readBeatRects } from './beats';
import { crestFailsafeMs, initCrestSheen, loadCrestNow } from './crest-sheen';
import { textInkRight, textInkTop } from './text-extent';
import { enterStatic, onEnterStatic } from './fallback';
import { introSeen, markIntroSeen } from './intro-gate';

/** 捲動速度的平滑時間常數（秒）。 */
const SPEED_TAU = 0.15;
/** 一格最多算多少秒（分頁切走再回來時不要讓速度暴衝）。 */
const MAX_TICK_DT = 0.1;

type IntroUi = 'playing' | 'done' | 'skipped';
type Mode = 'webgl' | 'static';

interface QiGlobal {
  ready: boolean;
  frames: number;
  tier: TierId;
  mode: Mode;
  debug?: QiDebug;
}

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null; // blocked storage (privacy mode)
  }
}

export async function initHome(): Promise<void> {
  const root = document.documentElement;
  const main = document.querySelector<HTMLElement>('main[data-home]');
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]');
  if (!main || !canvas) return;

  const params = new URLSearchParams(location.search);
  const tier = initialTier({
    touch: matchMedia('(pointer: coarse)').matches,
    width: window.innerWidth,
    override: params.get('qi-tier'),
  });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 開場館徽的金屬掃光（Task 24）：跟指標走，與引擎無關（沒有 WebGL 的靜態圖模式照樣有）；減少動態時什麼都不掛。
  initCrestSheen(reducedMotion);
  loadCrestNow(); // 館徽的圖是 lazy（不顯示的尺寸不下載）；顯示的尺寸一開始就載，不等引擎吃重時才有空檔的延後載入

  // window.__qi 與 html 屬性：先有殼，引擎掛上後才 ready。
  const qi: QiGlobal = { ready: false, frames: 0, tier, mode: 'webgl' };
  (window as unknown as { __qi?: QiGlobal }).__qi = qi;

  // ── 退回與收尾 ───────────────────────────────────────────────
  /** 這個頁面的引擎還活著嗎：退回靜態圖或離開頁面之後，所有處理器都不該再碰引擎。 */
  let alive = true;
  let engine: QiStage | undefined;
  let raf = 0;
  let crestTimer: ReturnType<typeof setTimeout> | undefined; // 館徽的逾時保險（見下方 revealCrest）；收尾時要清掉
  const teardowns: (() => void)[] = []; // 觀察者之類，收尾時一起停
  const shutdown = (): void => {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(raf); // 停掉每格迴圈
    raf = 0;
    clearTimeout(crestTimer); // 退回靜態圖（館徽由 CSS 直接露出）後不再讓遲來的計時器去標 data-qi-crest
    for (const stop of teardowns) stop();
    teardowns.length = 0;
    engine?.dispose(); // 也釋放 GL context
  };
  onEnterStatic(() => {
    qi.mode = 'static';
    qi.ready = false;
    shutdown();
  });

  // 減少動態，或 <head> 的探測已判定沒有 WebGL2（html.qi-static）：不載入引擎、不預取形體，靜態圖就是畫面。
  if (reducedMotion || root.classList.contains('qi-static')) {
    enterStatic(reducedMotion ? 'reduced-motion' : 'no-webgl');
    return;
  }

  const session = sessionStorageOrNull();
  const willPlayIntro = shouldPlayIntro({
    reducedMotion,
    seen: introSeen(session),
    scrollY: window.scrollY,
    viewportH: window.innerHeight,
  });

  const written = new Map<string, string>();
  /** 只在值變了才寫 DOM（每格都會呼叫）。 */
  const setAttr = (name: string, value: string): void => {
    if (written.get(name) === value) return;
    written.set(name, value);
    root.dataset[name] = value;
  };
  setAttr('qiTier', tier);
  // 引擎降級（依實測 fps，或呼叫端 setTier）時發 qi:tier：屬性與 window.__qi.tier 一起更新（Task 17）
  const onTier = (event: Event): void => {
    const next: unknown = (event as CustomEvent<unknown>).detail;
    if (!alive || typeof next !== 'string' || !TIER_ORDER.includes(next as TierId)) return;
    qi.tier = next as TierId;
    setAttr('qiTier', next);
  };
  window.addEventListener('qi:tier', onTier);
  teardowns.push(() => window.removeEventListener('qi:tier', onTier));
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
  if (!willPlayIntro) revealCrest('shown');
  else if (failsafeMs !== null) crestTimer = setTimeout(() => revealCrest('shown'), failsafeMs);

  // ── 形體載入與預取（引擎一載入完成就用得到）──────────────────────
  const loader = createShapeLoader({ fetch: fetchBytes, resolveUrl: resolveShapeUrl });
  let beats: BeatRect[] = readBeatRects(main, window.scrollY);
  const refreshBeats = (): void => {
    beats = readBeatRects(main, window.scrollY);
    // 版面或文字變了（視窗、字型載入、切換對象、圖片讓版面位移）：兵器的左界（實際文字的右緣）跟著重新量
    engine?.relayout();
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
  let stage: QiStage;
  try {
    const { mountQiStage } = await import('../../qi/engine/qi-stage');
    stage = await mountQiStage({
      canvas,
      tier,
      loader,
      debug: params.get('qi-debug') === '1',
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
      onContextLost: () => enterStatic('context-lost'), // RF5：靜態圖接手，DOM 內容不變
      onFailure: (error) => {
        // 自動降級時重建丟錯：引擎已沒有 sim 可畫，停在空白畫布比靜態圖糟；退回靜態圖（shutdown 會 dispose 引擎）
        console.warn('The qi engine failed while lowering its tier; showing still images.', error);
        enterStatic('tier-failed');
      },
    });
  } catch (error) {
    console.warn('The qi engine could not start; showing still images.', error);
    enterStatic('init-failed');
    return;
  }
  engine = stage;
  if (stage.debug) qi.debug = stage.debug;

  // ── 取景 ─────────────────────────────────────────────────────
  // prev 是「上次取景時的尺寸」，不是上一個 resize 事件的（RF1）：網址列伸縮的小抖動不取景，累計超過門檻才取景。
  // 起點是引擎掛上當下的尺寸（這一行與 mountQiStage 之間沒有 await，與引擎量到的一致）。載入第一個姿勢期間視窗可能變了
  // （那時 resize 監聽器還沒掛）：載入完成後立刻 `refit()` 一次，與掛上當時的尺寸比，超過門檻就取景。
  let fitted = { w: window.innerWidth, h: window.innerHeight };
  const refit = (): void => {
    const next = { w: window.innerWidth, h: window.innerHeight };
    if (!viewportChanged(fitted, next)) return;
    stage.resize(canvas.clientWidth, canvas.clientHeight);
    fitted = next;
  };

  // ── 姿勢 ─────────────────────────────────────────────────────
  let requested: PoseId | null = null;
  const failedPoses = new Set<PoseId>();
  /**
   * 換姿勢。載入失敗就留在原姿勢（`requested` 不退回，所以停在同一段時不會每格重發請求），並 warn 一次；
   * 之後載入成功再失敗會再 warn。`data-qi-pose` 只在「最後一次要求」載入完成後才更新。
   */
  const requestPose = (pose: PoseId, burst: boolean): void => {
    if (!alive) return;
    requested = pose;
    stage.setPose(pose, { burst }).then(
      () => {
        failedPoses.delete(pose);
        if (alive && requested === pose) setAttr('qiPose', pose);
      },
      (error: unknown) => {
        if (!alive || failedPoses.has(pose)) return;
        failedPoses.add(pose);
        console.warn(`The pose "${pose}" could not be loaded; keeping the previous one.`, error);
      },
    );
  };

  try {
    const initial = poseFor(first, currentAudience());
    requested = initial;
    await stage.setPose(initial, { burst: false });
    if (!alive) return; // 載入途中退回靜態圖了（context 遺失）
    setAttr('qiPose', initial);
    refit(); // RF1 邊角：載入途中視窗變了
  } catch (error) {
    console.warn('The first pose could not be loaded; showing still images.', error);
    enterStatic('init-failed');
    return;
  }
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
    if (!alive || intro !== 'playing') return;
    setIntro(reason);
    stage.playIntro({ skip: true });
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
  teardowns.push(() => {
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
    qi.frames++;
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
    if (intro === 'playing' && y > INTRO_MAX_SCROLL * vh) endIntro('done');

    const { beat, scatter: scrolled } = locate();
    if (beat) {
      if (beat.id !== currentBeat) {
        currentBeat = beat.id;
        setAttr('qiBeat', beat.id);
        prefetchAround(beat.id);
      }
      const wanted = poseFor(beat.id, currentAudience());
      if (wanted !== requested) requestPose(wanted, true);
    }
    const scatter = Math.max(scrolled, switchAt === null ? 0 : switchScatter(now - switchAt));
    stage.setScatter(scatter);
    stage.setScrollSpeed(speed);
    setAttr('qiScatter', scatter.toFixed(2));
    placeCrest();
  };

  // 每個 rAF 都跑（引擎自己也是）。先排下一格、再算這一格（try/finally）：tick 丟錯時錯誤照常冒出，但迴圈不會永久停擺。
  const schedule = (): void => {
    if (!alive || raf !== 0) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      try {
        tick();
      } finally {
        schedule();
      }
    });
  };
  window.addEventListener('scroll', schedule, { passive: true });

  // ── 對象切換 ─────────────────────────────────────────────────
  teardowns.push(
    observeAudience((audience) => {
      if (!alive) return;
      switchAt = performance.now(); // 切換的散開從 0 ms 起算
      refreshBeats();
      const beat = locate().beat?.id ?? first;
      requestPose(poseFor(beat, audience), true);
      prefetchAround(beat);
      schedule();
    }),
  );

  // ── 視窗 ─────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    if (!alive) return;
    refit();
    refreshBeats();
    schedule();
  });
  const layoutObserver = new ResizeObserver(refreshBeats); // 圖片、字型等讓版面位移
  layoutObserver.observe(main);
  teardowns.push(() => layoutObserver.disconnect());
  void document.fonts?.ready.then(() => {
    if (alive) refreshBeats();
  });

  // ── 離開頁面、bfcache ────────────────────────────────────────
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return; // 進 bfcache：引擎原封不動，pageshow 回來繼續
    enterStatic('page-hide'); // 真的離開：釋放引擎與 GL context，並讓這個頁面（若又被顯示）是靜態圖，不是一張死掉的畫布
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted || !alive) return;
    // 從 bfcache 回來：時間戳與捲動位置都過期了，重設後再排一格（context 若被瀏覽器收走，會走 webglcontextlost 退回靜態圖）
    lastTick = performance.now();
    lastY = window.scrollY;
    speed = 0;
    refreshBeats();
    schedule();
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
        if (!alive) return;
        for (const entry of entries) if (entry.isIntersecting) stage.pulse();
      },
      { rootMargin: CENTER_BAND_MARGIN },
    );
    for (const card of coachCards) observer.observe(card);
    teardowns.push(() => observer.disconnect());
  }

  // ── 就緒、開場 ───────────────────────────────────────────────
  qi.ready = true;
  setAttr('qiMode', 'webgl');
  setAttr('qiReady', 'true');
  if (willPlayIntro) {
    markIntroSeen(session);
    setIntro('playing');
    stage.playIntro({
      onStart: disarmCrestFailsafe,
      onLand: () => {
        if (alive) revealCrest('in'); // 落地的衝擊波：館徽由下往上擦出
      },
      onEnd: () => {
        if (intro === 'playing') setIntro('done');
      },
    });
  }
  schedule();
}
