/**
 * GPGPU 模擬：位置、速度兩張貼圖（`GPUComputationRenderer`），目標形體是另一張貼圖（`setTarget`）。
 * 每一格：速度著色器（彈簧、curl noise、掌風、換招衝量）→ 位置著色器（位置 += 速度 × dt）。
 *
 * 一個 `Sim` 對應一個 tier 的貼圖尺寸（`side × side` 顆光點）；換 tier 就丟掉舊的、建新的（`dispose`），
 * 兩者共用同一個 `WebGLRenderer`。沒有 `EXT_color_buffer_float` 的裝置退回 HalfFloat（精度較差，仍能跑）；
 * 連半精度的 render target 都沒有就丟錯（呼叫端退回靜態圖）。
 * 注意：會被打進引擎 chunk，所以錯誤訊息只用英文。
 */

import { DataTexture, DataUtils, FloatType, HalfFloatType, RGBAFormat, Vector3, Vector4, type IUniform, type Texture, type WebGLRenderer } from 'three';
import { GPUComputationRenderer, type Variable } from 'three/addons/misc/GPUComputationRenderer.js';
import { rng } from '../shapes/rng';
import { floatTargets, halfFloatTargets } from './caps';
import { positionShader } from './shaders/position';
import { HAND_RADIUS, IMPULSE_CENTER, velocityShader } from './shaders/velocity';

/** 初始光點的亂數種子（試作值）。 */
const SCATTER_SEED = 42;

/** 一格要餵給模擬的東西。`impulse.power` 為 0 表示這一格沒有衝量。 */
export interface SimFrame {
  time: number;
  dt: number;
  spring: number;
  curl: number;
  damp: number;
  hand: Vector3;
  handA: Vector3;
  handVel: Vector3;
  impulse: { dir: Vector3; power: number; mode: number };
}

export interface Sim {
  readonly side: number;
  /** 光點位置與速度的貼圖（目前這一格的結果；每一格會換成另一張）。 */
  positionTexture(): Texture;
  velocityTexture(): Texture;
  /** 之後的每一格都往這張目標貼圖（`side × side`，xyz 位置、w 種類）拉。 */
  setTarget(texture: Texture): void;
  /** 把所有光點直接擺到目標的位置、速度歸零（第一次出現與重建 tier 時用，沒有飛行過程）。 */
  place(target: Texture): void;
  step(frame: SimFrame): void;
  /** 除錯讀回（同步，會等 GPU）：`side × side × 4` 的 RGBA（半精度的 render target 會先轉成 float）。 */
  readPositions(): Float32Array;
  readVelocities(): Float32Array;
  /** 目前的 uniform（數值型）。 */
  uniforms(): Record<string, number>;
  dispose(): void;
}

/** 一張 `side × side`、全 0 的 RGBA float 貼圖（速度歸零用；減少動態的靜態畫面也拿它當速度）。 */
export function zeroTexture(side: number): DataTexture {
  const texture = new DataTexture(new Float32Array(side * side * 4), side, side, RGBAFormat, FloatType);
  texture.needsUpdate = true;
  return texture;
}

export function createSim(renderer: WebGLRenderer, side: number): Sim {
  const count = side * side;
  if (!halfFloatTargets(renderer)) throw new Error('GPGPU needs a float render target (EXT_color_buffer_float or EXT_color_buffer_half_float)');
  const gpu = new GPUComputationRenderer(side, side, renderer);
  const useFloat = floatTargets(renderer);
  if (!useFloat) gpu.setDataType(HalfFloatType);

  const pos0 = gpu.createTexture();
  const vel0 = gpu.createTexture();
  {
    // 還沒有目標之前：散在四面八方的遠處。
    const random = rng(SCATTER_SEED);
    const p = pos0.image.data as Float32Array;
    for (let i = 0; i < count; i++) {
      const u = random() * 2 - 1;
      const a = random() * Math.PI * 2;
      const r = 3 + random() * 6;
      const s = Math.sqrt(1 - u * u);
      p[i * 4] = Math.cos(a) * s * r;
      p[i * 4 + 1] = 1 + u * r * 0.7;
      p[i * 4 + 2] = Math.sin(a) * s * r - 1;
      p[i * 4 + 3] = 0;
    }
  }

  const velVar: Variable = gpu.addVariable('textureVelocity', velocityShader, vel0);
  const posVar: Variable = gpu.addVariable('texturePosition', positionShader, pos0);
  gpu.setVariableDependencies(velVar, [posVar, velVar]);
  gpu.setVariableDependencies(posVar, [posVar, velVar]);

  const vu = velVar.material.uniforms as Record<string, IUniform>;
  const pu = posVar.material.uniforms as Record<string, IUniform>;
  const impulse = new Vector4();
  Object.assign(vu, {
    tTarget: { value: null as Texture | null },
    uTime: { value: 0 },
    uDt: { value: 0 },
    uSpring: { value: 0 },
    uCurl: { value: 0 },
    uDamp: { value: 0 },
    uHand: { value: new Vector3(99, 99, 0) },
    uHandA: { value: new Vector3(99, 99, 0) },
    uHandVel: { value: new Vector3() },
    uHandR: { value: HAND_RADIUS },
    uImpulse: { value: impulse },
    uImpulseMode: { value: 0 },
    uImpulseCenter: { value: new Vector3(...IMPULSE_CENTER) },
  });
  Object.assign(pu, { tTarget: vu.tTarget, uDt: vu.uDt });

  const error = gpu.init();
  if (error) {
    gpu.dispose();
    throw new Error(`GPGPU init failed: ${error}`);
  }

  const zero = zeroTexture(side);

  const read = (variable: Variable): Float32Array => {
    const rt = gpu.getCurrentRenderTarget(variable);
    if (useFloat) {
      const out = new Float32Array(count * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, side, side, out);
      return out;
    }
    // 半精度的 render target 讀回是 16 位元的位元樣式，要轉成 float
    const raw = new Uint16Array(count * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, side, side, raw);
    const out = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = DataUtils.fromHalfFloat(raw[i]!);
    return out;
  };

  return {
    side,
    positionTexture: () => gpu.getCurrentRenderTarget(posVar).texture,
    velocityTexture: () => gpu.getCurrentRenderTarget(velVar).texture,
    setTarget(texture) {
      vu.tTarget!.value = texture;
    },
    place(target) {
      // 兩個 ping-pong 的 render target 都寫，下一格不管讀哪一個都一樣
      for (const rt of posVar.renderTargets) gpu.renderTexture(target, rt);
      for (const rt of velVar.renderTargets) gpu.renderTexture(zero, rt);
    },
    step(frame) {
      vu.uTime!.value = frame.time;
      vu.uDt!.value = frame.dt;
      vu.uSpring!.value = frame.spring;
      vu.uCurl!.value = frame.curl;
      vu.uDamp!.value = frame.damp;
      (vu.uHandA!.value as Vector3).copy(frame.handA);
      (vu.uHand!.value as Vector3).copy(frame.hand);
      (vu.uHandVel!.value as Vector3).copy(frame.handVel);
      impulse.set(frame.impulse.dir.x, frame.impulse.dir.y, frame.impulse.dir.z, frame.impulse.power);
      vu.uImpulseMode!.value = frame.impulse.mode;
      gpu.compute();
    },
    readPositions: () => read(posVar),
    readVelocities: () => read(velVar),
    uniforms() {
      const out: Record<string, number> = {};
      for (const [name, uniform] of Object.entries(vu)) {
        if (typeof uniform.value === 'number') out[name] = uniform.value;
      }
      out.uImpulsePower = impulse.w;
      return out;
    },
    dispose() {
      zero.dispose();
      gpu.dispose();
    },
  };
}
