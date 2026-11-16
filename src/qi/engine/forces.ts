/**
 * 力場參數（搬自試作 `src/lab/qi/main.ts` 的 `frame()`，純函式）：
 * 由「散開量、捲動速度、距上次衝量多久、是否落地 snap、開場彈簧倍率」算出這一格的彈簧、旋渦與阻尼。
 */

/** 彈簧基準強度（把光點拉回目標形體）。 */
export const SPRING = 26;

const smoothstep = (a: number, b: number, x: number): number => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export interface ForceInput {
  /** 有效散開量 0–1：`max(捲動 scatter, switchScatter(...))`。 */
  scatter: number;
  /** 捲動速度（視窗高／秒，已平滑）。最多算到 3。 */
  scrollSpeed: number;
  /** 距上一次換招衝量的秒數。 */
  sinceBurst: number;
  /** 衝量的彈簧鬆開時間尺度（`Burst.hold`，預設 1）；0＝不鬆。 */
  burstHold: number;
  /** 落地「啪」一下就定住：彈簧 ×2.2。 */
  snap: boolean;
  /** 開場進行中才傳（`introState().springScale`）。 */
  intro?: { springScale: number };
}

export function forcesFor(i: ForceInput): { spring: number; curl: number; damp: number } {
  const scatter = clamp(i.scatter, 0, 1);
  let spring = SPRING * (i.intro?.springScale ?? 1);
  // 捲動中途鬆開、停下時聚合
  spring *= 1 - 0.82 * scatter;
  // 換招衝量：先鬆彈簧讓光點飛得出去，再慢慢聚回
  if (i.burstHold > 0) spring *= 0.1 + 0.9 * smoothstep(0.25 * i.burstHold, 1.2 * i.burstHold, i.sinceBurst);
  if (i.snap) spring *= 2.2;
  const curl = 0.32 + scatter * 1.3 + clamp(i.scrollSpeed, 0, 3) * 0.35;
  // 開場彈簧還沒回滿（散開與吸氣）時阻尼放輕，光點才飄得開、吸得進來
  const damp = i.intro && i.intro.springScale < 1 ? 3 : 5.5;
  return { spring, curl, damp };
}

/** 切換大人／小孩時的散開量：一切換就全散，900 ms 線性收回。 */
export function switchScatter(sinceSwitchMs: number): number {
  return clamp(1 - sinceSwitchMs / 900, 0, 1);
}
