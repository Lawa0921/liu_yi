// 首頁的光點引擎接線（Task 19）：把捲動位置、大人／小孩切換、開場、視窗變動接到 `QiStage`。
//
//   - 每個 rAF 讀 `scrollY`（另有 passive scroll 監聽喚醒）→ `scrollState` → 姿勢（`poseFor(beat, audience)`）與散開量
//     `max(捲動 scatter, 切換 scatter)`；捲動速度（視窗高／秒）平滑後餵引擎。
//   - 引擎對外的狀態以 `html[data-qi-*]` 與 `window.__qi`（只有 ready／frames／tier／mode；`?qi-debug=1` 才多一個 debug）暴露。
//   - 這個檔案會被打進首頁的腳本：程式字串與錯誤訊息只用英文（字型守門會掃 JS 裡的中文字）；也不得 import `config/copy.ts`。
//   - 減少動態、沒有 WebGL 的正式退回流程是 Task 20 的事；這裡只做最小的保底（引擎掛不上就露出靜態圖）。

import { CENTER_BAND_MARGIN } from '../card-carousel';
import { BEATS, poseFor, type BeatId, type PoseId } from '../../qi/config/poses';
import { switchScatter } from '../../qi/engine/forces';
import { shouldPlayIntro } from '../../qi/engine/intro';
import { scrollState, type BeatRect } from '../../qi/engine/scroll-model';
import { initialTier, type TierId } from '../../qi/engine/tiers';
import { viewportChanged } from '../../qi/engine/viewport';
import { fetchBytes } from '../../qi/shapes/fetch';
import { createShapeLoader, prefetchPlan } from '../../qi/shapes/loader';
import { resolveShapeUrl } from '../../qi/shapes/urls';
import type { QiDebug, QiStage } from '../../qi/engine/qi-stage';
import { currentAudience, observeAudience } from './audience-sync';
import { readBeatRects } from './beats';
import { introSeen, markIntroSeen } from './intro-gate';

/** 開場播放中，捲過視窗高的這個比例就立刻收尾（與 `shouldPlayIntro` 的「還停在頁首」同一把尺）。 */
const INTRO_MAX_SCROLL = 0.25;
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
  const session = sessionStorageOrNull();
  const willPlayIntro = shouldPlayIntro({
    reducedMotion,
    seen: introSeen(session),
    scrollY: window.scrollY,
    viewportH: window.innerHeight,
  });

  // window.__qi 與 html 屬性：先有殼，引擎掛上後才 ready。
  const qi: QiGlobal = { ready: false, frames: 0, tier, mode: 'webgl' };
  (window as unknown as { __qi?: QiGlobal }).__qi = qi;
  const written = new Map<string, string>();
  /** 只在值變了才寫 DOM（每格都會呼叫）。 */
  const setAttr = (name: string, value: string): void => {
    if (written.get(name) === value) return;
    written.set(name, value);
    root.dataset[name] = value;
  };
  setAttr('qiTier', tier);
  setAttr('qiScatter', '0.00');
  if (!willPlayIntro) setAttr('qiIntro', 'skipped');

  // 靜態圖退回（最小保底；Task 20 會換成正式的 fallback.ts）。
  const enterStatic = (): void => {
    root.classList.add('qi-static');
    qi.mode = 'static';
    qi.ready = false;
    setAttr('qiMode', 'static');
    const skip = document.querySelector<HTMLElement>('[data-skip-intro]');
    if (skip) skip.hidden = true;
  };

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
    stage = await mountQiStage({ canvas, tier, loader, reducedMotion, debug: params.get('qi-debug') === '1' });
  } catch (error) {
    console.warn('The qi engine could not start; showing still images.', error);
    enterStatic();
    return;
  }
  if (stage.debug) qi.debug = stage.debug;

  // ── 姿勢 ─────────────────────────────────────────────────────
  let requested: PoseId | null = null;
  /** 換姿勢。載入失敗就留在原姿勢；`data-qi-pose` 只在「最後一次要求」載入完成後才更新。 */
  const requestPose = (pose: PoseId, burst: boolean): void => {
    requested = pose;
    stage.setPose(pose, { burst }).then(
      () => {
        if (requested === pose) setAttr('qiPose', pose);
      },
      () => undefined,
    );
  };

  try {
    const initial = poseFor(first, currentAudience());
    requested = initial;
    await stage.setPose(initial, { burst: false });
    setAttr('qiPose', initial);
  } catch (error) {
    console.warn('The first pose could not be loaded; showing still images.', error);
    stage.dispose();
    enterStatic();
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
    if (intro !== 'playing') return;
    setIntro(reason);
    stage.playIntro({ skip: true });
  };

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
  };

  // 有動態時每個 rAF 都跑（引擎自己也是）；減少動態沒有 rAF 迴圈，只在事件發生時跑一格。
  let raf = 0;
  const schedule = (): void => {
    if (raf !== 0) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      tick();
      if (!reducedMotion) schedule();
    });
  };
  window.addEventListener('scroll', schedule, { passive: true });

  // ── 對象切換 ─────────────────────────────────────────────────
  observeAudience((audience) => {
    switchAt = performance.now(); // 切換的散開從 0 ms 起算
    refreshBeats();
    const beat = locate().beat?.id ?? first;
    requestPose(poseFor(beat, audience), true);
    prefetchAround(beat);
    schedule();
  });

  // ── 視窗 ─────────────────────────────────────────────────────
  // prev 是「上次取景時的尺寸」，不是上一個 resize 事件的（RF1）：網址列伸縮的小抖動不取景，累計超過門檻才取景。
  let fitted = { w: window.innerWidth, h: window.innerHeight };
  window.addEventListener('resize', () => {
    refreshBeats();
    const next = { w: window.innerWidth, h: window.innerHeight };
    if (viewportChanged(fitted, next)) {
      stage.resize(canvas.clientWidth, canvas.clientHeight);
      fitted = next;
    }
    schedule();
  });
  new ResizeObserver(refreshBeats).observe(main); // 圖片、字型等讓版面位移
  void document.fonts?.ready.then(refreshBeats);

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
        for (const entry of entries) if (entry.isIntersecting) stage.pulse();
      },
      { rootMargin: CENTER_BAND_MARGIN },
    );
    for (const card of coachCards) observer.observe(card);
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
