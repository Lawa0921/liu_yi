/**
 * 掌風指標（搬自試作的互動段）：把滑鼠／手指的位置投影到人物所在的平面（人物本地座標 z = 0），
 * 算出「手」這一格劃過的線段（`handA → hand`）與手的速度，速度著色器據此把光點吹開。
 *
 *   - 投影與速度平滑是純函式（`projectToPlane`、`advanceHand`），單元測試直接驗；`createPointer` 只負責收事件。
 *   - 速度上限 `HAND_SPEED_CAP`、每格以 `HAND_LERP` 貼近新值；超過 `HAND_FRESH_MS` 沒有新事件就以每秒 `HAND_DECAY` 的指數衰減，
 *     所以停手後還會再吹一下（約 0.25 秒），不是一放手就沒了。
 *   - 手指（touch）用 `touchstart`／`touchmove`（passive，不擋捲動）；滑鼠用 `pointermove`，並忽略 `pointerType === 'touch'`
 *     以免同一個手勢處理兩次。事件掛在 `window`：畫布在內容底下（`pointer-events` 到不了它）。
 *   - 座標以畫布的矩形換算成 NDC，畫布不必蓋滿視窗。
 */

import { Matrix4, Plane, Ray, Vector2, Vector3, type Camera } from 'three';

export const HAND_SPEED_CAP = 30;
export const HAND_LERP = 0.6;
export const HAND_FRESH_MS = 80;
export const HAND_DECAY = 4;
/** 手不在畫面內時的位置（遠到掌風碰不到任何光點）。 */
const OFFSCREEN = 99;

export interface HandState {
  /** 現在的手與上一格的手：這一格劃過 `handA → hand` 這條線段。 */
  hand: Vector3;
  handA: Vector3;
  /** 平滑後的速度（世界單位／秒）。 */
  vel: Vector3;
  /** 收過第一個投影點了。 */
  started: boolean;
}

export const createHandState = (): HandState => ({
  hand: new Vector3(OFFSCREEN, OFFSCREEN, 0),
  handA: new Vector3(OFFSCREEN, OFFSCREEN, 0),
  vel: new Vector3(),
  started: false,
});

const plane = new Plane(new Vector3(0, 0, 1), 0);
const ray = new Ray();
const inverse = new Matrix4();
const unprojected = new Vector3();

/**
 * 通過 NDC 點的射線與「人物本地 z = 0 平面」的交點（寫進 `out`）。`bodyWorld` 是人物群組的世界矩陣
 * （人物會隨滑鼠轉一點點，平面要跟著轉）。射線與平面平行、或交點在相機後面時回 false。
 */
export function projectToPlane(ndc: Vector2, camera: Camera, bodyWorld: Matrix4, out: Vector3): boolean {
  ray.origin.setFromMatrixPosition(camera.matrixWorld);
  unprojected.set(ndc.x, ndc.y, 0.5).unproject(camera);
  ray.direction.copy(unprojected).sub(ray.origin).normalize();
  inverse.copy(bodyWorld).invert();
  ray.applyMatrix4(inverse);
  return ray.intersectPlane(plane, out) !== null;
}

/**
 * 推進一格手的狀態。`hit` 是這一格的投影點（沒有就 null）；`fresh` ＝ 最近 `HAND_FRESH_MS` 內有新的指標事件。
 * 第一個投影點直接落位（不產生從螢幕外飛來的線段）。
 */
export function advanceHand(state: HandState, hit: Vector3 | null, dt: number, fresh: boolean): void {
  if (hit) {
    if (!state.started) {
      state.hand.copy(hit);
      state.started = true;
    }
    state.handA.copy(state.hand);
    state.hand.copy(hit);
    if (fresh) {
      const raw = hit.clone().sub(state.handA).divideScalar(Math.max(dt, 1e-3));
      if (raw.length() > HAND_SPEED_CAP) raw.setLength(HAND_SPEED_CAP);
      state.vel.lerp(raw, HAND_LERP);
    }
  }
  if (!fresh) state.vel.multiplyScalar(Math.exp(-dt * HAND_DECAY));
}

export interface Pointer {
  readonly state: HandState;
  /** 指標在畫布上的 NDC（-1–1）；`idle` ＝ 還沒收到任何事件。 */
  readonly ndc: Vector2;
  readonly idle: boolean;
  /** 每一格呼叫一次（相機與人物的矩陣要先更新好）。`nowMs` 與事件用的是同一個時鐘（`performance.now()`）。 */
  step(dt: number, nowMs: number, camera: Camera, bodyWorld: Matrix4): void;
  dispose(): void;
}

export function createPointer(canvas: HTMLCanvasElement): Pointer {
  const state = createHandState();
  const ndc = new Vector2();
  const hit = new Vector3();
  let at = -1;

  const set = (clientX: number, clientY: number): void => {
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    at = performance.now();
  };
  const onPointer = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') set(e.clientX, e.clientY);
  };
  const onTouch = (e: TouchEvent): void => {
    const t = e.touches[0];
    if (t) set(t.clientX, t.clientY);
  };
  window.addEventListener('pointermove', onPointer);
  window.addEventListener('touchstart', onTouch, { passive: true });
  window.addEventListener('touchmove', onTouch, { passive: true });

  return {
    state,
    ndc,
    get idle() {
      return at < 0;
    },
    step(dt, nowMs, camera, bodyWorld) {
      const fresh = at >= 0 && nowMs - at < HAND_FRESH_MS;
      advanceHand(state, at >= 0 && projectToPlane(ndc, camera, bodyWorld, hit) ? hit : null, dt, fresh);
    },
    dispose() {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('touchstart', onTouch);
      window.removeEventListener('touchmove', onTouch);
    },
  };
}
