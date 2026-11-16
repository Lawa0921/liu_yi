// 裂紋：以落點為圓心向八方裂開（八極的「八方」）。八條主裂線各朝一個方位，是尺規刻出來的折線——
// 幾段直線帶折角，不是曲線、不是墨暈，也不含任何卦象。純函式；座標以落點為原點、單位 px。

export interface Point {
  x: number;
  y: number;
}

export interface Crack {
  /** 八條主裂線之一；否則是岔出去的短支裂。 */
  main: boolean;
  points: Point[];
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

export function generateCracks(options: { seed: number; radius: number }): Crack[] {
  const { seed, radius } = options;
  const random = seeded(seed);
  const cracks: Crack[] = [];

  for (let i = 0; i < 8; i++) {
    const heading = (i * Math.PI) / 4;
    const segments = 4 + Math.floor(random() * 3);
    const reach = radius * (0.86 + random() * 0.16);
    const points: Point[] = [{ x: 0, y: 0 }];
    for (let s = 1; s <= segments; s++) {
      const distance = (reach * s) / segments;
      // 每一段偏一點角度（折角），越往外偏得越少，最後收回正方位。
      const wobble = s === segments ? (random() - 0.5) * 0.06 : (random() - 0.5) * 0.3 * (1 - s / (segments + 1));
      points.push({ x: Math.cos(heading + wobble) * distance, y: Math.sin(heading + wobble) * distance });
    }
    cracks.push({ main: true, points });

    // 支裂：從主裂線中段的折點岔出去一小段。
    for (let n = 0; n < 2; n++) {
      if (n === 1 && random() < 0.35) continue;
      const from = points[1 + Math.floor(random() * (segments - 1))]!;
      const side = random() < 0.5 ? -1 : 1;
      const angle = heading + side * (0.5 + random() * 0.5);
      const length = radius * (0.1 + random() * 0.16);
      const middle = { x: from.x + Math.cos(angle) * length * 0.55, y: from.y + Math.sin(angle) * length * 0.55 };
      const bend = angle - side * 0.35;
      cracks.push({
        main: false,
        points: [from, middle, { x: middle.x + Math.cos(bend) * length * 0.45, y: middle.y + Math.sin(bend) * length * 0.45 }],
      });
    }
  }
  return cracks;
}

export function crackLength(crack: Crack): number {
  let total = 0;
  for (let i = 1; i < crack.points.length; i++) {
    total += Math.hypot(crack.points[i]!.x - crack.points[i - 1]!.x, crack.points[i]!.y - crack.points[i - 1]!.y);
  }
  return total;
}

/** 依進度（0–1）只露出裂紋前面那一段。 */
export function revealCrack(crack: Crack, progress: number): Point[] {
  if (!(progress > 0)) return [];
  if (progress >= 1) return crack.points;
  let remaining = crackLength(crack) * progress;
  const shown: Point[] = [crack.points[0]!];
  for (let i = 1; i < crack.points.length; i++) {
    const a = crack.points[i - 1]!;
    const b = crack.points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length >= remaining) {
      const t = length === 0 ? 0 : remaining / length;
      shown.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      return shown;
    }
    shown.push(b);
    remaining -= length;
  }
  return shown;
}

/**
 * 把地面上的裂紋投影到畫面上（低機位的透視）。裂紋的座標以落點為原點：x 橫向、y 往觀者（正）或往遠處（負）。
 *   rise  落點在地平線下方多少 px（畫面上）
 *   depth 透視的強度：越小，遠近的差別越大
 * 往遠處的收向地平線（不會越過）；往近處的越來越大，衝向畫面下緣與兩側。
 */
/** 往觀者最多走到 depth 的幾成（再近就夾住，免得除以 0；到這裡時早已衝出畫面下緣）。 */
export const NEAREST = 0.985;

export function projectGround(point: Point, ground: { rise: number; depth: number }): Point {
  // away：往遠處走了多遠。再近也留一點距離，不會除成無限大（夾住的地方早就在畫面外）。
  const away = Math.max(-ground.depth * NEAREST, -point.y);
  const scale = ground.depth / (ground.depth + away);
  const x = point.x * scale;
  const y = ground.rise * scale - ground.rise;
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

/** 裂線的線寬：根部最粗，往尖端收細（t 是沿裂線的比例 0–1）。 */
export function crackWidth(t: number, base: number): number {
  const k = Math.max(0, Math.min(1, t));
  return base * (1 - 0.86 * Math.pow(k, 0.8));
}

/**
 * 把一條裂線畫成由粗到細的帶子：每個點往左右各推半個線寬，回傳「左側由根到尖、右側由尖到根」的多邊形。
 * width(t) 是沿裂線比例 t（0 根部–1 尖端）的線寬。尖端收成一點，看起來是裂開，不是一根管子。
 */
export function crackRibbon(points: readonly Point[], width: (t: number) => number): Point[] {
  const count = points.length;
  if (count < 2) return points.map((point) => ({ ...point }));
  const lengths = [0];
  for (let i = 1; i < count; i++) {
    lengths.push(lengths[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  }
  const total = lengths[count - 1]! || 1;
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < count; i++) {
    const before = points[Math.max(0, i - 1)]!;
    const after = points[Math.min(count - 1, i + 1)]!;
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const norm = Math.hypot(dx, dy) || 1;
    const half = width(lengths[i]! / total) / 2;
    const nx = (-dy / norm) * half;
    const ny = (dx / norm) * half;
    left.push({ x: points[i]!.x + nx, y: points[i]!.y + ny });
    right.push({ x: points[i]!.x - nx, y: points[i]!.y - ny });
  }
  return [...left, ...right.reverse()];
}
