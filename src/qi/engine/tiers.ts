/**
 * 光點數分級與自動降級（D16，純邏輯）。
 *
 *   high 256² / mid 192² / low 144² / min 112²。桌機（寬 ≥ 960 且非觸控）起於 high，其餘起於 low。
 *   調速器：暖機 2 秒後，連續兩個 1 秒視窗的平均 fps 都 < 40 就降一級，降級後冷卻 3 秒；降級（重建 GPGPU）由呼叫端做。
 */

export type TierId = 'high' | 'mid' | 'low' | 'min';

/** 由高到低。 */
export const TIER_ORDER: readonly TierId[] = ['high', 'mid', 'low', 'min'];

export const TIERS: Record<TierId, { side: number; count: number; glow: boolean }> = {
  high: { side: 256, count: 256 * 256, glow: true },
  mid: { side: 192, count: 192 * 192, glow: true },
  low: { side: 144, count: 144 * 144, glow: false },
  min: { side: 112, count: 112 * 112, glow: false },
};

/** 桌機判定的最小寬度。 */
const DESKTOP_MIN_WIDTH = 960;

/** `override`（`?qi-tier=`）只認 `TIERS` 自己的鍵；其餘（含 `constructor` 這類原型鏈名稱）一律忽略。 */
const isTier = (value: string | null | undefined): value is TierId =>
  typeof value === 'string' && Object.hasOwn(TIERS, value);

export function initialTier(env: { touch: boolean; width: number; override?: string | null }): TierId {
  if (isTier(env.override)) return env.override;
  return !env.touch && env.width >= DESKTOP_MIN_WIDTH ? 'high' : 'low';
}

export interface GovernorOptions {
  start: TierId;
  /** 低於這個 fps 的視窗算一次「差」。預設 40。 */
  floorFps?: number;
  /** 視窗長度（ms），同時是「單格間隔超過就當作分頁被切走」的門檻。預設 1000。 */
  windowMs?: number;
  /** 連續幾個差視窗才降一級。預設 2。 */
  strikes?: number;
  /** 第一格之後的暖機時間（ms），期間不計。預設 2000。 */
  graceMs?: number;
  /** 降級後的冷卻（ms），期間不計。預設 3000。 */
  cooldownMs?: number;
}

export interface Governor {
  /** 每畫一格呼叫一次（傳入 `performance.now()`）。回新的 tier 表示該降級了，否則 `null`。 */
  frame(nowMs: number): TierId | null;
  tier(): TierId;
}

export function createGovernor(opts: GovernorOptions): Governor {
  const floorFps = opts.floorFps ?? 40;
  const windowMs = opts.windowMs ?? 1000;
  const needed = opts.strikes ?? 2;
  const graceMs = opts.graceMs ?? 2000;
  const cooldownMs = opts.cooldownMs ?? 3000;

  let level = TIER_ORDER.indexOf(opts.start);
  let startedAt: number | null = null; // 第一格的時間，暖機從這裡起算
  let lastNow = 0;
  let cooldownUntil = -Infinity;
  let windowStart: number | null = null;
  let windowFrames = 0;
  let strikes = 0;

  return {
    tier: () => TIER_ORDER[level]!,
    frame(now) {
      if (level >= TIER_ORDER.length - 1) return null; // 已在最低一級
      if (startedAt === null) {
        startedAt = now;
        lastNow = now;
      }
      const dt = now - lastNow;
      lastNow = now;
      // 分頁被切走（間隔 > 一個視窗）或時間倒退：視窗作廢，也打斷「連續」
      const gap = dt < 0 || dt > windowMs;
      if (gap) strikes = 0;

      if (now - startedAt < graceMs || now < cooldownUntil) {
        windowStart = null;
        return null;
      }
      if (gap || windowStart === null) {
        windowStart = now;
        windowFrames = 0;
        return null;
      }

      windowFrames++;
      const elapsed = now - windowStart;
      if (elapsed < windowMs) return null;

      const fps = (windowFrames / elapsed) * 1000;
      windowStart = now;
      windowFrames = 0;
      if (fps >= floorFps) {
        strikes = 0;
        return null;
      }
      strikes++;
      if (strikes < needed) return null;

      strikes = 0;
      level++;
      cooldownUntil = now + cooldownMs;
      return TIER_ORDER[level]!;
    },
  };
}
