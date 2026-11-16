// 視窗的下沉（震腳）與橫撞（貼山靠）。只是一下有頓挫的位移，幅度小、不閃爍。純函式，單位 px 與 ms。

/** 下沉的上限：再怎麼給都不超過這個幅度。 */
export const SINK_MAX = 10;
export const SINK_MS = 420;

/**
 * 震腳的垂直位移：先快速往下沉到最深，再帶阻尼地回彈（稍微彈過頭往上），最後回原位。正值是往下。
 */
export function sinkOffset(elapsedMs: number, amplitude = 8): number {
  if (!(elapsedMs > 0) || elapsedMs >= SINK_MS) return 0;
  const depth = Math.min(Math.abs(amplitude), SINK_MAX);
  const t = elapsedMs / SINK_MS;
  // 0–0.14：砸下去；之後是衰減的餘震。
  if (t < 0.14) return depth * Math.sin((t / 0.14) * (Math.PI / 2));
  const k = (t - 0.14) / 0.86;
  const value = depth * Math.exp(-4.2 * k) * Math.cos(k * Math.PI * 2.5) * (1 - k);
  return Math.abs(value) < 0.01 ? 0 : value;
}

/** 下沉時配合的輕微縮放：1.0 → 約 1.015 → 1.0（像鏡頭被震得往前一頓）。 */
export function sinkScale(elapsedMs: number): number {
  if (!(elapsedMs > 0) || elapsedMs >= SINK_MS) return 1;
  const t = elapsedMs / SINK_MS;
  const bump = t < 0.14 ? Math.sin((t / 0.14) * (Math.PI / 2)) : Math.pow(1 - (t - 0.14) / 0.86, 2.2);
  return 1 + 0.015 * bump;
}

export const SHOVE_MS = 560;

/** 貼山靠的橫向位移：被撞開（負值是往左），再彈回來晃兩下。 */
export function shoveOffset(elapsedMs: number, distance = 26): number {
  if (!(elapsedMs > 0) || elapsedMs >= SHOVE_MS) return 0;
  const reach = Math.min(Math.abs(distance), 40);
  const t = elapsedMs / SHOVE_MS;
  if (t < 0.1) return -reach * Math.sin((t / 0.1) * (Math.PI / 2));
  const k = (t - 0.1) / 0.9;
  const value = -reach * Math.exp(-3.6 * k) * Math.cos(k * Math.PI * 3) * (1 - k);
  return Math.abs(value) < 0.01 ? 0 : value;
}

/** 把位移函式取樣成 Web Animations 的關鍵影格（每 20ms 一格）。 */
export function sampleOffsets(
  offset: (t: number) => number,
  durationMs: number,
  axis: 'x' | 'y',
  scale?: (t: number) => number,
): Keyframe[] {
  const frames: Keyframe[] = [];
  const steps = Math.ceil(durationMs / 20);
  for (let i = 0; i <= steps; i++) {
    const at = (durationMs * i) / steps;
    const value = offset(at);
    const move = axis === 'y' ? `translate3d(0, ${value.toFixed(2)}px, 0)` : `translate3d(${value.toFixed(2)}px, 0, 0)`;
    frames.push({ transform: scale ? `${move} scale(${scale(at).toFixed(4)})` : move });
  }
  return frames;
}
