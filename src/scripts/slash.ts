// 斬（設計文件 §15.2-2）：在首頁快速拖過畫面（滑鼠按住拖、手指滑）留下一道金色刀光；
// 幕與幕之間的轉場是一道斜向刀光劈過畫面。軌跡的取樣與衰減在 src/lib/arsenal/slash.ts。
//
// 刀光畫在一張蓋滿視窗的畫布上（[data-slash]，pointer-events: none）：只是視覺，
// 不擋點擊、不攔截捲動——事件都用被動監聽，手機上直向滑動仍是捲頁。
// 「減少動態」時整個不啟用。
//
//   data-slash-points  目前還看得到的軌跡點數（0 就是沒有刀光）
//   data-slash-cuts    幕間斜劈累計播了幾次

import {
  addSample,
  createTrail,
  diagonalCut,
  pruneTrail,
  trailRibbon,
  type Trail,
  type TrailPoint,
} from '../lib/arsenal/slash';

const MAX_PIXEL_RATIO = 1.5;
/** 刀光最寬處（CSS px）。 */
const DRAG_WIDTH = 15;
const CUT_WIDTH = 26;
const CUT_MS = 190;

export function initSlash(): void {
  const layer = document.querySelector<HTMLCanvasElement>('canvas[data-slash]');
  if (!layer) return;
  layer.dataset.slashPoints = '0';
  layer.dataset.slashCuts = '0';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const ctx = layer.getContext('2d');
  if (!ctx) return;

  const style = getComputedStyle(document.documentElement);
  const glow = style.getPropertyValue('--color-highlight').trim();
  const body = style.getPropertyValue('--color-accent-strong').trim();
  const core = style.getPropertyValue('--color-text').trim();

  let trail: Trail = createTrail();
  /** 幕間斜劈：時間還沒到的點先排著，到了才進軌跡（刀光才會由一端劃到另一端）。 */
  let queued: TrailPoint[] = [];
  let widest = DRAG_WIDTH;
  let cuts = 0;
  let raf = 0;
  let slashing = false;
  let ratio = 1;
  let sized = false;

  // 畫布用到才配置：沒人揮刀就不佔一整個視窗的記憶體。
  const size = () => {
    ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    layer.width = Math.round(window.innerWidth * ratio);
    layer.height = Math.round(window.innerHeight * ratio);
    sized = true;
  };

  const report = () => {
    layer.dataset.slashPoints = String(trail.points.length + queued.length);
  };

  const draw = (now: number) => {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalCompositeOperation = 'lighter';
    for (const ribbon of trailRibbon(trail, now, widest)) {
      const { left, right, strength } = ribbon;
      // 刀光本體：金色的帶，外面一圈光暈。
      ctx.beginPath();
      ctx.moveTo(left[0]!.x, left[0]!.y);
      for (const point of left) ctx.lineTo(point.x, point.y);
      for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i]!.x, right[i]!.y);
      ctx.closePath();
      ctx.globalAlpha = 0.85 * strength;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 22;
      ctx.fillStyle = body;
      ctx.fill();
      // 中心一道細亮線：刃。
      ctx.beginPath();
      left.forEach((point, index) => {
        const x = (point.x + right[index]!.x) / 2;
        const y = (point.y + right[index]!.y) / 2;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.globalAlpha = strength;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = core;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  };

  const frame = () => {
    raf = 0;
    const now = performance.now();
    if (queued.length > 0) {
      const due = queued.filter((point) => point.t <= now);
      if (due.length > 0) {
        queued = queued.filter((point) => point.t > now);
        trail = { points: [...trail.points, ...due], last: trail.last };
      }
    }
    trail = pruneTrail(trail, now);
    draw(now);
    report();
    if (trail.points.length > 0 || queued.length > 0) raf = requestAnimationFrame(frame);
    else widest = DRAG_WIDTH;
  };

  const wake = () => {
    if (!sized) size();
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const root = document.documentElement;
  /** 揮刀中：滑鼠快速拖曳會順便反白一大片文字，很難看——揮刀的這一下暫時不讓選取（放開就恢復）。 */
  const guardSelection = (on: boolean) => {
    if (on === root.classList.contains('is-slashing')) return;
    root.classList.toggle('is-slashing', on);
    if (on) window.getSelection()?.removeAllRanges();
  };

  const sample = (x: number, y: number) => {
    const before = trail.points.length;
    trail = addSample(trail, { x, y, t: performance.now() });
    if (trail.points.length !== before) {
      if (slashing) guardSelection(true);
      report();
      wake();
    }
  };

  /** 一刀結束：下一次取樣是新的一刀，不和這一刀連起來算速度。 */
  const lift = () => {
    trail = { points: trail.points, last: null };
  };

  /** 在 3D 兵器上拖是轉兵器，不是揮刀。 */
  const onWeapon = (target: EventTarget | null) => target instanceof Element && target.closest('[data-weapon3d]') !== null;

  // 滑鼠：按住左鍵拖。
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || onWeapon(event.target)) return;
      slashing = true;
      lift();
      sample(event.clientX, event.clientY);
    },
    { passive: true },
  );
  window.addEventListener(
    'pointermove',
    (event) => {
      if (!slashing || event.pointerType !== 'mouse') return;
      if ((event.buttons & 1) === 0) {
        sheathe();
        return;
      }
      sample(event.clientX, event.clientY);
    },
    { passive: true },
  );
  const sheathe = () => {
    slashing = false;
    guardSelection(false);
    lift();
  };
  window.addEventListener('pointerup', sheathe, { passive: true });
  window.addEventListener('pointercancel', sheathe, { passive: true });
  window.addEventListener('blur', sheathe);

  // 手指：touchmove 在瀏覽器接手捲動之後仍會持續送來（被動監聽，不會擋捲動）。
  window.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1 || onWeapon(event.target)) return;
      lift();
      sample(touch.clientX, touch.clientY);
    },
    { passive: true },
  );
  window.addEventListener(
    'touchmove',
    (event) => {
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1 || onWeapon(event.target)) return;
      sample(touch.clientX, touch.clientY);
    },
    { passive: true },
  );
  window.addEventListener('touchend', lift, { passive: true });
  window.addEventListener('touchcancel', lift, { passive: true });

  window.addEventListener(
    'resize',
    () => {
      if (sized) size();
    },
    { passive: true },
  );

  // ── 幕間的斜劈：每一幕的上緣越過視窗中線時劈一刀，方向一左一右 ──
  const acts = Array.from(document.querySelectorAll<HTMLElement>('[data-act]'));
  if (acts.length === 0 || !('IntersectionObserver' in window)) return;

  const cut = (direction: 1 | -1) => {
    widest = CUT_WIDTH;
    queued = [
      ...queued,
      ...diagonalCut({
        width: window.innerWidth,
        height: window.innerHeight,
        direction,
        t: performance.now(),
        durationMs: CUT_MS,
      }),
    ];
    cuts += 1;
    layer.dataset.slashCuts = String(cuts);
    report();
    wake();
  };

  let primed = false;
  const observer = new IntersectionObserver(
    (entries) => {
      // 第一批回報是載入時的現況，不是「捲進來」。
      if (!primed) {
        primed = true;
        return;
      }
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        cut(acts.indexOf(entry.target as HTMLElement) % 2 === 0 ? 1 : -1);
      }
    },
    // 視窗中線偏下一點的一條線：幕的上緣越過它就算進場。
    { rootMargin: '-58% 0px -42% 0px' },
  );
  for (const act of acts) observer.observe(act);
}
