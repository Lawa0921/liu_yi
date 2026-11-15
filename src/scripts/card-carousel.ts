// 課程卡片輪播的 DOM 接線。計時與模式判斷在 src/lib/carousel.ts。
//
// 標記約定（見 src/components/CourseCard.astro）：
//   [data-carousel]            輪播容器；啟動後會有 data-active-slide="<index>"
//   [data-slide]               每一張；目前那張有 .is-active
//   [data-carousel-host]       觸發範圍（整張卡片）；沒有就用容器本身
//
// 模式：能 hover 的裝置 → 滑鼠移入開始、移出停止並回第一張（鍵盤 focus 同理）；
//       觸控裝置 → 卡片進入視窗中央帶才播，離開停止；
//       0／1 張或「減少動態」→ 不自動播。

import { carouselMode, createCarousel } from '../lib/carousel';

/** 視窗上下各扣掉 35%，只剩中央 30% 的帶狀區域算「在畫面中央」。 */
const CENTER_BAND_MARGIN = '-35% 0px -35% 0px';

export function initCardCarousels(): void {
  const canHover = window.matchMedia('(hover: hover)').matches;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  for (const container of document.querySelectorAll<HTMLElement>('[data-carousel]')) {
    const slides = Array.from(container.querySelectorAll<HTMLElement>('[data-slide]'));
    const mode = carouselMode({ slideCount: slides.length, canHover, reducedMotion });
    container.dataset.carouselMode = mode;
    if (mode === 'none') continue;

    const carousel = createCarousel({
      slideCount: slides.length,
      onChange(index) {
        container.dataset.activeSlide = String(index);
        slides.forEach((slide, i) => slide.classList.toggle('is-active', i === index));
      },
    });
    container.dataset.activeSlide = '0';

    const host = container.closest<HTMLElement>('[data-carousel-host]') ?? container;

    if (mode === 'hover') {
      host.addEventListener('pointerenter', () => carousel.start());
      host.addEventListener('pointerleave', () => carousel.stop());
      host.addEventListener('focusin', () => carousel.start());
      host.addEventListener('focusout', () => carousel.stop());
    } else {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) carousel.start();
            else carousel.stop();
          }
        },
        { rootMargin: CENTER_BAND_MARGIN },
      );
      observer.observe(host);
    }
  }
}
