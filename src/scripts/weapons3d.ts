// 3D 兵器的入口（設計文件 §15）。這個檔案本身不含 three：
// 先做能力偵測，等使用者「接近」某個 3D 區塊（[data-weapon3d]）時才動態載入 src/scripts/three/viewer.ts。
//
//   <html data-three="loading|loaded">              three 是否已下載（沒有這個屬性就是沒載）
//   [data-weapon3d] data-weapon3d-state="ready"     這一塊已經是 3D
//   [data-weapon3d] data-weapon3d-state="fallback"  這一塊留著第一版的 SVG 線稿（沒有 WebGL、或建立失敗）
// 同一個狀態也會標在最近的 [data-weapon3d-scope] 上，樣式依它決定藏線稿還是藏 3D 的操作列。

import { mountDelayMs, planRendering, shouldLoad3d, type RenderPlan } from '../lib/arsenal/capability';

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function detectPlan(): RenderPlan {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return planRendering({
    webgl: hasWebGL(),
    viewportWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    saveData: connection?.saveData === true,
  });
}

function setState(host: HTMLElement, state: 'ready' | 'fallback'): void {
  host.dataset.weapon3dState = state;
  host.closest('[data-weapon3d-scope]')?.setAttribute('data-weapon3d-state', state);
}

export function initWeapons3d(): void {
  const pending = new Set(document.querySelectorAll<HTMLElement>('[data-weapon3d]'));
  if (pending.size === 0) return;

  const plan = detectPlan();
  if (plan.mode === 'fallback') {
    for (const host of pending) setState(host, 'fallback');
    return;
  }

  const root = document.documentElement;
  let hasScrolled = window.scrollY > 4;
  let viewer: Promise<typeof import('./three/viewer')> | undefined;

  const mount = (host: HTMLElement) => {
    pending.delete(host);
    if (!viewer) {
      root.dataset.three = 'loading';
      viewer = import('./three/viewer');
      viewer.then(
        () => {
          root.dataset.three = 'loaded';
        },
        () => {
          delete root.dataset.three;
        },
      );
    }
    viewer
      .then(({ mountViewer }) => {
        mountViewer(host, plan);
      })
      .catch((error: unknown) => {
        // 下載失敗或建立 WebGL 失敗：留著線稿，頁面照常。
        console.warn('3D 兵器無法啟用，改用線稿。', error);
        host.querySelector('canvas.weapon3d__canvas')?.remove();
        setState(host, 'fallback');
      });
  };

  /** 這一塊現在符不符合載入條件。 */
  const eligible = (host: HTMLElement): boolean => {
    const viewportHeight = window.innerHeight;
    const rect = host.getBoundingClientRect();
    // 藏起來的區塊（例如另一個對象的卡片）量不到大小，先不載。
    if (rect.width === 0 || rect.height === 0) return false;
    const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
    const visibleRatio = Math.max(0, visibleHeight) / rect.height;
    const distance = rect.top > viewportHeight ? rect.top - viewportHeight : rect.bottom < 0 ? -rect.bottom : 0;
    return shouldLoad3d({ visibleRatio, distance, viewportHeight, hasScrolled });
  };

  /** 等停留時間的那些：宿主 → 計時器。期間不再符合條件就取消，之後重新算。 */
  const dwelling = new Map<HTMLElement, number>();

  const check = () => {
    for (const host of [...pending]) {
      const ok = eligible(host);
      const delay = mountDelayMs(host.dataset.weapon3d);
      if (!ok) {
        const timer = dwelling.get(host);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          dwelling.delete(host);
        }
        continue;
      }
      if (delay === 0) {
        mount(host);
      } else if (!dwelling.has(host)) {
        dwelling.set(
          host,
          window.setTimeout(() => {
            dwelling.delete(host);
            if (pending.has(host) && eligible(host)) mount(host);
          }, delay),
        );
      }
    }
    if (pending.size === 0) stop();
  };

  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      check();
    });
  };
  const onScroll = () => {
    if (window.scrollY > 4) hasScrolled = true;
    queue();
  };
  const stop = () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', queue);
    document.removeEventListener('click', queue);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', queue, { passive: true });
  // 切換「大人｜小孩」會讓原本藏著的卡片出現。
  document.addEventListener('click', queue);
  window.addEventListener('load', queue, { once: true });
  check();
}
