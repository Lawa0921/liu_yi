// 首頁三幕的動態入口（見 src/components/Acts.astro）。
//
// 桌機（≥ 60rem）且沒有要求「減少動態」→ 載入 GSAP ScrollTrigger，把每一幕釘在外框裡隨捲動推進；
// 其餘（手機、減少動態）→ 不載入 GSAP、不釘選，一般捲動。手機另以 IntersectionObserver 加上 .is-in，
// 進場樣式寫在 Acts.astro（且只在沒有要求減少動態時生效）。
//
// 跑完後在 <html data-acts="pinned|static"> 標上目前的模式（樣式與測試都依它）。

export const ACTS_PIN_QUERY = '(min-width: 60rem) and (prefers-reduced-motion: no-preference)';

function revealOnScroll(acts: HTMLElement[]): void {
  if (!('IntersectionObserver' in window)) {
    for (const act of acts) act.classList.add('is-in');
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -18% 0px' },
  );
  for (const act of acts) observer.observe(act);
}

export function initActs(): void {
  const acts = Array.from(document.querySelectorAll<HTMLElement>('[data-act]'));
  if (acts.length === 0) return;

  const root = document.documentElement;
  const setStatic = () => {
    root.dataset.acts = 'static';
    revealOnScroll(acts);
  };

  if (!window.matchMedia(ACTS_PIN_QUERY).matches) {
    setStatic();
    return;
  }

  // GSAP 只在真的要釘選時才下載。
  import('./acts-pin')
    .then(({ pinActs }) =>
      pinActs(acts, {
        onPinned: () => {
          root.dataset.acts = 'pinned';
        },
        // 視窗縮到手機寬度（或系統切到減少動態）時 GSAP 會自動還原，這裡把模式改回來。
        onReverted: setStatic,
      }),
    )
    .catch(setStatic);
}
