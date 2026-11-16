import { Euler, Matrix4, PerspectiveCamera, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { advanceHand, createHandState, HAND_DECAY, HAND_LERP, HAND_SPEED_CAP, projectToPlane } from '../../src/qi/engine/pointer';

/** 與引擎同樣的取景：相機在 +z 看向原點。 */
function camera(z = 5, aspect = 16 / 9): PerspectiveCamera {
  const cam = new PerspectiveCamera(35, aspect, 0.1, 60);
  cam.position.set(0, 0, z);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

describe('projectToPlane（螢幕點 → 人物本地 z = 0 平面）', () => {
  it('畫面正中央投影到原點', () => {
    const hit = new Vector3();
    expect(projectToPlane(new Vector2(0, 0), camera(), new Matrix4(), hit)).toBe(true);
    expect(hit.x).toBeCloseTo(0, 6);
    expect(hit.y).toBeCloseTo(0, 6);
    expect(hit.z).toBeCloseTo(0, 6);
  });

  it('畫面右緣、上緣對應透視可視範圍的邊（x = z·tan(fov/2)·aspect，y = z·tan(fov/2)）', () => {
    const cam = camera(5, 2);
    const half = 5 * Math.tan((35 / 2) * (Math.PI / 180));
    const right = new Vector3();
    projectToPlane(new Vector2(1, 0), cam, new Matrix4(), right);
    expect(right.x).toBeCloseTo(half * 2, 5);
    const top = new Vector3();
    projectToPlane(new Vector2(0, 1), cam, new Matrix4(), top);
    expect(top.y).toBeCloseTo(half, 5);
    expect(top.x).toBeCloseTo(0, 6);
  });

  it('人物群組轉了角度：交點在「本地」z = 0 平面上，而且回到世界座標後仍落在同一條射線上', () => {
    const cam = camera();
    const body = new Matrix4().makeRotationFromEuler(new Euler(0.1, 0.5, 0));
    const hit = new Vector3();
    expect(projectToPlane(new Vector2(0.3, -0.2), cam, body, hit)).toBe(true);
    expect(hit.z).toBeCloseTo(0, 6);
    // 本地交點轉到世界後，投影回螢幕要還是 (0.3, -0.2)
    const ndc = hit.clone().applyMatrix4(body).project(cam);
    expect(ndc.x).toBeCloseTo(0.3, 5);
    expect(ndc.y).toBeCloseTo(-0.2, 5);
  });

  it('平面在相機後面（射線打不到）→ false', () => {
    const cam = new PerspectiveCamera(35, 1, 0.1, 60);
    cam.position.set(0, 0, -5);
    cam.lookAt(0, 0, -10);
    cam.updateMatrixWorld();
    expect(projectToPlane(new Vector2(0, 0), cam, new Matrix4(), new Vector3())).toBe(false);
  });
});

describe('advanceHand（手的線段與速度平滑）', () => {
  it('第一個投影點直接落位：沒有從螢幕外飛來的線段，速度為 0', () => {
    const state = createHandState();
    expect(state.started).toBe(false);
    advanceHand(state, new Vector3(1, 0.5, 0), 0.016, true);
    expect(state.started).toBe(true);
    expect(state.hand.toArray()).toEqual([1, 0.5, 0]);
    expect(state.handA.toArray()).toEqual([1, 0.5, 0]);
    expect(state.vel.length()).toBe(0);
  });

  it('手一動：handA 是上一格的手，速度 = 位移 / dt 以 HAND_LERP 貼近', () => {
    const state = createHandState();
    advanceHand(state, new Vector3(0, 0, 0), 0.016, true);
    advanceHand(state, new Vector3(0.1, 0, 0), 0.016, true);
    expect(state.handA.x).toBe(0);
    expect(state.hand.x).toBeCloseTo(0.1, 9);
    expect(state.vel.x).toBeCloseTo((0.1 / 0.016) * HAND_LERP, 6);
  });

  it('速度有上限：滑鼠瞬間跳很遠也只吹到 HAND_SPEED_CAP', () => {
    const state = createHandState();
    advanceHand(state, new Vector3(0, 0, 0), 0.016, true);
    advanceHand(state, new Vector3(50, 0, 0), 0.016, true);
    expect(state.vel.length()).toBeCloseTo(HAND_SPEED_CAP * HAND_LERP, 6);
  });

  it('dt 為 0 也不會除以 0 或產生 NaN', () => {
    const state = createHandState();
    advanceHand(state, new Vector3(0, 0, 0), 0, true);
    advanceHand(state, new Vector3(0.1, 0, 0), 0, true);
    expect(Number.isFinite(state.vel.length())).toBe(true);
    expect(state.vel.length()).toBeLessThanOrEqual(HAND_SPEED_CAP);
  });

  it('不新鮮（停手超過 80 ms）：速度以每秒 HAND_DECAY 指數衰減，手的位置不動', () => {
    const state = createHandState();
    state.vel.set(10, 0, 0);
    state.hand.set(1, 1, 0);
    advanceHand(state, null, 0.25, false);
    expect(state.vel.x).toBeCloseTo(10 * Math.exp(-0.25 * HAND_DECAY), 6);
    expect(state.hand.toArray()).toEqual([1, 1, 0]);
  });

  it('新鮮但這一格沒有投影點：速度不衰減也不變', () => {
    const state = createHandState();
    state.vel.set(4, 0, 0);
    advanceHand(state, null, 0.016, true);
    expect(state.vel.x).toBe(4);
  });

  it('有投影點但不新鮮：手照常移動、速度只衰減（不被新位移蓋掉）', () => {
    const state = createHandState();
    advanceHand(state, new Vector3(0, 0, 0), 0.016, true);
    state.vel.set(8, 0, 0);
    advanceHand(state, new Vector3(0.5, 0, 0), 0.1, false);
    expect(state.hand.x).toBeCloseTo(0.5, 9);
    expect(state.vel.x).toBeCloseTo(8 * Math.exp(-0.1 * HAND_DECAY), 6);
  });

  it('輸入的投影點向量不會被留在 state 裡（之後改它不影響手）', () => {
    const state = createHandState();
    const hit = new Vector3(1, 2, 0);
    advanceHand(state, hit, 0.016, true);
    hit.set(9, 9, 9);
    expect(state.hand.toArray()).toEqual([1, 2, 0]);
  });
});
