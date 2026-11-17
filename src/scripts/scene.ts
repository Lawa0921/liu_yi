// 子頁剪影場景的視差接線（Task 27）：把捲動與滑鼠位置轉成各層的 transform（計算在 lib/scene/parallax.ts，單元測試守住）。
//
//   - 捲動：passive 的 scroll 監聽，rAF 合併成一格一次；場景捲出視窗（IntersectionObserver）就停手。
//   - 滑鼠微傾：只在有精細指標（`(pointer: fine)`）時掛 pointermove（passive）；觸控與手機沒有，也不要陀螺儀權限。
//   - 減少動態：什麼都不掛（場景就是靜態的一幕）；`html[data-scene-motion]` 標 `off`。
//   - 課程總覽：滑過或聚焦課程卡（`[data-scene-subject]`）把人物換成該課的剪影（`is-active` 交叉淡化），離開回到預設。
//   - 沒有 JS 時場景是靜態的一幕；這個檔案只在有 `[data-scene]` 的頁面做事。
// 這個檔案會被打進頁面的腳本：程式字串與錯誤訊息只用英文（字型守門會掃 JS 裡的中文字）。

import { layerTransform, LAYER_KINDS, type LayerKind, type Pointer } from '../lib/scene/parallax';

interface SceneLayers {
  root: HTMLElement;
  layers: { kind: LayerKind; el: HTMLElement }[];
}

function readLayers(root: HTMLElement): SceneLayers {
  const layers: SceneLayers['layers'] = [];
  for (const el of root.querySelectorAll<HTMLElement>('[data-scene-layer]')) {
    const kind = el.dataset.sceneLayer as LayerKind;
    if (LAYER_KINDS.includes(kind)) layers.push({ kind, el });
  }
  return { root, layers };
}

/** 課程總覽：滑過或聚焦課程卡，人物換成該課的剪影；離開回到預設的那一張。 */
function wireSwap(scene: HTMLElement): void {
  const subjects = [...scene.querySelectorAll<HTMLImageElement>('.scene__layer--subject .scene__img')];
  const initial = scene.dataset.sceneSubject ?? '';
  const show = (asset: string): void => {
    const target = subjects.some((img) => img.dataset.asset === asset) ? asset : initial;
    for (const img of subjects) img.classList.toggle('is-active', img.dataset.asset === target);
    scene.dataset.sceneActive = target;
  };
  scene.dataset.sceneActive = initial;
  for (const card of document.querySelectorAll<HTMLElement>('[data-scene-card]')) {
    const asset = card.dataset.sceneCard ?? '';
    card.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') show(asset);
    });
    card.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') show(initial);
    });
    card.addEventListener('focusin', () => show(asset));
    card.addEventListener('focusout', (event) => {
      if (!card.contains((event as FocusEvent).relatedTarget as Node | null)) show(initial);
    });
  }
}

export function initScenes(): void {
  const scenes = [...document.querySelectorAll<HTMLElement>('[data-scene]')].map(readLayers);
  if (scenes.length === 0) return;
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  for (const scene of scenes) if (scene.root.hasAttribute('data-scene-swap')) wireSwap(scene.root);

  if (reduced) {
    root.dataset.sceneMotion = 'off';
    return;
  }
  root.dataset.sceneMotion = 'on';

  let pointer: Pointer | null = null;
  const visible = new Set<HTMLElement>();
  let frame = 0;

  const apply = (): void => {
    frame = 0;
    const scrollY = window.scrollY;
    for (const scene of scenes) {
      if (!visible.has(scene.root)) continue;
      const sceneHeight = scene.root.offsetHeight;
      for (const { kind, el } of scene.layers) {
        el.style.transform = layerTransform(kind, { scrollY, sceneHeight, pointer, reduced: false });
      }
    }
  };
  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(apply);
  };

  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target as HTMLElement);
      else visible.delete(entry.target as HTMLElement);
    }
    schedule();
  });
  for (const scene of scenes) seen.observe(scene.root);

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  if (matchMedia('(pointer: fine)').matches) {
    window.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerType === 'touch') return;
        pointer = { x: (event.clientX / window.innerWidth) * 2 - 1, y: (event.clientY / window.innerHeight) * 2 - 1 };
        schedule();
      },
      { passive: true },
    );
  }
  schedule();
}
