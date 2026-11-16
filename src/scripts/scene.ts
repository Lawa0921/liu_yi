// 立體空間的場景（src/components/Scene.astro）：延後載入剪影、視差、捲動推進、塵粒。
// 設定與算式在 src/lib/scene/layers.ts。不用 three（首屏不能載）：全是 CSS 3D transform 加 2D 畫布。
//
//   [data-scene] data-scene-mode   static（減少動態）| mouse | tilt（陀螺儀）| drift（緩慢自動漂移）
//   [data-scene] data-scene-ready  延後載入的層套上了
//   [data-scene] style --ox --oy   透視原點（%）：指標一動，近的層移得比遠的多
//   [data-scene] style --push      鏡頭沿 Z 軸往前推進（px）：捲動時穿過前景進入院子（只有首屏）
//   [data-scene] style --breath    首屏：開場後鏡頭一直有極慢的推近與呼吸（px）
//   [data-scene] style --sy        其他幕與區塊：捲動視差的進度（-1 剛從下緣進來、0 置中、1 要從上緣出去）
//   [data-scene] style --rim-x/-y  人形輪廓光的偏移：光源跟著指標走
//   [data-scene] data-atmos        首屏的體積光：webgl2（著色器）| css（退回 CSS 光束）
// 只在場景在畫面上時才跑 requestAnimationFrame；「減少動態」時完全不動，就是靜態的分層構圖。

import { driftPointer, heroBreath, heroPush, parallaxOrigin, pointerMode, pushDepth, tiltPointer, type PointerMode } from '../lib/scene/layers';
import { createImpactLayer } from './impact-layer';

interface SceneState {
  root: HTMLElement;
  name: string;
  visible: boolean;
  /** 兵器幕：兵器台的宿主（拖曳轉動時背景跟著有一點視差）。 */
  weaponHost: HTMLElement | null;
}

function tiltSupport(): 'available' | 'needs-permission' | 'none' {
  const Orientation = (window as Window & { DeviceOrientationEvent?: { requestPermission?: unknown } }).DeviceOrientationEvent;
  if (!Orientation) return 'none';
  return typeof Orientation.requestPermission === 'function' ? 'needs-permission' : 'available';
}

export function initScenes(): void {
  const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-scene]'));
  if (roots.length === 0) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = window.innerWidth < 960;
  let mode: PointerMode = pointerMode({
    reducedMotion,
    hover: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    tilt: tiltSupport(),
  });
  const setMode = (next: PointerMode) => {
    mode = next;
    for (const root of roots) root.dataset.sceneMode = next;
  };
  setMode(mode);

  // ── 延後載入：前景以外的層等頁面載完才抓 ──
  const applyMasks = (root: HTMLElement) => {
    for (const layer of root.querySelectorAll<HTMLElement>('[data-mask]')) {
      layer.style.setProperty('--mask', `url("${layer.dataset.mask}")`);
      layer.removeAttribute('data-mask');
    }
    root.dataset.sceneReady = 'true';
  };
  // 首屏的場景：頁面載完就抓。其他幕的：捲到附近才抓（不算進首屏的傳輸量）。
  const nearby =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              applyMasks(entry.target as HTMLElement);
              nearby?.unobserve(entry.target);
            }
          },
          // 只預抓一小段：首屏後面緊接著就是兵器幕，抓太早就算進首屏的傳輸量。
          { rootMargin: '25% 0px' },
        )
      : null;
  const loadScenes = () => {
    for (const root of roots) {
      if (root.dataset.scene === 'hero' || !nearby) applyMasks(root);
      else nearby.observe(root);
    }
  };
  if (document.readyState === 'complete') loadScenes();
  else window.addEventListener('load', loadScenes, { once: true });

  // ── 首屏的體積光（WebGL2 著色器，src/scripts/atmos.ts）：頁面載完才載；不支援就留著 CSS 光束 ──
  const heroRoot = roots.find((root) => root.dataset.scene === 'hero');
  const atmosSlot = heroRoot?.querySelector<HTMLElement>('[data-atmos-slot]');
  if (heroRoot && atmosSlot) {
    const mountAtmos = () =>
      import('./atmos')
        .then(({ mountAtmos: mount }) => {
          heroRoot.dataset.atmos = mount(atmosSlot, heroRoot, { reducedMotion }) ? 'webgl2' : 'css';
        })
        .catch(() => {
          heroRoot.dataset.atmos = 'css';
        });
    if (document.readyState === 'complete') void mountAtmos();
    else window.addEventListener('load', () => void mountAtmos(), { once: true });
  }

  // ── 塵粒：每個塵粒層一張畫布（減少動態時不飄） ──
  if (!reducedMotion) {
    const mountDust = (slot: HTMLElement) => {
      // 藏起來的層（手機不顯示的）量不到大小，不用開。
      if (slot.querySelector('canvas') || slot.getBoundingClientRect().width === 0) return;
      const canvas = document.createElement('canvas');
      slot.append(canvas);
      createImpactLayer(canvas)?.setDrift(mobile ? 12 : 26);
    };
    for (const slot of document.querySelectorAll<HTMLElement>('[data-scene-dust]')) {
      // 兵器幕的塵是 3D 兵器前後的景深：等 3D 就緒才放（退回線稿時不放）。
      const scope = slot.closest<HTMLElement>('[data-weapon3d-scope]');
      if (!scope) {
        mountDust(slot);
        continue;
      }
      const whenReady = () => {
        if (scope.getAttribute('data-weapon3d-state') !== 'ready') return false;
        mountDust(slot);
        return true;
      };
      if (whenReady()) continue;
      const watcher = new MutationObserver(() => {
        if (whenReady()) watcher.disconnect();
      });
      watcher.observe(scope, { attributes: true, attributeFilter: ['data-weapon3d-state'] });
    }
  }

  if (mode === 'static') return;

  const scenes: SceneState[] = roots.map((root) => ({
    root,
    name: root.dataset.scene ?? '',
    visible: false,
    weaponHost: root.closest('[data-act]')?.querySelector<HTMLElement>('[data-weapon3d="stage"]') ?? null,
  }));
  const hero = document.querySelector<HTMLElement>('.hero');

  let targetX = 0;
  let targetY = 0;
  let x = 0;
  let y = 0;
  let raf = 0;
  let last = 0;
  const started = performance.now();

  /** 這一塊捲到哪裡（-1 剛從下緣進來、0 置中、1 要從上緣出去）。釘選中的幕再加上釘選的進度。 */
  const scrollProgress = (root: HTMLElement): number => {
    const host = root.parentElement;
    if (!host) return 0;
    const rect = host.getBoundingClientRect();
    const span = (window.innerHeight + rect.height) / 2 || 1;
    const base = (window.innerHeight / 2 - (rect.top + rect.height / 2)) / span;
    const pinned = Number(root.closest<HTMLElement>('[data-act]')?.dataset.pinProgress ?? 0);
    return Math.max(-1.2, Math.min(2, base + (Number.isFinite(pinned) ? pinned * 0.9 : 0)));
  };

  const frame = (now: number) => {
    raf = 0;
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    if (mode === 'drift') ({ x: targetX, y: targetY } = driftPointer(now - started));
    // 慢慢跟上，不是黏著指標跳。
    const follow = 1 - Math.exp(-dt / 180);
    x += (targetX - x) * follow;
    y += (targetY - y) * follow;

    let any = false;
    let heroAlive = false;
    for (const scene of scenes) {
      if (!scene.visible) continue;
      any = true;
      // 輪廓光：光源跟著指標，亮邊偏到指標那一側。
      scene.root.style.setProperty('--px', x.toFixed(4));
      // 首屏的裂紋畫在場景外面的畫布上：跟著人形那一層一起橫移，裂紋中心才一直在腳下。
      if (scene.name === 'hero') hero?.style.setProperty('--px', x.toFixed(4));
      scene.root.style.setProperty('--py', y.toFixed(4));
      scene.root.style.setProperty('--rim-x', `${(-1 + x * 5).toFixed(2)}px`);
      scene.root.style.setProperty('--rim-y', `${(-1.5 + y * 3).toFixed(2)}px`);
      if (scene.name !== 'hero') scene.root.style.setProperty('--sy', scrollProgress(scene.root).toFixed(4));
      // 兵器幕：兵器被拖著轉的時候，背景也跟著偏一點。
      const turn = scene.weaponHost ? Math.max(-1, Math.min(1, Number(scene.weaponHost.dataset.poseAngle ?? 0) * 0.35)) : 0;
      const origin = parallaxOrigin({ x: x + turn, y });
      scene.root.style.setProperty('--ox', `${origin.x.toFixed(2)}%`);
      scene.root.style.setProperty('--oy', `${origin.y.toFixed(2)}%`);
      if (scene.name === 'hero' && hero) {
        // 捲動頭六成就推到底：鏡頭穿過前景立柱進到院子裡。
        const progress = heroPush(window.scrollY, hero.offsetHeight);
        scene.root.style.setProperty('--push', `${pushDepth(progress).toFixed(1)}px`);
        scene.root.dataset.scenePush = progress.toFixed(3);
        // 開場演完之後鏡頭一直在走：極慢的推近加呼吸（11 秒一個來回）。
        if (document.documentElement.dataset.opening === 'done') {
          heroAlive = true;
          scene.root.style.setProperty('--breath', `${heroBreath(now - started).toFixed(2)}px`);
        }
      }
    }
    const settled = Math.abs(targetX - x) + Math.abs(targetY - y) < 0.002;
    if (any && (heroAlive || mode === 'drift' || !settled || scenes.some((scene) => scene.weaponHost?.dataset.dragging))) wake();
    else last = 0;
  };
  const wake = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  // 開場演完時把迴圈叫醒（鏡頭的呼吸從這時開始）。
  new MutationObserver(() => wake()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-opening'] });

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const scene = scenes.find((item) => item.root === entry.target);
      if (scene) scene.visible = entry.isIntersecting;
    }
    wake();
  });
  for (const scene of scenes) observer.observe(scene.root);

  const passive = { passive: true } as const;
  window.addEventListener('scroll', wake, passive);

  if (mode === 'mouse') {
    window.addEventListener(
      'pointermove',
      (event) => {
        targetX = (event.clientX / window.innerWidth) * 2 - 1;
        targetY = (event.clientY / window.innerHeight) * 2 - 1;
        wake();
      },
      passive,
    );
  } else if (mode === 'tilt') {
    let heard = false;
    window.addEventListener(
      'deviceorientation',
      (event) => {
        if (event.beta === null || event.gamma === null) return;
        heard = true;
        ({ x: targetX, y: targetY } = tiltPointer(event.beta, event.gamma));
        wake();
      },
      passive,
    );
    // 有這個事件但裝置其實沒有陀螺儀（不會送資料）：退成緩慢漂移。
    window.setTimeout(() => {
      if (!heard) {
        setMode('drift');
        wake();
      }
    }, 1500);
  }
}
