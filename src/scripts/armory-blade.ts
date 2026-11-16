// 兵器切換列底下的刀鋒指示條（第四輪）：選中的那一件下面一道刃光，換兵器時像刀鋒一樣滑過去、身後留一道很快淡掉的殘光。
// aria-pressed 由兵器台（src/scripts/three/viewer.ts）改；這裡只看著它。減少動態時直接跳到位，不留殘光。

export function initArmoryBlade(): void {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const group of document.querySelectorAll<HTMLElement>('.armory-switch')) {
    const blade = group.querySelector<HTMLElement>('.armory-switch__blade');
    if (!blade) continue;
    let at: { left: number; width: number } | null = null;

    const place = () => {
      const pick = group.querySelector<HTMLElement>('[data-weapon-pick][aria-pressed="true"]');
      if (!pick || pick.offsetWidth === 0) return;
      const next = { left: pick.offsetLeft, width: pick.offsetWidth };
      if (at && (at.left !== next.left || at.width !== next.width) && !reducedMotion) {
        // 殘光：蓋住舊位置到新位置的整段，從舊的那一端往新的那一端收掉。
        const from = Math.min(at.left, next.left);
        const to = Math.max(at.left + at.width, next.left + next.width);
        const trail = document.createElement('span');
        trail.className = 'armory-switch__trail';
        trail.setAttribute('aria-hidden', 'true');
        trail.style.translate = `${from}px 0`;
        trail.style.width = `${to - from}px`;
        group.append(trail);
        const forward = next.left > at.left;
        trail
          .animate(
            [
              { opacity: 0.95, clipPath: 'inset(0 0 0 0)' },
              { opacity: 0, clipPath: forward ? 'inset(0 0 0 70%)' : 'inset(0 70% 0 0)' },
            ],
            { duration: 520, easing: 'ease-out', fill: 'forwards' },
          )
          .finished.then(() => trail.remove(), () => trail.remove());
      }
      at = next;
      blade.style.translate = `${next.left}px 0`;
      blade.style.width = `${next.width}px`;
    };

    new MutationObserver(place).observe(group, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
    new ResizeObserver(place).observe(group);
    place();
  }
}
