// 拖曳轉動：拖的時候角度跟著手走，放手後帶著慣性再轉一段，然後緩緩回正（或回到固定的自轉速度）。純函式。
// 角度單位弧度、時間毫秒、速度弧度／毫秒。

export interface SpinState {
  angle: number;
  velocity: number;
  dragging: boolean;
}

export interface SpinOptions {
  /** 回正的目標角度；給了就會回到「最近的」那個等價角度（差整數圈）。 */
  home?: number;
  /** 自轉速度；給了就不回正，放手後速度漸漸回到這個值。 */
  cruise?: number;
}

/** 每拖 1px 轉多少弧度。 */
export const DRAG_SENSITIVITY = 0.008;
/** 放手後慣性的衰減（每毫秒的指數係數）：約 0.5 秒剩三分之一。 */
const FRICTION = 0.0022;
/** 回正彈簧：臨界阻尼，約 1.5 秒到位。 */
const RETURN_STIFFNESS = 0.000012;
/** 放手的速度上限，免得一甩轉太多圈。 */
const MAX_VELOCITY = 0.02;
/** 積分的最大步長（毫秒）；一格拖很久就拆成多步，不會爆衝。 */
const MAX_STEP = 16;
const TAU = Math.PI * 2;

export function createSpin(angle = 0): SpinState {
  return { angle, velocity: 0, dragging: false };
}

export function grabSpin(state: SpinState): SpinState {
  return { angle: state.angle, velocity: 0, dragging: true };
}

/** 拖曳中的一次位移（px）與它花的時間；速度取近幾次的平滑值，放手時當作慣性。 */
export function dragSpin(state: SpinState, deltaPx: number, dtMs: number): SpinState {
  const delta = deltaPx * DRAG_SENSITIVITY;
  const instant = dtMs > 0 ? delta / dtMs : 0;
  const velocity = state.velocity * 0.4 + instant * 0.6;
  return { angle: state.angle + delta, velocity, dragging: true };
}

export function releaseSpin(state: SpinState, options: { keepMomentum?: boolean } = {}): SpinState {
  const keep = options.keepMomentum ?? true;
  const velocity = keep ? Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, state.velocity)) : 0;
  return { angle: state.angle, velocity, dragging: false };
}

function nearestHome(angle: number, home: number): number {
  return home + Math.round((angle - home) / TAU) * TAU;
}

export function stepSpin(state: SpinState, dtMs: number, options: SpinOptions = {}): SpinState {
  if (state.dragging || !(dtMs > 0)) return state;
  const { home, cruise } = options;
  if (home === undefined && cruise === undefined && state.velocity === 0) return state;

  let { angle, velocity } = state;
  // 掉幀時最多補算 2 秒，其餘直接略過（補太多沒有意義）。
  let remaining = Math.min(dtMs, 2000);
  while (remaining > 0) {
    const dt = Math.min(MAX_STEP, remaining);
    remaining -= dt;
    if (cruise !== undefined) {
      velocity = cruise + (velocity - cruise) * Math.exp(-FRICTION * dt);
    } else if (home !== undefined) {
      // 臨界阻尼彈簧：阻尼 = 2·√k。
      const target = nearestHome(angle, home);
      const damping = 2 * Math.sqrt(RETURN_STIFFNESS);
      velocity += (-RETURN_STIFFNESS * (angle - target) - damping * velocity) * dt;
    } else {
      velocity *= Math.exp(-FRICTION * dt);
    }
    angle += velocity * dt;
  }

  if (home !== undefined && cruise === undefined) {
    const target = nearestHome(angle, home);
    if (Math.abs(angle - target) < 1e-4 && Math.abs(velocity) < 1e-6) return { angle: target, velocity: 0, dragging: false };
  } else if (cruise === undefined && Math.abs(velocity) < 1e-6) {
    velocity = 0;
  }
  return { angle, velocity, dragging: false };
}
