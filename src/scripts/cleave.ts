// 苗刀破幅（第三版）：幕與幕之間的轉場。一幅寫著下一幕單字的幅落下來蓋住畫面，一道由右上到左下的長弧劈過，
// 定格兩三幀，幅沿刀路錯成兩半——上半往右上、下半往左下錯開視窗高的 7%——再各自滑出畫面，露出下一幕。
// 切線是一道亮金細線（芯近白金、外緣是金，共約 3px，不是寬光帶），火星沿線迸出；兩半的切口各帶一條金邊跟著移動。
// 時間軸與幾何在 src/lib/impact/cleave.ts；這裡用 DOM 分層加 clip-path 實作（不用 WebGL）。
// 整層 pointer-events: none，不擋點擊與捲動；「減少動態」時不啟用（由 slash.ts 決定）。
//
//   [data-cleave] data-cleave-phase  idle | drop | slash | freeze | part
//   [data-cleave] data-cleave-count  累計播了幾次
//   [data-cleave] data-cleave-shift  兩半錯開的量（視窗高的比例）

import { CLEAVE, cleaveClips, cleavePath, cleaveShift, toClipPath } from '../lib/impact/cleave';
import { burstChips } from '../lib/impact/particles';
import { createImpactLayer, type ImpactLayer } from './impact-layer';

/** 兩次破幅至少隔這麼久（來回捲動時不連發；也確保不會有密集的大面積明暗變化）。 */
const COOLDOWN_MS = 1400;

export interface Cleave {
  /** 劈一次；正在播或還在冷卻就不播（回 false）。 */
  trigger(glyph: string): boolean;
}

export function createCleave(): Cleave | null {
  const host = document.querySelector<HTMLElement>('[data-cleave]');
  if (!host || typeof host.animate !== 'function') return null;
  const upper = host.querySelector<HTMLElement>('.cleave__half--upper');
  const lower = host.querySelector<HTMLElement>('.cleave__half--lower');
  const canvas = host.querySelector<HTMLCanvasElement>('canvas');
  // 切線有三份：劈過去的那一道（最上層），以及兩半切口上各一條跟著走的金邊。
  const edges = Array.from(host.querySelectorAll<SVGSVGElement>('.cleave__edge'));
  const stroke = host.querySelector<SVGSVGElement>('.cleave__edge--stroke');
  if (!upper || !lower || !canvas || !stroke) return null;

  host.dataset.cleavePhase = 'idle';
  host.dataset.cleaveCount = '0';
  host.dataset.cleaveShift = String(CLEAVE.shift);
  let layer: ImpactLayer | null = null;
  let busy = false;
  let lastAt = -Infinity;
  let count = 0;

  return {
    trigger(glyph) {
      const now = performance.now();
      if (busy || now - lastAt < COOLDOWN_MS) return false;
      busy = true;
      lastAt = now;
      count += 1;
      host.dataset.cleaveCount = String(count);

      const width = window.innerWidth;
      const height = window.innerHeight;
      const { upper: upperClip, lower: lowerClip } = cleaveClips(width, height);
      const path = cleavePath(width, height);
      upper.style.clipPath = toClipPath(upperClip);
      lower.style.clipPath = toClipPath(lowerClip);
      for (const label of host.querySelectorAll<HTMLElement>('.cleave__glyph')) label.textContent = glyph;
      const d = `M${path.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join('L')}`;
      for (const edge of edges) {
        edge.setAttribute('viewBox', `0 0 ${width} ${height}`);
        for (const line of edge.querySelectorAll('path')) line.setAttribute('d', d);
      }
      const strokeLines = Array.from(stroke.querySelectorAll<SVGPathElement>('path'));
      const length = strokeLines[0]?.getTotalLength() ?? width;
      for (const line of strokeLines) {
        line.style.strokeDasharray = String(length);
        line.style.strokeDashoffset = String(length);
      }

      host.hidden = false;
      layer ??= createImpactLayer(canvas);
      const phase = (name: string) => {
        host.dataset.cleavePhase = name;
      };
      const { dropMs, slashMs, freezeMs, partMs, totalMs } = CLEAVE;
      const animated: Element[] = [upper, lower, stroke, ...strokeLines];

      // 落幅：整幅由上落下蓋住畫面。
      phase('drop');
      const drop: Keyframe[] = [{ transform: 'translate3d(0, -100%, 0)' }, { transform: 'translate3d(0, 0, 0)' }];
      upper.animate(drop, { duration: dropMs, easing: 'cubic-bezier(0.5, 0, 0.9, 0.4)' });
      lower.animate(drop, { duration: dropMs, easing: 'cubic-bezier(0.5, 0, 0.9, 0.4)' });

      // 劈：亮金細線由右上劃到左下。
      window.setTimeout(() => {
        phase('slash');
        stroke.style.opacity = '1';
        for (const line of strokeLines) {
          line.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
            duration: slashMs,
            easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)',
            fill: 'forwards',
          });
        }
      }, dropMs);

      // 定格：兩三幀什麼都不動；火星沿切線迸出。
      window.setTimeout(() => {
        phase('freeze');
        for (let i = 1; i < path.length - 1; i += 1) {
          const point = path[i]!;
          layer?.emit(
            burstChips({ count: 9, seed: 40 + i, direction: i % 2 ? Math.PI * 0.2 : Math.PI * 1.2, speed: 0.6, spread: 2.2, life: 560 }),
            point.x,
            point.y,
            'sparks',
          );
        }
      }, dropMs + slashMs);

      // 滑開：先沿刀路錯開（上半往右上、下半往左下，各走視窗高的 7%），頓一下，再順著同一個方向滑出畫面。
      window.setTimeout(() => {
        phase('part');
        const shift = cleaveShift(height);
        const options: KeyframeAnimationOptions = { duration: partMs, easing: 'linear', fill: 'forwards' };
        const slide = (by: { x: number; y: number }): Keyframe[] => [
          { transform: 'translate3d(0, 0, 0)', easing: 'cubic-bezier(0.1, 0.9, 0.2, 1)' },
          { transform: `translate3d(${by.x.toFixed(1)}px, ${by.y.toFixed(1)}px, 0)`, offset: 0.26 },
          { transform: `translate3d(${(by.x * 1.15).toFixed(1)}px, ${(by.y * 1.15).toFixed(1)}px, 0)`, offset: 0.44, easing: 'cubic-bezier(0.6, 0, 0.9, 0.3)' },
          { transform: `translate3d(${(by.x * 6).toFixed(1)}px, ${(by.y * 17).toFixed(1)}px, 0)` },
        ];
        upper.animate(slide(shift.upper), options);
        lower.animate(slide(shift.lower), options);
        // 劈過去的那一道在兩半錯開時就淡掉，剩下兩半切口上的金邊跟著走。
        stroke.animate([{ opacity: 1 }, { opacity: 0 }], { duration: partMs * 0.3, fill: 'forwards' });
      }, dropMs + slashMs + freezeMs);

      window.setTimeout(() => {
        phase('idle');
        host.hidden = true;
        stroke.style.opacity = '';
        for (const element of animated) for (const animation of element.getAnimations()) animation.cancel();
        busy = false;
      }, totalMs + 30);
      return true;
    },
  };
}
