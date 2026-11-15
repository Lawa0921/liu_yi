// 首屏獅子上的金屬掃光（設計文件 §15.2-5）：一道亮帶跟著指標（滑鼠或手指）移動。
// 這裡只把指標位置寫進 .hero__sheen 的 --sheen-x／--sheen-y（百分比），樣子在 Hero.astro 的樣式裡。
// 是對使用者動作的回應、不是自動播放的動畫，所以「減少動態」時也照常。

export function initHeroSheen(): void {
  const visual = document.querySelector<HTMLElement>('[data-hero-visual]');
  const sheen = visual?.querySelector<HTMLElement>('.hero__sheen');
  if (!visual || !sheen) return;

  let x = 50;
  let y = 50;
  let raf = 0;

  const apply = () => {
    raf = 0;
    sheen.style.setProperty('--sheen-x', `${x.toFixed(1)}%`);
    sheen.style.setProperty('--sheen-y', `${y.toFixed(1)}%`);
    sheen.dataset.active = 'true';
  };

  const follow = (event: PointerEvent) => {
    const rect = visual.getBoundingClientRect();
    // 首屏已經捲出視窗就不用算了。
    if (rect.bottom < 0 || rect.width === 0) return;
    x = Math.max(-30, Math.min(130, ((event.clientX - rect.left) / rect.width) * 100));
    y = Math.max(-30, Math.min(130, ((event.clientY - rect.top) / rect.height) * 100));
    if (!raf) raf = requestAnimationFrame(apply);
  };

  window.addEventListener('pointermove', follow, { passive: true });
  window.addEventListener('pointerdown', follow, { passive: true });
}
