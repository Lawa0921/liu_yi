// 顆粒：塵土、金屑、漆片、火星。一律是一顆一顆的顆粒（小方塊／碎片），不是暈開的墨。純函式；
// 座標以發射點為原點（px），速度 px/ms，時間 ms。

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 剩餘壽命與原本的壽命（ms）。 */
  life: number;
  maxLife: number;
  /** 邊長（px）。 */
  size: number;
  /** 碎片的翻轉：目前角度與角速度（rad/ms）。 */
  angle: number;
  spin: number;
  /** 0–1：畫的時候依它在幾個顏色之間取（例如塵土 → 金屑）。 */
  tone: number;
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 塵浪：一圈顆粒由落點往外推。squash 把垂直方向壓扁（貼著地面散開）。 */
export function spawnDustRing(options: { count: number; seed: number; speed: number; squash?: number; life?: number }): Particle[] {
  const { count, seed, speed, squash = 1, life = 900 } = options;
  const random = seeded(seed);
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + random() * 0.3;
    const pace = speed * (0.35 + random() * 0.9);
    const start = 6 + random() * 22;
    const own = life * (0.5 + random() * 0.7);
    return {
      x: Math.cos(angle) * start,
      y: Math.sin(angle) * start * squash,
      vx: Math.cos(angle) * pace,
      vy: Math.sin(angle) * pace * squash,
      life: own,
      maxLife: own,
      size: 1 + random() * 2.4,
      angle: 0,
      spin: 0,
      tone: random(),
    };
  });
}

/** 漆片與金屑：朝 direction（弧度）噴出去的碎片，會翻轉。 */
export function burstChips(options: { count: number; seed: number; direction: number; speed: number; spread?: number; life?: number }): Particle[] {
  const { count, seed, direction, speed, spread = 1.1, life = 800 } = options;
  const random = seeded(seed);
  return Array.from({ length: count }, () => {
    const angle = direction + (random() - 0.5) * spread;
    const pace = speed * (0.3 + random());
    const own = life * (0.5 + random() * 0.6);
    return {
      x: (random() - 0.5) * 10,
      y: (random() - 0.5) * 40,
      vx: Math.cos(angle) * pace,
      vy: Math.sin(angle) * pace - 0.12 * random(),
      life: own,
      maxLife: own,
      size: 1.5 + random() * 3,
      angle: random() * Math.PI,
      spin: (random() - 0.5) * 0.03 || 0.004,
      tone: random(),
    };
  });
}

/** 走一步：阻力（指數衰減）、重力、壽命。死掉的移除。 */
export function stepParticles(particles: Particle[], dtMs: number, options: { drag: number; gravity: number }): Particle[] {
  if (!(dtMs > 0)) return particles;
  const { drag, gravity } = options;
  const decay = Math.exp(-drag * dtMs);
  // 速度衰減下走過的距離（閉合式：一格再久也不會爆）。
  const travel = drag > 0 ? (1 - decay) / drag : dtMs;
  const next: Particle[] = [];
  for (const particle of particles) {
    const life = particle.life - dtMs;
    if (life <= 0) continue;
    const fall = gravity * Math.min(dtMs, 400);
    next.push({
      ...particle,
      x: particle.x + particle.vx * travel,
      y: particle.y + particle.vy * travel + (fall * Math.min(dtMs, 400)) / 2,
      vx: particle.vx * decay,
      vy: particle.vy * decay + fall,
      life,
      angle: particle.angle + particle.spin * Math.min(dtMs, 400),
    });
  }
  return next;
}

/** 落點揚起的碎石與土粒：往上噴（帶一點左右），再被重力拉下來；有大有小，會翻。 */
export function spawnDebris(options: { count: number; seed: number; speed: number; life?: number }): Particle[] {
  const { count, seed, speed, life = 900 } = options;
  const random = seeded(seed);
  return Array.from({ length: count }, () => {
    const lean = (random() - 0.5) * 1.5;
    const pace = speed * (0.35 + random());
    const own = life * (0.55 + random() * 0.6);
    return {
      x: (random() - 0.5) * 60,
      y: (random() - 0.5) * 8,
      vx: Math.sin(lean) * pace,
      vy: -Math.cos(lean) * pace,
      life: own,
      maxLife: own,
      size: 1.2 + Math.pow(random(), 2) * 5,
      angle: random() * Math.PI,
      spin: (random() - 0.5) * 0.03 || 0.005,
      tone: random(),
    };
  });
}

/**
 * 貼地的塵牆：落點往四周推出去的一圈塵土，但被地面壓扁（垂直速度很小），看起來是沿著地面滾出去的一道牆。
 * 往觀者這邊（vy > 0）的顆粒比往遠處的大——近大遠小；畫的時候再順著速度拉長（運動模糊）。
 */
export function spawnDustWall(options: { count: number; seed: number; speed: number; life?: number }): Particle[] {
  const { count, seed, speed, life = 1300 } = options;
  const random = seeded(seed);
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + (random() - 0.5) * 0.4;
    // 側面推得最快，往前後的慢一點（透視裡前後本來就短）。
    const side = Math.abs(Math.cos(angle));
    const pace = speed * (0.45 + random() * 0.75) * (0.55 + 0.45 * side);
    const toward = Math.sin(angle);
    const near = 1 + Math.max(0, toward) * 2.2 - Math.max(0, -toward) * 0.45;
    const own = life * (0.55 + random() * 0.6);
    return {
      x: Math.cos(angle) * (4 + random() * 14),
      y: toward * (2 + random() * 4),
      vx: Math.cos(angle) * pace,
      // 往前後的分量壓得很扁；再帶一點往上捲的量，塵牆才有高度。
      vy: toward * pace * 0.16 - pace * 0.05 * random(),
      life: own,
      maxLife: own,
      size: (1 + random() * 1.8) * near,
      angle: 0,
      spin: 0,
      tone: random(),
    };
  });
}
