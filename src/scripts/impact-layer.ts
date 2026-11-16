// 衝擊層：一張 2D 畫布（[data-impact]，不接收指標事件），畫裂紋與顆粒（塵土、碎石、金屑、漆片、火星）。
// 首屏的「一震開門」、拳術幕的震腳與貼山靠、幕間破幅的火星都用它。不用 three（首屏不能載 three）。
// 幾何與顆粒的步進在 src/lib/impact/；這裡只管畫。只有在有東西要動、而且畫布在畫面上時才跑 requestAnimationFrame。
//
// 裂紋可以貼在地面上（給 ground）：以低機位的透視投影——往遠處的收向地平線，往近處的衝向畫面邊緣。
// 線寬由粗到細；剛裂開時裂縫裡是亮金的光（heat），隨後暗下來變成地面上的刻線。
//
//   data-impact-cracks     目前畫出來的主裂線數（0 或 8）
//   data-impact-reach      裂紋橫向到多遠（相對於畫布半寬；≥ 1 就是衝到邊緣）
//   data-impact-particles  目前還活著的顆粒數（不含慢飄的塵粒）

import { NEAREST, crackRibbon, crackWidth, generateCracks, projectGround, revealCrack, type Crack, type Point } from '../lib/impact/cracks';
import { stepParticles, type Particle } from '../lib/impact/particles';

export type ParticleKind = 'dust' | 'debris' | 'chips' | 'sparks';

const KINDS: ParticleKind[] = ['dust', 'debris', 'chips', 'sparks'];

const PHYSICS: Record<ParticleKind, { drag: number; gravity: number }> = {
  // 塵土：阻力大，推出去一下就慢下來，幾乎不往下掉。
  dust: { drag: 0.0026, gravity: 0.00002 },
  // 碎石：往上噴，被重力拉下來。
  debris: { drag: 0.0012, gravity: 0.0016 },
  // 漆片：飛得遠一點，會往下掉。
  chips: { drag: 0.0022, gravity: 0.0011 },
  // 火星：很快熄。
  sparks: { drag: 0.003, gravity: 0.0007 },
};

interface Drift {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
}

export interface Ground {
  /** 落點在地平線下方多少 px。 */
  rise: number;
  /** 透視的強度（越小遠近差越大）。 */
  depth: number;
}

export interface ImpactLayer {
  /** 設定落點（畫布座標，CSS px）與裂紋的半徑；給 ground 就把裂紋貼在地面上。同一個種子每次裂的都一樣。 */
  setImpact(x: number, y: number, radius: number, seed?: number, ground?: Ground): void;
  /** 裂紋露出的比例（0–1）與濃度（0–1）。fresh：剛裂開，裂縫裡是亮的。 */
  setCracks(progress: number, alpha: number, fresh?: boolean): void;
  /** 裂紋的濃度慢慢過渡到 alpha（用 ms），裂縫裡的光同時暗下來。 */
  fadeCracks(alpha: number, ms: number): void;
  /** 在 (x, y) 放出一批顆粒。 */
  emit(particles: Particle[], x: number, y: number, kind: ParticleKind): void;
  /** 慢飄的塵粒（0 就是關掉）。 */
  setDrift(count: number): void;
  /** 立刻重畫一格（不動的終態用）。 */
  redraw(): void;
  dispose(): void;
}

export function createImpactLayer(canvas: HTMLCanvasElement): ImpactLayer | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  const colors = {
    line: token('--color-accent'),
    lineBright: token('--color-accent-strong'),
    core: token('--color-highlight'),
    hot: token('--color-text'),
    earth: token('--color-text-muted'),
    seal: token('--color-seal-strong'),
    sealDeep: token('--color-seal'),
    stone: token('--color-surface-raised'),
  };
  // 各種顆粒的顏色：依 tone（0–1）在這幾個裡面挑。
  const palettes: Record<ParticleKind, string[]> = {
    dust: [colors.earth, colors.earth, colors.line, colors.lineBright, colors.earth],
    debris: [colors.stone, colors.earth, colors.line, colors.stone],
    chips: [colors.sealDeep, colors.seal, colors.lineBright, colors.line, colors.sealDeep],
    sparks: [colors.core, colors.lineBright, colors.seal, colors.hot],
  };

  let width = 0;
  let height = 0;
  let ratio = 1;
  let impact = { x: 0, y: 0, radius: 100, seed: 7 };
  let ground: Ground | undefined;
  let cracks: Crack[] = [];
  let shards: { at: Point; size: number; angle: number }[] = [];
  let crackProgress = 0;
  let crackAlpha = 0;
  /** 裂縫裡的光：1 是剛裂開（亮金），0 是冷下來的刻線。 */
  let heat = 0;
  let fade: { from: number; to: number; heat: number; start: number; ms: number } | null = null;
  const live: Record<ParticleKind, Particle[]> = { dust: [], debris: [], chips: [], sparks: [] };
  let drift: Drift[] = [];
  let raf = 0;
  let last = 0;
  let onScreen = true;
  let disposed = false;
  let reach = 0;

  const size = () => {
    const rect = canvas.getBoundingClientRect();
    ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  };

  const count = () => KINDS.reduce((sum, kind) => sum + live[kind].length, 0);

  const report = () => {
    const shown = crackProgress > 0 && crackAlpha > 0;
    canvas.dataset.impactCracks = String(shown ? cracks.filter((crack) => crack.main).length : 0);
    canvas.dataset.impactReach = (shown ? Math.min(2, reach) : 0).toFixed(2);
    canvas.dataset.impactParticles = String(count());
  };

  /** 裂紋上的一點 → 畫布上的位置與那裡的放大倍率（透視）。 */
  const place = (point: Point): { x: number; y: number; scale: number } => {
    if (!ground) return { x: impact.x + point.x, y: impact.y + point.y, scale: 1 };
    const projected = projectGround(point, ground);
    const away = Math.max(-ground.depth * NEAREST, -point.y);
    return { x: impact.x + projected.x, y: impact.y + projected.y, scale: Math.min(2.4, ground.depth / (ground.depth + away)) };
  };

  /**
   * 一條裂線畫成由粗到細的帶子（尖端收成一點）：先投影到畫面上，再依「沿線比例 × 那裡的透視倍率」決定寬度。
   * widthScale 讓同一條線可以畫成外層的光、本體、裡面的芯。
   */
  const fillCrack = (points: Point[], total: number, base: number, widthScale: number, color: string, alpha: number) => {
    if (points.length < 2 || alpha <= 0) return;
    const placed = points.map(place);
    // 每一點在原裂線上走了多遠（決定粗細），只露出前段時尖端也照樣收細。
    const along: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      along.push(along[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
    }
    const shown = along[along.length - 1]! || 1;
    const widths = placed.map((p, i) => {
      const t = total > 0 ? along[i]! / total : 0;
      // 露出到哪裡，哪裡就是尖端：剛裂開時前端也是尖的。
      const tip = Math.min(1, (along[i]! / shown) * 1.0);
      return crackWidth(Math.max(t, tip * tip), base) * p.scale * widthScale;
    });
    // crackRibbon 依「畫面上走了多遠的比例」問寬度：換回是第幾個點（同一套比例）。
    const screen: number[] = [0];
    for (let i = 1; i < placed.length; i++) {
      screen.push(screen[i - 1]! + Math.hypot(placed[i]!.x - placed[i - 1]!.x, placed[i]!.y - placed[i - 1]!.y));
    }
    const span = screen[screen.length - 1]! || 1;
    const ribbon = crackRibbon(placed, (t) => {
      let best = 0;
      for (let i = 1; i < screen.length; i++) if (Math.abs(screen[i]! / span - t) < Math.abs(screen[best]! / span - t)) best = i;
      return widths[best]!;
    });
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ribbon[0]!.x, ribbon[0]!.y);
    for (let i = 1; i < ribbon.length; i++) ctx.lineTo(ribbon[i]!.x, ribbon[i]!.y);
    ctx.closePath();
    ctx.fill();
    for (const p of placed) reach = Math.max(reach, Math.abs(p.x - impact.x) / (width / 2));
  };

  /** 碎片：主裂線根部附近崩起來的幾小片地面（暗色的片，邊上一點金）。 */
  const drawShards = (alpha: number) => {
    if (alpha <= 0) return;
    for (const shard of shards) {
      const centre = place(shard.at);
      const s = shard.size * centre.scale;
      ctx.save();
      ctx.translate(centre.x, centre.y);
      ctx.rotate(shard.angle);
      ctx.beginPath();
      ctx.moveTo(-s, -s * 0.35);
      ctx.lineTo(s * 0.7, -s * 0.5);
      ctx.lineTo(s, s * 0.25);
      ctx.lineTo(-s * 0.4, s * 0.45);
      ctx.closePath();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colors.stone;
      ctx.fill();
      ctx.globalAlpha = alpha * (0.45 + heat * 0.55);
      ctx.strokeStyle = heat > 0.05 ? colors.lineBright : colors.line;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  };

  const draw = () => {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    reach = 0;

    // 裂紋：尺規刻出來的折線，由粗到細的帶子。剛裂開時裂縫裡是亮金的光（外層一圈低透明的光、本體亮金、芯近白），
    // 冷下來就只剩細細的一道暗金刻線。
    if (crackProgress > 0 && crackAlpha > 0) {
      for (const crack of cracks) {
        // 支裂比主裂線晚一點才出現。
        const progress = crack.main ? crackProgress : Math.max(0, (crackProgress - 0.4) / 0.6);
        const points = revealCrack(crack, progress);
        if (points.length < 2) continue;
        let total = 0;
        for (let i = 1; i < crack.points.length; i++) {
          total += Math.hypot(crack.points[i]!.x - crack.points[i - 1]!.x, crack.points[i]!.y - crack.points[i - 1]!.y);
        }
        const base = (crack.main ? 3.4 : 1.8) + heat * (crack.main ? 1.6 : 0.8);
        const weight = crackAlpha * (crack.main ? 1 : 0.8);
        if (heat > 0.05) {
          // 裂縫裡透出來的光：只貼著裂線（約兩倍寬、很淡），不是光帶。
          fillCrack(points, total, base, 2, colors.lineBright, weight * heat * 0.12);
        }
        fillCrack(points, total, base, 1, heat > 0.05 ? colors.lineBright : colors.line, weight);
        if (heat > 0.05) {
          // 芯：細、只在剛裂開的那一下亮（白芯更細更短）。
          fillCrack(points, total, base, 0.32, colors.core, weight * heat * 0.8);
          if (crack.main) fillCrack(points, total, base, 0.1, colors.hot, weight * heat * heat * 0.6);
        }
      }
      drawShards(crackAlpha * Math.min(1, crackProgress * 2));
    }

    // 慢飄的塵粒。
    ctx.fillStyle = colors.lineBright;
    for (const speck of drift) {
      ctx.globalAlpha = speck.alpha;
      ctx.fillRect(speck.x, speck.y, speck.size, speck.size);
    }

    // 顆粒：一顆一顆的；碎石與漆片是會翻的片，塵土帶一點運動模糊（順著速度拉長）、近的比較大。
    for (const kind of KINDS) {
      const palette = palettes[kind];
      for (const particle of live[kind]) {
        const lifeRatio = particle.life / particle.maxLife;
        ctx.globalAlpha = Math.min(1, lifeRatio * (kind === 'dust' ? 1.2 : 1.6));
        ctx.fillStyle = palette[Math.min(palette.length - 1, Math.floor(particle.tone * palette.length))]!;
        if (kind === 'chips' || kind === 'debris') {
          ctx.save();
          ctx.translate(particle.x, particle.y);
          ctx.rotate(particle.angle);
          // 翻面時看起來變窄。
          const flip = Math.abs(Math.cos(particle.angle * 1.7));
          const wide = kind === 'chips' ? 2 : 1.3;
          ctx.fillRect(-particle.size * (wide / 2), -particle.size * 0.45 * flip, particle.size * wide, particle.size * 0.9 * flip + 0.5);
          ctx.restore();
        } else if (kind === 'dust') {
          // 一顆一顆的塵土（近的已經比較大顆），順著速度拖一段淡的殘跡（運動模糊）。
          const s = particle.size;
          const speed = Math.hypot(particle.vx, particle.vy);
          const streak = Math.min(34, speed * 26 * (0.6 + s * 0.15));
          if (streak > 1.5) {
            const ux = particle.vx / speed;
            const uy = particle.vy / speed;
            const alpha = ctx.globalAlpha;
            ctx.globalAlpha = alpha * 0.32;
            ctx.lineWidth = s * 0.8;
            ctx.strokeStyle = ctx.fillStyle;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(particle.x, particle.y);
            ctx.lineTo(particle.x - ux * streak, particle.y - uy * streak);
            ctx.stroke();
            ctx.globalAlpha = alpha;
          }
          // 圓的一顆（不是方塊）。
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, s / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
        }
      }
    }
    ctx.globalAlpha = 1;
  };

  const busy = () => count() > 0 || drift.length > 0 || fade !== null;

  const frame = (now: number) => {
    raf = 0;
    if (disposed) return;
    const dt = last ? Math.min(64, Math.max(0, now - last)) : 16;
    last = now;

    for (const kind of KINDS) {
      if (live[kind].length > 0) live[kind] = stepParticles(live[kind], dt, PHYSICS[kind]);
    }
    for (const speck of drift) {
      speck.x += speck.vx * dt;
      speck.y += speck.vy * dt;
      if (speck.y < -4) speck.y = height + 4;
      if (speck.x > width + 4) speck.x = -4;
      if (speck.x < -4) speck.x = width + 4;
    }
    if (fade) {
      const t = Math.min(1, (now - fade.start) / fade.ms);
      crackAlpha = fade.from + (fade.to - fade.from) * t;
      // 光比濃度暗得快。
      heat = fade.heat * Math.pow(1 - t, 2.4);
      if (t >= 1) {
        fade = null;
        heat = 0;
      }
    }
    draw();
    report();
    if (busy() && onScreen) raf = requestAnimationFrame(frame);
    else last = 0;
  };

  const wake = () => {
    if (!raf && !disposed && onScreen) raf = requestAnimationFrame(frame);
  };

  size();
  const resizeObserver = new ResizeObserver(() => {
    size();
    draw();
  });
  resizeObserver.observe(canvas);
  const intersection = new IntersectionObserver((entries) => {
    onScreen = entries.some((entry) => entry.isIntersecting);
    if (onScreen && busy()) wake();
  });
  intersection.observe(canvas);
  report();

  return {
    setImpact(x, y, radius, seed = 7, onGround) {
      if (radius !== impact.radius || seed !== impact.seed || cracks.length === 0) {
        cracks = generateCracks({ seed, radius });
        // 碎片：每條主裂線根部附近兩三片（位置跟著種子，每次一樣）。
        shards = [];
        let k = seed * 7.13;
        const next = () => {
          k = (k * 9301 + 49297) % 233280;
          return k / 233280;
        };
        for (const crack of cracks) {
          if (!crack.main) continue;
          const heading = Math.atan2(crack.points[1]!.y, crack.points[1]!.x);
          for (let n = 0; n < 3; n++) {
            const distance = radius * (0.02 + next() * 0.09);
            const side = (next() - 0.5) * 0.7;
            shards.push({
              at: { x: Math.cos(heading + side) * distance, y: Math.sin(heading + side) * distance },
              size: 2 + next() * 4,
              angle: next() * Math.PI,
            });
          }
        }
      }
      impact = { x, y, radius, seed };
      ground = onGround;
    },
    setCracks(progress, alpha, fresh = false) {
      crackProgress = progress;
      crackAlpha = alpha;
      heat = fresh ? 1 : 0;
      fade = null;
      draw();
      report();
    },
    fadeCracks(alpha, ms) {
      fade = { from: crackAlpha, to: alpha, heat, start: performance.now(), ms };
      wake();
    },
    emit(particles, x, y, kind) {
      for (const particle of particles) live[kind].push({ ...particle, x: particle.x + x, y: particle.y + y });
      report();
      wake();
    },
    setDrift(amount) {
      // 固定的偽亂數：每次進站塵粒的位置都一樣。
      drift = Array.from({ length: amount }, (_, i) => {
        const a = Math.sin(i * 12.9898) * 43758.5453;
        const b = Math.sin(i * 78.233) * 12543.123;
        const u = a - Math.floor(a);
        const v = b - Math.floor(b);
        return {
          x: u * width,
          y: v * height,
          vx: 0.004 + u * 0.006,
          vy: -(0.003 + v * 0.008),
          size: 1 + ((i * 7) % 3) * 0.5,
          alpha: 0.12 + v * 0.26,
        };
      });
      draw();
      wake();
    },
    redraw() {
      draw();
      report();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
    },
  };
}

/**
 * 整個「視窗」一起動的那幾塊：固定外框，以及頁首裡的獅徽與導覽連結。加上當下的主要區塊，看起來就是整個視窗在動。
 * 不直接動頁首本身：transform 會讓它變成裡面 position: fixed 元素的定位基準，桌機釘在下緣的「預約體驗」會跳上來。
 * 同理也不動「預約體驗」那顆（它自己就是 fixed）。
 */
export function chromeElements(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('.frame, .frame-foot, .site-header a:not([data-line-open]), .site-header button'),
  );
}

/** 讓一組元素播同一段位移（Web Animations；只動 transform）。 */
export function playOffsets(elements: Iterable<Element | null | undefined>, keyframes: Keyframe[], durationMs: number): void {
  for (const element of elements) {
    if (!element || typeof element.animate !== 'function') continue;
    element.animate(keyframes, { duration: durationMs, easing: 'linear' });
  }
}
