// 刀光軌跡：取樣、衰減、帶狀外形。純函式；繪製在 src/scripts/slash.ts（設計文件 §15.2-2）。
// 座標是視窗像素，時間毫秒。

export interface TrailPoint {
  x: number;
  y: number;
  t: number;
  /** 這一點是新的一刀的起點（不和前一點相連）。 */
  start?: boolean;
}

export interface Trail {
  points: TrailPoint[];
  /** 上一個原始取樣（不論有沒有成為點），用來算速度。 */
  last: TrailPoint | null;
}

/** 低於這個速度（px/ms）不算「斬」。 */
export const SLASH_MIN_SPEED = 1.1;
/** 相鄰兩點至少隔這麼遠（px），太密的略過。 */
export const SLASH_MIN_SPACING = 6;
/** 一個點從出現到消失的時間。 */
export const SLASH_LIFE_MS = 420;
export const SLASH_MAX_POINTS = 48;
/** 兩次取樣隔這麼久（ms）就當成另一刀。 */
const SLASH_GAP_MS = 120;

export function createTrail(): Trail {
  return { points: [], last: null };
}

export function addSample(trail: Trail, sample: { x: number; y: number; t: number }): Trail {
  const previous = trail.last;
  const last = { x: sample.x, y: sample.y, t: sample.t };
  if (!previous) return { points: trail.points, last };

  const dt = sample.t - previous.t;
  const distance = Math.hypot(sample.x - previous.x, sample.y - previous.y);
  if (!(dt > 0) || distance / dt < SLASH_MIN_SPEED) return { points: trail.points, last };

  const tail = trail.points.at(-1);
  const fresh = dt > SLASH_GAP_MS || !tail || sample.t - tail.t > SLASH_GAP_MS;
  if (!fresh && tail && Math.hypot(sample.x - tail.x, sample.y - tail.y) < SLASH_MIN_SPACING) {
    return { points: trail.points, last };
  }

  const point: TrailPoint = fresh ? { ...last, start: true } : last;
  const points = [...trail.points, point];
  return { points: points.length > SLASH_MAX_POINTS ? points.slice(-SLASH_MAX_POINTS) : points, last };
}

/** 一個點目前的強度：剛出現是 1，SLASH_LIFE_MS 後是 0。 */
export function pointStrength(point: TrailPoint, now: number): number {
  const age = (now - point.t) / SLASH_LIFE_MS;
  if (age <= 0) return 1;
  if (age >= 1) return 0;
  // 先慢後快地淡出。
  return 1 - age * age;
}

export function pruneTrail(trail: Trail, now: number): Trail {
  const points = trail.points.filter((point) => pointStrength(point, now) > 0);
  return points.length === trail.points.length ? trail : { points, last: trail.last };
}

export interface Ribbon {
  left: { x: number; y: number }[];
  right: { x: number; y: number }[];
  /** 整條帶目前最強的那一點的強度（畫的時候當透明度）。 */
  strength: number;
}

/** 把軌跡切成一刀一刀，各自展成兩端收尖的帶狀多邊形。 */
export function trailRibbon(trail: Trail, now: number, maxWidth: number): Ribbon[] {
  const strokes: TrailPoint[][] = [];
  for (const point of trail.points) {
    if (pointStrength(point, now) <= 0) continue;
    if (point.start || strokes.length === 0) strokes.push([]);
    strokes.at(-1)!.push(point);
  }

  const ribbons: Ribbon[] = [];
  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    const left: Ribbon['left'] = [];
    const right: Ribbon['right'] = [];
    let strength = 0;
    const lastIndex = stroke.length - 1;
    stroke.forEach((point, index) => {
      const before = stroke[Math.max(0, index - 1)]!;
      const after = stroke[Math.min(lastIndex, index + 1)]!;
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      const length = Math.hypot(dx, dy) || 1;
      const life = pointStrength(point, now);
      strength = Math.max(strength, life);
      // 沿著這一刀：兩端是 0，中段最寬；再乘上各點自己的餘命。
      const along = Math.sin((index / lastIndex) * Math.PI);
      const half = (maxWidth / 2) * along * life;
      const nx = (-dy / length) * half;
      const ny = (dx / length) * half;
      left.push({ x: point.x + nx, y: point.y + ny });
      right.push({ x: point.x - nx, y: point.y - ny });
    });
    ribbons.push({ left, right, strength });
  }
  return ribbons;
}

/** 幕與幕之間的轉場：一道由上往下、橫跨整個畫面的斜向刀光（direction 1 往右劈，-1 往左劈）。 */
export function diagonalCut(options: {
  width: number;
  height: number;
  direction: 1 | -1;
  t: number;
  durationMs: number;
}): TrailPoint[] {
  const { width, height, direction, t, durationMs } = options;
  const steps = 14;
  const overshoot = width * 0.06;
  const fromX = direction === 1 ? -overshoot : width + overshoot;
  const toX = direction === 1 ? width + overshoot : -overshoot;
  const fromY = height * 0.16;
  const toY = height * 0.84;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const k = i / steps;
    const point: TrailPoint = { x: fromX + (toX - fromX) * k, y: fromY + (toY - fromY) * k, t: t + durationMs * k };
    if (i === 0) point.start = true;
    return point;
  });
}
