// 課程卡片輪播的計時邏輯（純邏輯，不碰 DOM，可單元測試）。
// DOM 接線在 src/scripts/card-carousel.ts。

export const CAROUSEL_INTERVAL_MS = 3000;

/** hover：滑鼠移上去才播；viewport：進入視窗中央才播（觸控裝置）；none：不自動播。 */
export type CarouselMode = 'hover' | 'viewport' | 'none';

export function carouselMode(input: {
  slideCount: number;
  canHover: boolean;
  reducedMotion: boolean;
}): CarouselMode {
  if (input.slideCount <= 1 || input.reducedMotion) return 'none';
  return input.canHover ? 'hover' : 'viewport';
}

export interface Carousel {
  /** 開始輪播；已在播、或只有 0／1 張時不做事。 */
  start(): void;
  /** 停止並回到第一張。 */
  stop(): void;
  isRunning(): boolean;
  index(): number;
}

export function createCarousel(options: {
  slideCount: number;
  intervalMs?: number;
  /** 目前張數改變時呼叫（含 stop 時跳回 0）。 */
  onChange: (index: number) => void;
}): Carousel {
  const { slideCount, intervalMs = CAROUSEL_INTERVAL_MS, onChange } = options;
  let current = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  function show(next: number) {
    if (next === current) return;
    current = next;
    onChange(current);
  }

  return {
    start() {
      if (slideCount <= 1 || timer !== undefined) return;
      timer = setInterval(() => show((current + 1) % slideCount), intervalMs);
    },
    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      show(0);
    },
    isRunning: () => timer !== undefined,
    index: () => current,
  };
}
