// 首屏「一震開門」（第三版）：全黑只有一條古金地平線與落腳前的人 → 一記震腳落下：
// 定格兩三幀、整個視窗下沉再回彈（帶一點縮放）、地面以腳下為圓心向八方裂開（貼著地面的透視，主裂線衝到畫面邊緣，
// 裂縫裡先是亮金的光再暗成刻線）、貼地的塵牆與揚起的碎石 → 各景深層由遠到近亮起、人換成定格的架勢，站名與獅印出現。
// 時間軸與一次性狀態在 src/lib/impact/opening.ts；這裡接 DOM。全用 2D 畫布與 CSS，不載 three。
//
//   <html data-opening="pending">  BaseLayout 的行內腳本在首次繪製前標上（要演）；否則是 "done"
//   <html data-opening="playing">  蓄：只有地平線與落腳前的人
//   <html data-opening="struck">   已經落下：首屏的進場動畫開始播
//   <html data-opening="done">     終態（演完、被跳過、這個工作階段演過了、或減少動態）
//   <html data-opening-played>     "true" 這次有完整演；"false" 直接顯示終態；"skipped" 演到一半被跳過
// 可跳過：按任何鍵、點一下、捲動，或按「跳過」鈕。

import { OPENING, markOpeningSeen, openingFrame, openingMode } from '../lib/impact/opening';
import { burstChips, spawnDebris, spawnDustRing, spawnDustWall } from '../lib/impact/particles';
import { SINK_MS, sampleOffsets, sinkOffset, sinkScale } from '../lib/impact/shake';
import { chromeElements, createImpactLayer, playOffsets, type Ground } from './impact-layer';

/** 終態時裂紋留下來的濃度（地面上的刻線）。 */
const SETTLED = 0.34;

/**
 * 刻字的節奏（和 Hero.astro 的 hero-carve 一致）：第 i 個字在擊中後 CARVE_START + i × CARVE_STEP 開始刻，刻 CARVE_MS。
 * 回傳刻完的時刻（擊中後多少 ms）。
 */
const CARVE_START = 120;
const CARVE_STEP = 160;
const CARVE_MS = 500;
const carveDone = (index: number) => CARVE_START + index * CARVE_STEP + CARVE_MS;
/** 蓋印：擊中後多久開始落、落多久。 */
const STAMP_AT = 1060;
const STAMP_MS = 460;

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function initOpening(): void {
  const root = document.documentElement;
  const hero = document.querySelector<HTMLElement>('.hero');
  const canvas = hero?.querySelector<HTMLCanvasElement>('canvas[data-impact]');
  const visual = hero?.querySelector<HTMLElement>('[data-hero-visual]');
  if (!hero || !canvas || !visual) {
    root.dataset.opening = 'done';
    return;
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const layer = createImpactLayer(canvas);
  const mobile = window.innerWidth < 960;

  /**
   * 落點：場景裡有人形就是他的腳下（在地平線下方一點的地面上，裂紋貼著地面裂開）；
   * 沒有人形（素材缺件）就是獅子的正中央，裂紋是正面的放射。
   */
  // 有「落地」那一格的素材時，擊中時換上它：裂紋的中心就是它落下的那隻腳。
  const land = hero.querySelector<HTMLElement>('[data-figure="land"]');
  const marker = land?.querySelector<HTMLElement>('[data-impact-origin]') ?? hero.querySelector<HTMLElement>('[data-impact-origin]');
  const horizon = hero.querySelector<HTMLElement>('.scene__floor');
  const origin = (): { x: number; y: number; radius: number; ground?: Ground } => {
    const frame = canvas.getBoundingClientRect();
    if (!marker) {
      const rect = visual.getBoundingClientRect();
      return { x: rect.left + rect.width / 2 - frame.left, y: rect.top + rect.height / 2 - frame.top, radius: rect.width * 0.86 };
    }
    const rect = marker.getBoundingClientRect();
    const y = rect.top - frame.top;
    const horizonY = horizon ? horizon.getBoundingClientRect().top - frame.top : y - frame.height * 0.04;
    const rise = Math.max(14, y - horizonY);
    // 半徑夠大：橫向的主裂線就到得了畫面兩側，往觀者的幾條衝出下緣。
    return { x: rect.left - frame.left, y, radius: frame.width * 0.78, ground: { rise, depth: rise * 5 } };
  };
  const aim = () => {
    const { x, y, radius, ground } = origin();
    layer?.setImpact(x, y, radius, 7, ground);
  };

  let state: 'idle' | 'playing' | 'struck' | 'done' = 'idle';
  let raf = 0;
  const timers: number[] = [];

  const settle = (played: 'true' | 'false' | 'skipped') => {
    if (state === 'done') return;
    state = 'done';
    if (raf) cancelAnimationFrame(raf);
    for (const timer of timers) window.clearTimeout(timer);
    root.dataset.opening = 'done';
    root.dataset.openingPlayed = played;
    aim();
    if (played === 'true') layer?.fadeCracks(SETTLED, 700);
    else layer?.setCracks(1, SETTLED);
    // 減少動態：塵粒不飄。
    if (!reducedMotion) layer?.setDrift(mobile ? 14 : 30);
    unbind();
  };

  const strike = () => {
    if (state !== 'playing') return;
    state = 'struck';
    root.dataset.opening = 'struck';
    // 落腳那一拍：抬腳的人換成落地的那一格（有素材時）。
    if (land) {
      land.classList.add('is-landed');
      hero.querySelector('[data-figure="stomp"]')?.classList.add('is-spent');
    }
    aim();
    // 擊：裂紋先炸開一段，裂縫裡是亮金的光；然後定格兩三幀。
    layer?.setCracks(OPENING.firstCrack, 1, true);
    // 整個視窗下沉再回彈，配合一點點縮放：首屏、頁首、外框一起動（地平線在首屏裡，跟著抖）。
    const depth = mobile ? 6 : 9;
    // 縮放放在首屏「裡面」的各層（首屏本身裁掉外溢），不然放大的那一下會把頁面撐寬。
    playOffsets(hero.children, sampleOffsets((t) => sinkOffset(t, depth), SINK_MS, 'y', sinkScale), SINK_MS);
    playOffsets(chromeElements(), sampleOffsets((t) => sinkOffset(t, depth), SINK_MS, 'y'), SINK_MS);
  };

  let released = false;
  const release = () => {
    if (released || state !== 'struck') return;
    released = true;
    const { x, y, ground } = origin();
    // 落腳的人換成定格的人。
    hero.querySelector('[data-figure="stomp"]')?.classList.add('is-spent');
    land?.classList.add('is-spent');
    hero.querySelector('[data-figure="hero"]')?.classList.add('is-set');
    // 塵牆：貼著地面往兩側滾出去的顆粒（近大遠小、帶運動模糊），一快一慢兩道；落點揚起碎石與土粒。
    if (ground) {
      layer?.emit(spawnDustWall({ count: mobile ? 180 : 380, seed: 3, speed: mobile ? 1.3 : 2.2, life: 2000 }), x, y, 'dust');
      layer?.emit(spawnDustWall({ count: mobile ? 100 : 200, seed: 9, speed: mobile ? 0.7 : 1.1, life: 2300 }), x, y, 'dust');
    } else {
      layer?.emit(spawnDustRing({ count: mobile ? 110 : 230, seed: 3, speed: mobile ? 0.9 : 1.5, life: 1200 }), x, y, 'dust');
    }
    layer?.emit(spawnDebris({ count: mobile ? 40 : 80, seed: 5, speed: mobile ? 0.6 : 0.85 }), x, y, 'debris');
    // 刻字：每個大字刻完的那一刻，從字腳落下一撮金屑與漆片（剔紅）。時間和 Hero.astro 的 hero-carve 一致。
    const frame = canvas.getBoundingClientRect();
    hero.querySelectorAll<HTMLElement>('.hero__char').forEach((char, index) => {
      timers.push(
        window.setTimeout(() => {
          const rect = char.getBoundingClientRect();
          layer?.emit(
            burstChips({ count: mobile ? 10 : 18, seed: 70 + index, direction: Math.PI / 2, speed: 0.22, spread: 1.6, life: 900 }),
            rect.left + rect.width * 0.7 - frame.left,
            rect.bottom - rect.height * 0.15 - frame.top,
            'chips',
          );
        }, carveDone(index) - OPENING.freezeMs),
      );
    });
    // 最後一拍：獅印像火漆印蓋下來——由大縮小落下、擊中時小震一下、外圈揚塵。
    timers.push(window.setTimeout(stamp, STAMP_AT - OPENING.freezeMs));
  };

  const stamp = () => {
    if (state !== 'struck') return;
    visual.classList.add('is-stamped');
    if (typeof visual.animate !== 'function') return;
    // 火漆印：從兩倍半大猛地落下（加速），擊中那一下壓扁、回彈一下才定住。不淡入。
    visual.animate(
      [
        { transform: 'translate3d(0, -12%, 0) scale(2.6, 2.6)', easing: 'cubic-bezier(0.7, 0, 1, 0.6)' },
        { transform: 'translate3d(0, 0, 0) scale(1, 1)', offset: 0.55, easing: 'ease-out' },
        { transform: 'translate3d(0, 2%, 0) scale(1.08, 0.9)', offset: 0.68, easing: 'ease-out' },
        { transform: 'translate3d(0, 0, 0) scale(0.97, 1.03)', offset: 0.84, easing: 'ease-in-out' },
        { transform: 'translate3d(0, 0, 0) scale(1, 1)' },
      ],
      { duration: STAMP_MS },
    );
    timers.push(
      window.setTimeout(() => {
        // 擊中：首屏的字與印小震一下，印的外圈揚起一圈塵。
        const stage = hero.querySelector<HTMLElement>('.hero__stage');
        playOffsets([stage], sampleOffsets((t) => sinkOffset(t, mobile ? 2 : 3), SINK_MS, 'y'), SINK_MS);
        const rect = visual.getBoundingClientRect();
        const frame = canvas.getBoundingClientRect();
        const ring = spawnDustRing({ count: mobile ? 50 : 110, seed: 13, speed: mobile ? 0.35 : 0.5, squash: 0.45, life: 900 });
        // 從印的外圈開始揚起（不是從圓心）。
        const radius = rect.width * 0.46;
        for (const grain of ring) {
          const angle = Math.atan2(grain.vy, grain.vx);
          grain.x += Math.cos(angle) * radius;
          grain.y += Math.sin(angle) * radius * 0.45;
        }
        layer?.emit(ring, rect.left + rect.width / 2 - frame.left, rect.top + rect.height * 0.62 - frame.top, 'dust');
      }, STAMP_MS * 0.55),
    );
  };

  const skip = () => settle(state === 'idle' ? 'false' : 'skipped');
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Tab' || event.key === 'Shift' || event.metaKey || event.ctrlKey || event.altKey) return;
    skip();
  };
  const passive = { passive: true } as const;
  const button = hero.querySelector<HTMLButtonElement>('[data-opening-skip]');
  function unbind() {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointerdown', skip);
    window.removeEventListener('wheel', skip);
    window.removeEventListener('touchstart', skip);
    window.removeEventListener('scroll', skip);
    button?.removeEventListener('click', skip);
  }

  window.addEventListener('resize', () => {
    if (state !== 'done') return;
    aim();
    layer?.redraw();
  });

  const mode = openingMode({ storage: sessionStore(), reducedMotion });
  if (mode === 'final' || root.dataset.opening !== 'pending' || window.scrollY > 4) {
    settle('false');
    return;
  }

  // ── 演 ──
  state = 'playing';
  root.dataset.opening = 'playing';
  markOpeningSeen(sessionStore());
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', skip, passive);
  window.addEventListener('wheel', skip, passive);
  window.addEventListener('touchstart', skip, passive);
  window.addEventListener('scroll', skip, passive);
  button?.addEventListener('click', skip);

  const start = performance.now();
  const tick = () => {
    raf = 0;
    if (state === 'done') return;
    const frame = openingFrame(performance.now() - start);
    if (frame.struck) strike();
    if (frame.phase === 'release' || frame.phase === 'done') {
      release();
      if (state === 'struck') layer?.setCracks(frame.cracks, 1, true);
    }
    if (frame.phase === 'done') {
      settle('true');
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  // 分頁在背景時 requestAnimationFrame 不跑：用計時器保底，一定會走到終態。
  timers.push(window.setTimeout(strike, OPENING.strikeAt));
  timers.push(window.setTimeout(release, OPENING.strikeAt + OPENING.freezeMs));
  timers.push(window.setTimeout(() => settle('true'), OPENING.totalMs + 60));
}
