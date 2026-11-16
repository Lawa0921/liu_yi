// 課程頁照片區的切換按鈕（見 src/pages/courses/[slug].astro）。
//
// 照片區本身是橫向捲動＋scroll-snap 的清單，沒有 JS 也能用手滑或鍵盤捲動；
// 這裡只是加上「上一張／下一張」按鈕與「第幾張」的狀態，按鈕做的事就是把清單捲到那一張。
//
//   [data-gallery]          照片清單（橫向捲動的 <ul>）
//   [data-gallery-prev]     上一張按鈕
//   [data-gallery-next]     下一張按鈕
//   [data-gallery-status]   「2 / 5」

/** 目前捲到第幾張（從 0 起算）：取左緣最接近清單左緣的那一張。 */
export function nearestIndex(offsets: readonly number[], scrollLeft: number): number {
  let best = 0;
  for (let i = 1; i < offsets.length; i++) {
    if (Math.abs(offsets[i]! - scrollLeft) < Math.abs(offsets[best]! - scrollLeft)) best = i;
  }
  return best;
}

export function initGalleries(): void {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  for (const gallery of document.querySelectorAll<HTMLElement>('[data-gallery]')) {
    const root = gallery.closest<HTMLElement>('[data-gallery-root]');
    const prev = root?.querySelector<HTMLButtonElement>('[data-gallery-prev]');
    const next = root?.querySelector<HTMLButtonElement>('[data-gallery-next]');
    const status = root?.querySelector<HTMLElement>('[data-gallery-status]');
    const items = Array.from(gallery.children) as HTMLElement[];
    if (!prev || !next || items.length < 2) continue;

    const offsets = () => items.map((item) => item.offsetLeft - items[0]!.offsetLeft);
    let current = 0;

    const render = () => {
      prev.disabled = current === 0;
      next.disabled = current === items.length - 1;
      if (status) status.textContent = `${current + 1} / ${items.length}`;
      // 目前那一張：淡入位移就位（樣式在課程頁）。
      gallery.classList.add('has-current');
      items.forEach((item, index) => item.classList.toggle('is-current', index === current));
    };

    /** 按下的回饋：像朱印蓋下去（樣式在課程頁；減少動態時不動）。 */
    const stamp = (button: HTMLElement) => {
      button.dataset.stamped = 'true';
      window.setTimeout(() => delete button.dataset.stamped, 420);
    };

    // 按鈕觸發的捲動（平滑捲動要一點時間）還沒到位前，不讓捲動事件把「目前第幾張」改回半路上的值；
    // 否則連按兩下時第二下會從錯的位置算起。到位、或超過 1.5 秒（例如被使用者手動打斷）就解除。
    let pendingTarget: number | undefined;
    let pendingTimeout: ReturnType<typeof setTimeout> | undefined;

    const go = (index: number) => {
      current = Math.max(0, Math.min(items.length - 1, index));
      pendingTarget = current;
      clearTimeout(pendingTimeout);
      pendingTimeout = setTimeout(() => {
        pendingTarget = undefined;
      }, 1500);
      gallery.scrollTo({ left: offsets()[current], behavior: reducedMotion ? 'auto' : 'smooth' });
      render();
    };

    prev.addEventListener('click', () => {
      stamp(prev);
      go(current - 1);
    });
    next.addEventListener('click', () => {
      stamp(next);
      go(current + 1);
    });

    // 使用者自己滑動或用鍵盤捲動時，狀態跟著更新（捲動停下來才算）。
    let settle: ReturnType<typeof setTimeout> | undefined;
    gallery.addEventListener(
      'scroll',
      () => {
        clearTimeout(settle);
        settle = setTimeout(() => {
          const positions = offsets();
          if (pendingTarget !== undefined) {
            if (Math.abs(positions[pendingTarget]! - gallery.scrollLeft) > 2) return;
            pendingTarget = undefined;
            clearTimeout(pendingTimeout);
          }
          current = nearestIndex(positions, gallery.scrollLeft);
          render();
        }, 120);
      },
      { passive: true },
    );

    render();
  }
}
