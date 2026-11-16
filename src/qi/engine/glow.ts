/**
 * 自寫的光暈（D15）：
 *   場景畫到半解析度的 `HalfFloatType` RT（線性、加色）→ 1/4 解析度的可分離 9-tap 高斯（橫、直各一道，疊 `BLUR_SPREADS.length` 輪，
 *   取樣間距逐輪放大）→ 與場景疊加並做 ACES 色調映射，畫到螢幕。
 * `tier.glow === false` 時 `enabled` 為 false：場景直接畫到螢幕，不配置任何 RT。
 *
 * 光暈的調性：高光抽取（`THRESHOLD`）讓只有夠亮的點會暈開，所以是人形四周一圈柔和的光，不是滿版外發光（反目標）。
 * 強度與半徑對照試作的 `UnrealBloomPass`（0.7／0.55／0.32）目測調過：寬度與亮度略收斂，人形內部的奶白色相近。
 */

import {
  BufferAttribute,
  BufferGeometry,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { blurFragment, compositeFragment, fullscreenVertex } from './shaders/glow';

/** 場景 RT 相對於 drawing buffer 的比例（半解析度）。 */
export const SCENE_SCALE = 0.5;
/** 模糊 RT 相對於場景 RT 的比例（再 1/2，等於 drawing buffer 的 1/4）。 */
const BLUR_SCALE = 0.5;
/** 橫＋直算一輪；每輪的取樣間距（texel）逐輪放大，半徑愈疊愈寬，仍是 1/4 解析度的 9-tap。 */
const BLUR_SPREADS = [1, 1.8, 3] as const;
/** 只讓亮度超過這個值（線性）的部分暈開，與疊加進去的強度。 */
const THRESHOLD = 0.2;
const STRENGTH = 1.1;

export interface Glow {
  /** 場景的解析度比例：開光暈時 `SCENE_SCALE`，否則 1。呼叫端用它換算點大小。 */
  readonly sceneScale: number;
  /** 開／關光暈：開時配置 RT，關時釋放。 */
  setEnabled(on: boolean): void;
  /** drawing buffer 的像素尺寸（已乘 pixel ratio）；RT 隨之調整。 */
  setSize(bufferWidth: number, bufferHeight: number): void;
  /** 畫一格到螢幕（含光暈或直接畫）。 */
  render(scene: Scene, camera: Camera): void;
  dispose(): void;
}

/** 一個蓋滿畫面的大三角形（比兩個三角形的 quad 少一條對角線的重複取樣）。 */
function fullscreenTriangle(): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const mesh = new Mesh(geometry);
  mesh.frustumCulled = false;
  return mesh;
}

const makeTarget = (): WebGLRenderTarget =>
  new WebGLRenderTarget(1, 1, { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });

/** `backdrop`：底色（顯示空間的 0–1 sRGB 數值）。 */
export function createGlow(renderer: WebGLRenderer, backdrop: Vector3): Glow {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = fullscreenTriangle();
  const blur = new ShaderMaterial({
    uniforms: { tInput: { value: null as Texture | null }, uStep: { value: new Vector2() }, uThreshold: { value: 0 } },
    vertexShader: fullscreenVertex,
    fragmentShader: blurFragment,
    depthTest: false,
    depthWrite: false,
  });
  const composite = new ShaderMaterial({
    uniforms: {
      tScene: { value: null as Texture | null },
      tGlow: { value: null as Texture | null },
      uGlow: { value: STRENGTH },
      // 底色在顯示空間加回去（場景 RT 的底是黑的）
      uBackdrop: { value: backdrop },
    },
    vertexShader: fullscreenVertex,
    fragmentShader: compositeFragment,
    depthTest: false,
    depthWrite: false,
  });

  let sceneTarget: WebGLRenderTarget | null = null;
  let blurA: WebGLRenderTarget | null = null;
  let blurB: WebGLRenderTarget | null = null;
  let width = 1;
  let height = 1;

  const pass = (material: ShaderMaterial, target: WebGLRenderTarget | null): void => {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quad, camera);
  };

  const applySize = (): void => {
    if (!sceneTarget || !blurA || !blurB) return;
    const sw = Math.max(1, Math.round(width * SCENE_SCALE));
    const sh = Math.max(1, Math.round(height * SCENE_SCALE));
    const bw = Math.max(1, Math.round(sw * BLUR_SCALE));
    const bh = Math.max(1, Math.round(sh * BLUR_SCALE));
    sceneTarget.setSize(sw, sh);
    blurA.setSize(bw, bh);
    blurB.setSize(bw, bh);
  };

  const release = (): void => {
    sceneTarget?.dispose();
    blurA?.dispose();
    blurB?.dispose();
    sceneTarget = blurA = blurB = null;
  };

  const glow: Glow = {
    get sceneScale() {
      return sceneTarget ? SCENE_SCALE : 1;
    },
    setEnabled(on) {
      if (on === (sceneTarget !== null)) return;
      if (on) {
        sceneTarget = makeTarget();
        blurA = makeTarget();
        blurB = makeTarget();
        applySize();
      } else {
        release();
      }
    },
    setSize(bufferWidth, bufferHeight) {
      width = bufferWidth;
      height = bufferHeight;
      applySize();
    },
    render(scene, camera3d) {
      if (!sceneTarget || !blurA || !blurB) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera3d);
        return;
      }
      const [sceneRt, a, b] = [sceneTarget, blurA, blurB];
      renderer.setRenderTarget(sceneRt);
      renderer.render(scene, camera3d);

      const blurUniforms = blur.uniforms as { tInput: { value: Texture | null }; uStep: { value: Vector2 }; uThreshold: { value: number } };
      let source: Texture = sceneRt.texture;
      BLUR_SPREADS.forEach((spread, round) => {
        blurUniforms.tInput.value = source;
        blurUniforms.uStep.value.set(spread / a.width, 0);
        blurUniforms.uThreshold.value = round === 0 ? THRESHOLD : 0; // 高光抽取只在第一道
        pass(blur, a);
        blurUniforms.tInput.value = a.texture;
        blurUniforms.uStep.value.set(0, spread / b.height);
        blurUniforms.uThreshold.value = 0;
        pass(blur, b);
        source = b.texture;
      });

      const compositeUniforms = composite.uniforms as { tScene: { value: Texture | null }; tGlow: { value: Texture | null } };
      compositeUniforms.tScene.value = sceneRt.texture;
      compositeUniforms.tGlow.value = source;
      pass(composite, null);
    },
    dispose() {
      release();
      blur.dispose();
      composite.dispose();
      quad.geometry.dispose();
    },
  };
  return glow;
}
