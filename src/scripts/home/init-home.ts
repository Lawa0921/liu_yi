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
//   - 這個檔案會被打進首頁的腳本：程式字串與錯誤訊息只用英文（字型守門會掃 JS 裡的中文字）；也不得 import `config/copy.ts`。

import { CENTER_BAND_MARGIN } from '../card-carousel';
import { BEATS, poseFor, type BeatId, type PoseId } from '../../qi/config/poses';
import { switchScatter } from '../../qi/engine/forces';
import { INTRO_MAX_SCROLL, shouldPlayIntro } from '../../qi/engine/intro';
import { scrollState, type BeatRect } from '../../qi/engine/scroll-model';
import { initialTier, TIER_ORDER, type TierId } from '../../qi/engine/tiers';
import { viewportChanged } from '../../qi/engine/viewport';
import { fetchBytes } from '../../qi/shapes/fetch';
import { createShapeLoader, prefetchPlan } from '../../qi/shapes/loader';
import { resolveShapeUrl } from '../../qi/shapes/urls';
import type { QiDebug, QiStage } from '../../qi/engine/qi-stage';
import { currentAudience, observeAudience } from './audience-sync';
import { readBeatRects } from './beats';
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

  // window.__qi 與 html 屬性：先有殼，引擎掛上後才 ready。
  const qi: QiGlobal = { ready: false, frames: 0, tier, mode: 'webgl' };
  (window as unknown as { __qi?: QiGlobal }).__qi = qi;

  // ── 退回與收尾 ───────────────────────────────────────────────
  /** 這個頁面的引擎還活著嗎：退回靜態圖或離開頁面之後，所有處理器都不該再碰引擎。 */
  let alive = true;
  let engine: QiStage | undefined;
  let raf = 0;
  const teardowns: (() => void)[] = []; // 觀察者之類，收尾時一起停
  const shutdown = (): void => {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(raf); // 停掉每格迴圈
    raf = 0;
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

  // ── 形體載入與預取（引擎一載入完成就用得到）──────────────────────
  const loader = createShapeLoader({ fetch: fetchBytes, resolveUrl: resolveShapeUrl });
  let beats: BeatRect[] = readBeatRects(main, window.scrollY);
  const refreshBeats = (): void => {
    beats = readBeatRects(main, window.scrollY);
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
      onContextLost: () => enterStatic('context-lost'), // RF5：靜態圖接手，DOM 內容不變
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
    if (next !== 'playing') prefetchAround(locate().beat?.id ?? first);
  };
  /** 開場提前收尾（略過、捲走、跳段落）：不播任何特效，引擎停在 land；之後的姿勢由捲動位置決定。 */
  const endIntro = (reason: 'done' | 'skipped'): void => {
    if (!alive || intro !== 'playing') return;
    setIntro(reason);
    stage.playIntro({ skip: true });
  };

  // ── 朱印（Task 21）─────────────────────────────────────────────
  // 預約段的印是畫在光點裡的；`.seal-hit` 是蓋在印上的透明連結，只有引擎量得到印（光點聚合之後，`getSealRect()` 非 null）、
  // 而且整個印的矩形在垂直方向落在預約段（`.beat--booking`）之內才定位並顯示；之前、以及離開預約段之後都不可點
  // （home.css：`display: none`，不是一塊空白的隱形按鈕）。位置寫成 CSS 變數、取整數像素，值沒變不寫。
  // 為什麼要自己判斷「在預約段內」：頁尾在 main 外面，捲過最後一個 beat 後 scatter 恆為 0、姿勢仍是 seal，引擎照樣量得到印；
  // 但畫布是 fixed 的，`.seal-hit` 若留著就會蓋在頁尾的 QR 與「用 LINE 加入」上，把一般連結變成開 #line-dialog。
  // 退回靜態圖後 home.css 改用另一組規則（對齊靜態圖），這些變數就沒人讀了。
  const sealHit = document.querySelector<HTMLElement>('.seal-hit');
  const bookingBeat = document.querySelector<HTMLElement>('.beat--booking');
  let sealKey = '';
  const placeSeal = (): void => {
    if (!sealHit) return;
    let rect = stage.getSealRect();
    if (rect && bookingBeat) {
      const section = bookingBeat.getBoundingClientRect();
      if (rect.y < section.top || rect.y + rect.h > section.bottom) rect = null; // 印不是整個在預約段內（含頁尾）
    } else {
      rect = null; // 沒有預約段就沒有地方可放
    }
    const key = rect ? [rect.x, rect.y, rect.w, rect.h].map(Math.round).join(',') : '';
    if (key === sealKey) return;
    sealKey = key;
    if (!rect) {
      delete sealHit.dataset.placed;
      return;
    }
    const [x, y, w, h] = key.split(',');
    sealHit.style.setProperty('--seal-x', `${x}px`);
    sealHit.style.setProperty('--seal-y', `${y}px`);
    sealHit.style.setProperty('--seal-w', `${w}px`);
    sealHit.style.setProperty('--seal-h', `${h}px`);
    sealHit.dataset.placed = '';
  };
  teardowns.push(() => {
    if (sealHit) delete sealHit.dataset.placed;
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
    placeSeal();
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
      onEnd: () => {
        if (intro === 'playing') setIntro('done');
      },
    });
  }
  schedule();
}
