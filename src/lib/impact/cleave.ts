// 苗刀破幅：幕與幕之間的轉場。一幅帶著下一幕單字的幅落下來蓋住畫面，一道由右上到左下的長弧劈過，
// 劈中後定格兩三幀，幅沿刀路錯成兩半滑開，露出下一幕。純函式：時間軸與刀路／兩半的幾何。

export const CLEAVE = {
  dropMs: 110,
  slashMs: 110,
  freezeMs: 50,
  partMs: 430,
  totalMs: 700,
  /** 劈開後兩半先沿刀路錯開多少（視窗高的比例）。 */
  shift: 0.07,
} as const;

export type CleavePhase = 'idle' | 'drop' | 'slash' | 'freeze' | 'part';

export function cleaveFrame(elapsedMs: number): { phase: CleavePhase; t: number } {
  const { dropMs, slashMs, freezeMs, partMs, totalMs } = CLEAVE;
  if (!(elapsedMs >= 0) || elapsedMs >= totalMs) return { phase: 'idle', t: 0 };
  if (elapsedMs < dropMs) return { phase: 'drop', t: elapsedMs / dropMs };
  if (elapsedMs < dropMs + slashMs) return { phase: 'slash', t: (elapsedMs - dropMs) / slashMs };
  if (elapsedMs < dropMs + slashMs + freezeMs) return { phase: 'freeze', t: (elapsedMs - dropMs - slashMs) / freezeMs };
  return { phase: 'part', t: Math.min(1, (elapsedMs - dropMs - slashMs - freezeMs) / partMs) };
}

export interface Point {
  x: number;
  y: number;
}

/** 刀路：由右上角外到左下角外的一道弧（苗刀的長弧，往右下鼓）。 */
export function cleavePath(width: number, height: number, steps = 16): Point[] {
  const from = { x: width * 1.02, y: height * 0.04 };
  const to = { x: -width * 0.02, y: height * 0.96 };
  // 控制點往右下偏：弧往右下鼓出去。
  const control = { x: width * 0.62, y: height * 0.78 };
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return {
      x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
    };
  });
}

/** 沿刀路把畫面分成兩半（多邊形頂點）：upper 含左上角，lower 含右下角。 */
export function cleaveClips(width: number, height: number): { upper: Point[]; lower: Point[] } {
  const path = cleavePath(width, height);
  const reversed = [...path].reverse();
  return {
    // 左上那一半：左上角 → 右上角外 → 沿刀路到左下 → 回左上。
    upper: [{ x: -width * 0.02, y: 0 }, { x: 0, y: 0 }, { x: width * 1.02, y: 0 }, ...path],
    // 右下那一半：右下角 → 左下角外 → 沿刀路回右上 → 右下。
    lower: [{ x: width * 1.02, y: height }, { x: width, y: height }, { x: -width * 0.02, y: height }, ...reversed],
  };
}

export function toClipPath(polygon: Point[]): string {
  return `polygon(${polygon.map((point) => `${point.x.toFixed(1)}px ${point.y.toFixed(1)}px`).join(', ')})`;
}

/** 兩半錯開的位移（px）：上半往右上、下半往左下，沿著刀路的方向。 */
export function cleaveShift(height: number): { upper: Point; lower: Point } {
  const distance = height * CLEAVE.shift;
  // 刀路大致由右上到左下：取 32° 的斜度。
  const angle = (32 * Math.PI) / 180;
  const x = Math.cos(angle) * distance;
  const y = Math.sin(angle) * distance;
  return { upper: { x, y: -y }, lower: { x: -x, y } };
}
