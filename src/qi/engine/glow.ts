/**
 * 自寫的光暈（D15）：
 *   場景畫到全解析度的 `HalfFloatType` RT（線性、加色）→ 1/4 解析度的可分離 9-tap 高斯（橫、直各一道，疊 `BLUR_SPREADS.length` 輪，
 *   取樣間距逐輪放大；前 `NEAR_ROUNDS` 輪的結果另存成近光暈，全部輪完是遠光暈）→ 近、遠光暈與場景疊加並做 ACES 色調映射，畫到螢幕。
 * `tier.glow === false` 時 `enabled` 為 false：場景直接畫到螢幕，不配置任何 RT。
 *
 * 光暈的調性：高光抽取（`THRESHOLD`）讓只有夠亮的點會暈開，所以是人形四周一圈柔和的光，不是滿版外發光（反目標）。
 * 強度與半徑對照試作的 `UnrealBloomPass`（0.7／0.55／0.32）調過（Task 16）：以同一視窗、同一姿勢的試作截圖為準，量人形內部、
 * 近遠光暈、頭頂、倒影各區的平均亮度（扣掉底色）接近 1:1，並目視人形內部的顆粒感。
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

/**
 * 場景 RT 相對於 drawing buffer 的比例由呼叫端依 tier 與 DPR 決定（`tiers.ts` 的 `sceneScaleFor`）：1 ＝ 全解析度才有試作那種細顆粒；
 * 半解析度（0.5）會把每顆光點放大成至少 2 個裝置像素再拉伸，人形變成糊的塊；降級要有減載台階，所以 mid 與高 DPR 用 0.75。
 */
/** 模糊 RT 相對於 drawing buffer 的比例（1/4）。 */
const BLUR_SCALE = 0.25;
/** 橫＋直算一輪；每輪的取樣間距（texel）逐輪放大（前一輪已經夠糊，大間距不會出現波紋），仍是 1/4 解析度的 9-tap。 */
const BLUR_SPREADS = [1, 1.8, 3, 5, 8, 12] as const;
/** 前幾輪的結果是「近光暈」（貼著人形的一圈亮邊），全部輪完是「遠光暈」（寬而柔的氣）。 */
const NEAR_ROUNDS = 3;
/**
 * 高光抽取的亮度門檻（線性亮度）與亮度上限，以及近、遠光暈疊加進去的強度。
 * 上限讓極亮的密集點（槍頭、纓穗）不會暈出一大團；亮度用 Rec.709 的權重（試作的 UnrealBloomPass 也是亮度），
 * 純紅的纓穗亮度低，不會自己暈出一團紅光。
 */
const THRESHOLD = 0.22;
const CLAMP = 0.5;
const NEAR_STRENGTH = 3.6;
const FAR_STRENGTH = 4.2;

export interface Glow {
  /** 場景的解析度比例：開光暈時是 `setEnabled` 給的比例，否則 1。呼叫端用它換算點大小。 */
  readonly sceneScale: number;
  /** 有沒有開光暈（場景畫到 RT 再合成）。 */
  readonly enabled: boolean;
  /** 開／關光暈：開時配置 RT（場景 RT 的比例為 `sceneScale`，預設 1），關時釋放；已經開著時只改比例並重設 RT 大小。 */
  setEnabled(on: boolean, sceneScale?: number): void;
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
    uniforms: { tInput: { value: null as Texture | null }, uStep: { value: new Vector2() }, uThreshold: { value: 0 }, uClamp: { value: CLAMP } },
    vertexShader: fullscreenVertex,
    fragmentShader: blurFragment,
    depthTest: false,
    depthWrite: false,
  });
  const composite = new ShaderMaterial({
    uniforms: {
      tScene: { value: null as Texture | null },
      tNear: { value: null as Texture | null },
      tFar: { value: null as Texture | null },
      uNear: { value: NEAR_STRENGTH },
      uFar: { value: FAR_STRENGTH },
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
  let near: WebGLRenderTarget | null = null;
  let scale = 1;
  let width = 1;
  let height = 1;

  const pass = (material: ShaderMaterial, target: WebGLRenderTarget | null): void => {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quad, camera);
  };

  const applySize = (): void => {
    if (!sceneTarget || !blurA || !blurB || !near) return;
    const sw = Math.max(1, Math.round(width * scale));
    const sh = Math.max(1, Math.round(height * scale));
    const bw = Math.max(1, Math.round(width * BLUR_SCALE));
    const bh = Math.max(1, Math.round(height * BLUR_SCALE));
    sceneTarget.setSize(sw, sh);
    blurA.setSize(bw, bh);
    blurB.setSize(bw, bh);
    near.setSize(bw, bh);
  };

  const release = (): void => {
    sceneTarget?.dispose();
    blurA?.dispose();
    blurB?.dispose();
    near?.dispose();
    sceneTarget = blurA = blurB = near = null;
  };

  const glow: Glow = {
    get sceneScale() {
      return sceneTarget ? scale : 1;
    },
    get enabled() {
      return sceneTarget !== null;
    },
    setEnabled(on, sceneScale = 1) {
      if (on) scale = Math.min(1, Math.max(0.25, Number.isFinite(sceneScale) ? sceneScale : 1));
      if (on === (sceneTarget !== null)) {
        if (on) applySize(); // 已經開著（例如 high → mid）：比例可能變了
        return;
      }
      if (on) {
        sceneTarget = makeTarget();
        blurA = makeTarget();
        blurB = makeTarget();
        near = makeTarget();
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
      if (!sceneTarget || !blurA || !blurB || !near) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera3d);
        return;
      }
      const [sceneRt, a, b, n] = [sceneTarget, blurA, blurB, near];
      renderer.setRenderTarget(sceneRt);
      renderer.render(scene, camera3d);

      const blurUniforms = blur.uniforms as { tInput: { value: Texture | null }; uStep: { value: Vector2 }; uThreshold: { value: number } };
      let source: Texture = sceneRt.texture;
      let nearTexture: Texture = source;
      BLUR_SPREADS.forEach((spread, round) => {
        const last = round === NEAR_ROUNDS - 1;
        blurUniforms.tInput.value = source;
        blurUniforms.uStep.value.set(spread / a.width, 0);
        blurUniforms.uThreshold.value = round === 0 ? THRESHOLD : 0; // 高光抽取只在第一道
        pass(blur, a);
        blurUniforms.tInput.value = a.texture;
        blurUniforms.uStep.value.set(0, spread / b.height);
        blurUniforms.uThreshold.value = 0;
        const out = last ? n : b; // 近光暈另存一張，後面的輪次接著從它再暈開
        pass(blur, out);
        source = out.texture;
        if (last) nearTexture = source;
      });

      const compositeUniforms = composite.uniforms as { tScene: { value: Texture | null }; tNear: { value: Texture | null }; tFar: { value: Texture | null } };
      compositeUniforms.tScene.value = sceneRt.texture;
      compositeUniforms.tNear.value = nearTexture;
      compositeUniforms.tFar.value = source;
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
