// 震腳（設計文件 §15.2-3）：在「拳術」那一幕點一下按鈕（或聚焦後按空白鍵／Enter），
// 八方紋自中心向外震開一圈，那一幕微微一震。取八極拳發力的意象，不寫拳理。
// 「減少動態」時按鈕不出現（維持 hidden），什麼都不做。
//
//   [data-stomp]                 按鈕（Acts.astro；預設 hidden，由這裡打開）
//   [data-act] data-stomping     正在震
//   [data-act] data-stomp-count  累計震了幾次

const SVG_NS = 'http://www.w3.org/2000/svg';
/** 震波從開始到收乾淨的時間。 */
const STOMP_MS = 1300;

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
  for (const [radius, width] of [
    [396, 2.5],
    [372, 1],
  ] as const) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', octagon(radius));
    path.setAttribute('stroke-width', String(width));
    svg.append(path);
  }
  return svg;
}

export function initStomp(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-stomp]');
  const act = button?.closest<HTMLElement>('[data-act]');
  const stage = act?.querySelector<HTMLElement>('.act__stage');
  const glyph = act?.querySelector<HTMLElement>('.act__glyph');
  if (!button || !act || !stage || !glyph) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (typeof stage.animate !== 'function') return;

  button.hidden = false;
  let count = 0;
  let cleanup = 0;
  let rings: SVGSVGElement[] = [];

  const settle = () => {
    for (const ring of rings) ring.remove();
    rings = [];
    delete act.dataset.stomping;
  };

  button.addEventListener('click', () => {
    count += 1;
    act.dataset.stompCount = String(count);
    act.dataset.stomping = 'true';

    // 震波：三圈八角由中心向外擴、淡出，一圈比一圈慢。
    const emblem = glyph.querySelector<SVGElement>('.act__emblem');
    const size = emblem?.getBoundingClientRect().width || glyph.getBoundingClientRect().width;
    for (let i = 0; i < 3; i++) {
      const ring = createRing(size);
      glyph.prepend(ring);
      rings.push(ring);
      ring.animate(
        [
          { transform: 'scale(0.12)', opacity: 0.95 },
          { transform: `scale(${1.25 + i * 0.3})`, opacity: 0 },
        ],
        { duration: 760 + i * 200, delay: i * 90, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' },
      );
    }

    // 那一幕微震：先往下一沉，再左右抖幾下收住。只動 transform。
    stage.animate(
      [
        { transform: 'translate3d(0, 0, 0)' },
        { transform: 'translate3d(0, 9px, 0)', offset: 0.12 },
        { transform: 'translate3d(-5px, -4px, 0)', offset: 0.3 },
        { transform: 'translate3d(4px, 3px, 0)', offset: 0.48 },
        { transform: 'translate3d(-2px, -1px, 0)', offset: 0.68 },
        { transform: 'translate3d(1px, 0, 0)', offset: 0.85 },
        { transform: 'translate3d(0, 0, 0)' },
      ],
      { duration: 460, easing: 'linear' },
    );

    // 巨大單字跟著一頓。
    glyph.animate([{ transform: 'scale(0.94)' }, { transform: 'scale(1.03)', offset: 0.4 }, { transform: 'scale(1)' }], {
      duration: 520,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    });

    window.clearTimeout(cleanup);
    cleanup = window.setTimeout(settle, STOMP_MS);
  });
}
