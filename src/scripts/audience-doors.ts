// 「大人｜小孩」切換的門扇開合（第四輪）。狀態在 src/lib/doors.ts（純邏輯）；這裡接 DOM：
//   兩扇窗櫺紋的門扇從左右合攏蓋住課程卡（CSS 3D rotateY 繞門軸轉、帶透視）→ 合上那一下小震、門縫揚塵 →
//   門後換組（改 <html data-audience>）→ 門向內打開、新卡片由深處沿 Z 軸依序飛出就定位（景深模糊漸清）。
// 整段 ≤ 900ms，可以連點（中斷舊動畫、直接走向新狀態）；任何時刻只顯示一組卡片。減少動態時直接切換。
//
//   .audience-cards data-door="closing|opening"   門正在合／正在開（沒有這個屬性就是靜止）
//   .audience-cards style --door                  門的開度：0 全合、1 全開

import { advanceDoor, createDoor, doorOpenness, requestDoor, type DoorState } from '../lib/doors';
import type { Audience } from '../lib/courses';
import { spawnDustRing } from '../lib/impact/particles';
import { createImpactLayer, type ImpactLayer } from './impact-layer';

export interface DoorController {
  request(audience: Audience): void;
}

export function createDoors(initial: Audience, show: (audience: Audience) => void): DoorController {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hosts = Array.from(document.querySelectorAll<HTMLElement>('.audience-cards'));
  let state: DoorState = createDoor(initial);
  let raf = 0;
  let last = 0;
  let dust: ImpactLayer | null = null;

  const render = () => {
    const open = doorOpenness(state);
    for (const host of hosts) {
      if (state.phase === 'idle') {
        delete host.dataset.door;
        host.style.removeProperty('--door');
      } else {
        host.dataset.door = state.phase;
        host.classList.add('has-doored');
        host.style.setProperty('--door', open.toFixed(4));
        // 門蓋住的範圍：課程卡那一塊（切換鈕下面）。
        const controls = host.querySelector<HTMLElement>('.audience-cards__controls');
        if (controls) host.style.setProperty('--doors-top', `${controls.offsetTop + controls.offsetHeight + 8}px`);
      }
    }
  };

  /** 合上那一下：門扇與卡片區小震一下，門縫揚起一道塵。 */
  const slam = () => {
    for (const host of hosts) {
      const doors = host.querySelector<HTMLElement>('.audience-doors');
      if (!doors || doors.getBoundingClientRect().height === 0) continue;
      doors.animate([{ transform: 'translate3d(0, 0, 0)' }, { transform: 'translate3d(0, 3px, 0)', offset: 0.25 }, { transform: 'translate3d(0, -1px, 0)', offset: 0.6 }, { transform: 'none' }], {
        duration: 220,
        easing: 'ease-out',
      });
      const canvas = doors.querySelector<HTMLCanvasElement>('canvas');
      if (!canvas) continue;
      dust ??= createImpactLayer(canvas);
      const rect = canvas.getBoundingClientRect();
      // 沿著門縫（中線）由上到下幾撮塵，往兩側噴開。
      for (let i = 0; i < 6; i++) {
        dust?.emit(spawnDustRing({ count: 16, seed: 90 + i, speed: 0.32, squash: 0.35, life: 520 }), rect.width / 2, (rect.height * (i + 0.5)) / 6, 'dust');
      }
    }
  };

  const frame = (now: number) => {
    raf = 0;
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    const before = state;
    state = advanceDoor(state, dt);
    if (before.shown !== state.shown) {
      show(state.shown);
      slam();
    }
    render();
    if (state.phase !== 'idle') raf = requestAnimationFrame(frame);
    else last = 0;
  };

  return {
    request(audience) {
      const before = state;
      state = requestDoor(state, audience, { instant: reducedMotion || hosts.length === 0 });
      if (state.shown !== before.shown) show(state.shown);
      render();
      if (state.phase !== 'idle' && !raf) raf = requestAnimationFrame(frame);
    },
  };
}
