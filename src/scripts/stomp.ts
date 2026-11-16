// 拳術那一幕的兩個招式（設計文件 §15.2-3；第三版加重）。取八極拳發力的意象，不寫拳理。
//
// 震腳：點朱印（或聚焦後按空白鍵／Enter）——定格兩三幀、整個視窗下沉再回彈（帶一點縮放）、
//       以單字為圓心向八方裂出金線（裂縫先亮後暗）、塵浪與碎石、八方紋震開一圈。
//       和首屏的「一震開門」是同一套（src/scripts/impact-layer.ts）。
// 貼山靠：版面被橫向撞開再彈回，大字後面拖兩三個低透明度的平面錯位複本（單色、沒有漸層與陰影；大字維持平面色）；
//       兩塊課程牌像木牌被撞歪再晃回正、撞點噴出漆片與金屑、貼山靠的人形朝牌子快速掠過去。
//
// 「減少動態」時兩顆按鈕都不出現（維持 hidden），什麼都不做。
// 按鈕等這一幕接近畫面才打開：朱印上的字用標題字型，太早顯示會讓首屏多抓幾片字型。
//
//   [data-stomp] / [data-kao]            按鈕（Acts.astro；預設 hidden，由這裡打開）
//   [data-act] data-stomping / data-kao  正在震／正在撞
//   [data-act] data-stomp-count / data-kao-count  累計次數

import { burstChips, spawnDebris, spawnDustRing } from '../lib/impact/particles';
import { SHOVE_MS, SINK_MS, sampleOffsets, shoveOffset, sinkOffset, sinkScale } from '../lib/impact/shake';
import { chromeElements, createImpactLayer, playOffsets, type ImpactLayer } from './impact-layer';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** 震波從開始到收乾淨的時間。 */
const STOMP_MS = 1300;
const KAO_MS = 800;
/** 兩顆鈕各自的冷卻：連點不會疊出一串震動。 */
const COOLDOWN_MS = 400;
/** 貼山靠的殘影：兩個複本、各自落後多少（相對於撞開的距離；拉得夠開，才是殘影而不是疊出來的厚度）。 */
const GHOSTS = [3, 6];

/** 八角形的路徑（和 Bafang.astro 的外框同一個形）。 */
function octagon(radius: number): string {
  const points = Array.from({ length: 8 }, (_, i) => {
    const angle = ((22.5 + i * 45) * Math.PI) / 180;
    return `${(400 + Math.cos(angle) * radius).toFixed(1)} ${(400 + Math.sin(angle) * radius).toFixed(1)}`;
  });
  return `M${points.join('L')}Z`;
}

function createRing(size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'stomp-ring line-art');
  svg.setAttribute('viewBox', '0 0 800 800');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.setProperty('--emblem', `${size}px`);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', octagon(396));
  path.setAttribute('stroke-width', '2');
  svg.append(path);
  return svg;
}

export function initStomp(): void {
  const stompButton = document.querySelector<HTMLButtonElement>('[data-stomp]');
  const act = stompButton?.closest<HTMLElement>('[data-act]');
  const stage = act?.querySelector<HTMLElement>('.act__stage');
  const glyph = act?.querySelector<HTMLElement>('.act__glyph');
  if (!stompButton || !act || !stage || !glyph) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (typeof stage.animate !== 'function') return;

  const kaoButton = act.querySelector<HTMLButtonElement>('[data-kao]');
  const canvas = act.querySelector<HTMLCanvasElement>('canvas[data-impact]');
  let layer: ImpactLayer | null = null;
  const impact = () => (layer ??= canvas ? createImpactLayer(canvas) : null);
  const mobile = () => window.innerWidth < 960;

  /** 元素上某一點在衝擊層畫布裡的位置。 */
  const within = (rect: DOMRect, fx = 0.5, fy = 0.5) => {
    const frame = canvas?.getBoundingClientRect() ?? rect;
    return { x: rect.left + rect.width * fx - frame.left, y: rect.top + rect.height * fy - frame.top };
  };

  // 這一幕接近畫面才把按鈕打開。
  const reveal = () => {
    stompButton.hidden = false;
    if (kaoButton) kaoButton.hidden = false;
  };
  if ('IntersectionObserver' in window) {
    const watcher = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        reveal();
        watcher.disconnect();
      },
      { rootMargin: '100% 0px' },
    );
    watcher.observe(act);
  } else {
    reveal();
  }

  // ── 震腳 ──
  let stomps = 0;
  let stompTimer = 0;
  let rings: SVGSVGElement[] = [];
  const settleStomp = () => {
    for (const ring of rings) ring.remove();
    rings = [];
    delete act.dataset.stomping;
    impact()?.fadeCracks(0, 500);
  };

  let stompAt = -Infinity;
  stompButton.addEventListener('click', () => {
    const now = performance.now();
    if (now - stompAt < COOLDOWN_MS) return;
    stompAt = now;
    stomps += 1;
    act.dataset.stompCount = String(stomps);
    act.dataset.stomping = 'true';

    const glyphRect = glyph.getBoundingClientRect();
    const emblem = glyph.querySelector<SVGElement>('.act__emblem');
    const size = emblem?.getBoundingClientRect().width || glyphRect.width;
    const centre = within(glyphRect);
    const fx = impact();
    const depth = mobile() ? 6 : 9;

    // 擊：裂紋先炸開一段（裂縫裡是亮的）、視窗下沉帶一點縮放。
    fx?.setImpact(centre.x, centre.y, Math.max(size * 0.62, (canvas?.getBoundingClientRect().width ?? size) * 0.5), 11 + (stomps % 3));
    fx?.setCracks(0.3, 1, true);
    playOffsets([stage], sampleOffsets((t) => sinkOffset(t, depth), SINK_MS, 'y', sinkScale), SINK_MS);
    playOffsets(chromeElements(), sampleOffsets((t) => sinkOffset(t, depth), SINK_MS, 'y'), SINK_MS);
    // 巨大單字跟著一頓。
    glyph.animate([{ transform: 'scale(0.93)' }, { transform: 'scale(1.03)', offset: 0.4 }, { transform: 'scale(1)' }], {
      duration: 520,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    });

    // 定格兩三幀之後：裂到底、塵浪外推、碎石揚起；裂縫的光隨後暗下來。
    window.setTimeout(() => {
      const started = performance.now();
      const grow = () => {
        const t = Math.min(1, (performance.now() - started) / 260);
        if (!act.dataset.stomping) return;
        if (t < 1) {
          fx?.setCracks(0.3 + 0.7 * (1 - Math.pow(1 - t, 3)), 1, true);
          requestAnimationFrame(grow);
        } else {
          fx?.setCracks(1, 1, true);
          fx?.fadeCracks(0.7, 420);
        }
      };
      requestAnimationFrame(grow);
      fx?.emit(spawnDustRing({ count: mobile() ? 80 : 190, seed: 21 + stomps, speed: mobile() ? 0.8 : 1.3, life: 1000 }), centre.x, centre.y, 'dust');
      fx?.emit(spawnDebris({ count: mobile() ? 24 : 50, seed: 31 + stomps, speed: 0.7 }), centre.x, centre.y + size * 0.2, 'debris');
    }, 60);

    // 八方紋震開一圈（定格之後才開始擴）。
    const ring = createRing(size);
    glyph.prepend(ring);
    rings.push(ring);
    ring.animate(
      [
        { transform: 'scale(0.12)', opacity: 0.9 },
        { transform: 'scale(1.5)', opacity: 0 },
      ],
      { duration: 760, delay: 60, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' },
    );

    window.clearTimeout(stompTimer);
    stompTimer = window.setTimeout(settleStomp, STOMP_MS);
  });

  // ── 貼山靠 ──
  if (!kaoButton) return;
  let kaos = 0;
  let kaoTimer = 0;
  let ghosts: HTMLElement[] = [];
  const clearGhosts = () => {
    for (const ghost of ghosts) ghost.remove();
    ghosts = [];
  };

  let kaoAt = -Infinity;
  kaoButton.addEventListener('click', () => {
    const now = performance.now();
    if (now - kaoAt < COOLDOWN_MS) return;
    kaoAt = now;
    kaos += 1;
    act.dataset.kaoCount = String(kaos);
    act.dataset.kao = 'true';
    const reach = mobile() ? 16 : 28;
    const courses = act.querySelector<HTMLElement>('.act__courses');
    // 撞的方向：由單字那一側撞向課程牌。
    const fromRight = glyph.getBoundingClientRect().left > (courses?.getBoundingClientRect().left ?? 0);
    const push = fromRight ? -1 : 1;

    // 版面被橫向撞開再彈回（整體橫移，不加任何陰影或濾鏡）。
    stage.animate(sampleOffsets((t) => shoveOffset(t, reach) * -push, SHOVE_MS, 'x'), { duration: SHOVE_MS, easing: 'linear' });

    // 殘影：大字的兩三個平面錯位複本——同一個字、單色、低透明度（沒有漸層、陰影、濾鏡），
    // 一個比一個落後，拖在被撞開的反方向；拉開的距離比字的筆畫粗得多，看起來是殘影，不是疊出來的立體字。
    clearGhosts();
    const letter = glyph.querySelector<HTMLElement>(':scope > span');
    if (letter) {
      const frame = stage.getBoundingClientRect();
      const rect = letter.getBoundingClientRect();
      const font = getComputedStyle(letter);
      GHOSTS.forEach((lag, index) => {
        const ghost = document.createElement('span');
        ghost.className = 'act__ghost';
        ghost.setAttribute('aria-hidden', 'true');
        ghost.textContent = letter.textContent;
        ghost.style.left = `${rect.left - frame.left}px`;
        ghost.style.top = `${rect.top - frame.top}px`;
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
        ghost.style.font = font.font;
        ghost.style.lineHeight = `${rect.height}px`;
        // 疊在大字後面。
        stage.insertBefore(ghost, glyph);
        ghosts.push(ghost);
        const trail = -push * reach * lag;
        ghost.animate(
          [
            { transform: 'translate3d(0, 0, 0)', opacity: 0.14 - index * 0.05 },
            { transform: `translate3d(${trail}px, 0, 0)`, opacity: 0.11 - index * 0.04, offset: 0.25 },
            { transform: `translate3d(${trail * 1.3}px, 0, 0)`, opacity: 0 },
          ],
          { duration: 420 + index * 70, easing: 'ease-out', fill: 'forwards' },
        );
      });
    }

    // 場景裡的人形朝課程牌撞過去：有貼山靠的人形就換上它快速掠過（那張手臂與軀幹黏成一團，不停在畫面上），
    // 撞完換回馬步撐捶的人；沒有就用馬步撐捶的人撞過去再收回來。
    const kaoFigure = act.querySelector<HTMLElement>('.scene [data-figure="kao"]');
    const charger = kaoFigure ?? act.querySelector<HTMLElement>('.scene [data-figure="fist"]');
    kaoFigure?.classList.add('is-charging');
    charger
      ?.querySelector('.scene__figure')
      ?.animate(
        [{ translate: '0 0' }, { translate: `${push * 150}px 0`, offset: 0.16 }, { translate: `${push * 48}px 0`, offset: 0.5 }, { translate: '0 0' }],
        { duration: 560, easing: 'ease-out' },
      )
      .finished.finally(() => kaoFigure?.classList.remove('is-charging'))
      .catch(() => undefined);

    // 課程牌：像掛著的木牌，被撞歪再晃回正（繞上緣轉），一塊接一塊。
    const tablets = Array.from(act.querySelectorAll<HTMLElement>('.act__course'));
    tablets.forEach((tablet, index) => {
      const order = fromRight ? tablets.length - 1 - index : index;
      tablet.animate(
        [
          { transform: 'rotate(0deg)' },
          { transform: `rotate(${push * 6.5}deg)`, offset: 0.16 },
          { transform: `rotate(${-push * 3.6}deg)`, offset: 0.42 },
          { transform: `rotate(${push * 1.6}deg)`, offset: 0.68 },
          { transform: 'rotate(0deg)' },
        ],
        { duration: 720, delay: 30 + order * 60, easing: 'ease-out' },
      );
    });

    // 撞點：課程牌朝單字那一側的邊緣，噴出漆片與金屑（往被撞開的方向飛）。
    if (courses) {
      const point = within(courses.getBoundingClientRect(), fromRight ? 1 : 0, 0.42);
      impact()?.emit(
        burstChips({ count: mobile() ? 30 : 64, seed: 60 + kaos, direction: fromRight ? Math.PI : 0, speed: 0.9, spread: 1.5, life: 900 }),
        point.x,
        point.y,
        'chips',
      );
    }

    window.clearTimeout(kaoTimer);
    kaoTimer = window.setTimeout(() => {
      delete act.dataset.kao;
      clearGhosts();
    }, KAO_MS);
  });
}
