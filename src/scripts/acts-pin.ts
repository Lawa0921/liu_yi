// 三幕的釘選捲動（GSAP ScrollTrigger）。只由 src/scripts/acts.ts 在桌機、且沒有要求減少動態時動態載入。
// 只動 transform 與 opacity；不使用平滑捲動函式庫。
//
// 每一幕兩段：
//   1. 進場（還沒釘住，幕從下方捲進來的那段）：巨大單字與紋樣先出現，免得捲進來的是一片空白。
//   2. 釘選（幕頂對齊外框上緣後釘住，再捲 130% 的視窗高度）：直書分類名、金線、一對牌依序出現，
//      紋樣持續緩慢移動；最後留一段不動，讓人看清楚再放開。
//      釘選的進度同時寫在幕上的 data-pin-progress，給兵器台的 3D 兵器用。

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ACTS_PIN_QUERY } from './acts';

gsap.registerPlugin(ScrollTrigger);

const PIN_DISTANCE = '+=130%';

/** 外框上緣的高度（px）：幕釘在它下面。 */
function frameTop(): number {
  return document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
}

function animateAct(act: HTMLElement): void {
  const q = gsap.utils.selector(act);
  const glyph = q('.act__glyph > span');
  const emblem = q('.act__emblem');
  const weapons = q('.act__weapon');
  const title = q('.act__title');
  const titleLine = q('.act__title-line');
  const tablets = q('.act__course');
  const photos = q('.tablet__photo img');

  // 1. 進場
  const enter = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: { trigger: act, start: 'top 92%', end: () => `top ${frameTop()}px`, scrub: 0.5 },
  });
  enter.fromTo(glyph, { opacity: 0, scale: 1.35, yPercent: 8 }, { opacity: 1, scale: 1, yPercent: 0 }, 0);
  if (emblem.length) enter.fromTo(emblem, { opacity: 0, scale: 0.7, rotation: -45 }, { opacity: 0.45, scale: 1, rotation: 0 }, 0);
  weapons.forEach((weapon, index) => {
    enter.fromTo(weapon, { opacity: 0, xPercent: index % 2 === 0 ? -45 : 45 }, { opacity: 0.8, xPercent: 0 }, 0);
  });

  // 2. 釘選
  const pinned = gsap.timeline({
    defaults: { ease: 'power2.out' },
    scrollTrigger: {
      trigger: act,
      start: () => `top ${frameTop()}px`,
      end: PIN_DISTANCE,
      pin: true,
      scrub: 0.6,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      // 兵器台（src/scripts/three/viewer.ts）依這個進度擺兵器的姿勢：出鞘、轉身、亮刃。
      onUpdate: (self) => {
        act.dataset.pinProgress = self.progress.toFixed(4);
      },
    },
  });
  pinned
    .from(title, { opacity: 0, yPercent: -18, duration: 0.9 }, 0)
    .from(titleLine, { scaleY: 0, duration: 1.1, ease: 'power1.inOut' }, 0.15)
    .from(tablets, { opacity: 0, y: 70, duration: 1, stagger: 0.35 }, 0.55)
    .from(photos, { scale: 1.25, duration: 1.3 }, 0.9);
  if (emblem.length) pinned.to(emblem, { rotation: 45, duration: 3.2, ease: 'none' }, 0);
  weapons.forEach((weapon, index) => {
    pinned.to(weapon, { xPercent: index % 2 === 0 ? 5 : -5, duration: 3.2, ease: 'none' }, 0);
  });
  pinned.to(glyph, { yPercent: -3, duration: 3.2, ease: 'none' }, 0);
  // 最後一段留白：內容都到位後再捲一點才放開。
  pinned.to({}, { duration: 0.5 });
}

export function pinActs(acts: HTMLElement[], hooks: { onPinned: () => void; onReverted: () => void }): void {
  const mm = gsap.matchMedia();
  mm.add(ACTS_PIN_QUERY, () => {
    acts.forEach(animateAct);

    // 首屏主視覺的輕微視差。
    const visual = document.querySelector('[data-hero-visual]');
    if (visual) {
      gsap.to(visual, {
        yPercent: 12,
        ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
      });
    }

    hooks.onPinned();
    return () => {
      for (const act of acts) delete act.dataset.pinProgress;
      hooks.onReverted();
    };
  });

  // 字型與圖片載入後版面高度會變，重新量一次。
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
}
