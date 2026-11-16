/**
 * 舞台（場景）：相機、人物群組、光點與地面，以及一格怎麼畫出來。模擬（`sim.ts`）只提供位置與速度貼圖。
 *
 *   - `build` 依 tier 建（或重建）光點的幾何與材質：`side²` 顆點、地面點，桌機級（有光暈）才畫地面倒影。
 *   - `setSize` 只動 renderer／光暈 RT 與相機取景，不碰光點與姿勢（resize 不重建模擬，設計 §8.3、§8.5）。
 *   - `update` 是試作的鏡頭：極慢的呼吸、隨滑鼠的視差。`render` 交給光暈：有光暈就走 RT 與合成，沒有就直接畫到螢幕。
 * 色彩：點的顏色是金／米白／朱紅三色（反目標：沒有彩色特效）；底色 `#0b0a09` 與頁面一致。
 */

import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  type IUniform,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { SHAPE_COUNT } from '../shapes/format';
import { rng } from '../shapes/rng';
import { halfFloatTargets } from './caps';
import { cameraShake, shockwave, shockwaveSecond } from './effects';
import { createGlow, type Glow } from './glow';
import { GROUND, groundVertex } from './shaders/ground';
import { POINT_PX, pointsFragment, pointsVertex } from './shaders/points';

/** 頁面底色（`--qi-bg`）。 */
export const BACKDROP_HEX = 0x0b0a09;
const BACKDROP = new Vector3(((BACKDROP_HEX >> 16) & 255) / 255, ((BACKDROP_HEX >> 8) & 255) / 255, (BACKDROP_HEX & 255) / 255);

// 試作的顏色：`new Color(hex)` 已經把 sRGB 轉成線性，再 `convertSRGBToLinear()` 一次是試作實際的數值（使用者看過的亮度）。
// 改它就改了整體亮度，要動請連同色調映射與光暈強度一起重新對過。
const GOLD = new Color('#b3924f').convertSRGBToLinear();
const PAPER = new Color('#f1e3c6').convertSRGBToLinear();
const SEAL = new Color('#b3261e').convertSRGBToLinear();

const FOV = 35;
const EXPOSURE = 1.05;
/** pixel ratio 上限：低階 tier 較低。 */
const MAX_PIXEL_RATIO = { rich: 1.75, lite: 1.5 } as const;

export interface StageBuild {
  /** 光點貼圖的邊長（光點數 = side²）。 */
  side: number;
  /** 低階：不畫倒影、地面光點較少、點稍大。 */
  lite: boolean;
  /** 要光暈（桌機級）。裝置不支援半精度 render target 時仍會退成不開。 */
  glow: boolean;
}

/** 一格的特效狀態（Task 16）；由 `qi-stage` 每格算好餵進來。 */
export interface StageEffects {
  /** 落地後的秒數；< 0 ＝ 沒有衝擊波。衝擊波的兩圈與白閃、鏡頭震幅都由它算出（`effects.ts`）。 */
  shockT: number;
  /** 拖尾倍數的上限（`uStreak`）；1 ＝ 不拉長。 */
  streak: number;
}

/** 鏡頭視差用的指標狀態（NDC）。 */
export interface StageInput {
  idle: boolean;
  nx: number;
  ny: number;
}

export interface Stage {
  readonly camera: PerspectiveCamera;
  /** 人物群組：隨滑鼠轉一點點；掌風的投影平面是它的本地 z = 0。 */
  readonly body: Group;
  build(opts: StageBuild): void;
  /** 光點著色器讀的位置與速度貼圖。 */
  bind(position: Texture, velocity: Texture): void;
  setVisible(visible: boolean): void;
  /** CSS 像素的畫布尺寸。 */
  setSize(width: number, height: number): void;
  /** `time` 秒、`dt` 秒；`animate` 為 false 時鏡頭不動（減少動態）。 */
  update(time: number, dt: number, input: StageInput, animate?: boolean): void;
  /** 衝擊波、白閃、鏡頭震與拖尾上限（見 `StageEffects`）；每格在 `update` 之前呼叫。 */
  setEffects(effects: StageEffects): void;
  render(): void;
  /** 人物本地座標的一點 → 螢幕座標（CSS 像素，與滑鼠座標同一個空間）。 */
  project(x: number, y: number, z: number, out?: { x: number; y: number }): { x: number; y: number };
  /** 目前 pixel ratio 與 drawing buffer 尺寸（讀像素用）。 */
  bufferSize(): { width: number; height: number; pixelRatio: number };
  uniforms(): Record<string, number>;
  dispose(): void;
}

export function createStage(renderer: WebGLRenderer, canvas: HTMLCanvasElement): Stage {
  renderer.setClearColor(BACKDROP_HEX, 1);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 60);
  const body = new Group();
  scene.add(body);
  const glow: Glow = createGlow(renderer, BACKDROP);

  const look = new Vector3();
  const aim = new Vector3(); // 注視點（`look` 加上鏡頭震的位移）
  const baseCamera = new Vector3();
  const drawingSize = new Vector2();
  let cssWidth = 1;
  let cssHeight = 1;

  const shared = {
    tPos: { value: null as Texture | null },
    tVel: { value: null as Texture | null },
    uPx: { value: POINT_PX.rich as number },
    uFocus: { value: 6 },
    uPixelRatio: { value: 1 },
    uStreak: { value: 1 },
    uDensity: { value: 1 }, // 點數 / 形體檔的點數：重複展開的倍數（高階約 4）
    uGold: { value: GOLD },
    uPaper: { value: PAPER },
    uSeal: { value: SEAL },
  };

  // 落地的特效：地面著色器的兩圈（半徑、寬度、亮度）與白閃；鏡頭震幅由 update 套用
  const ring1 = new Vector3();
  const ring2 = new Vector3();
  const flash = { value: 0 };
  let shake = 0;
  let shockT = -1;

  // 目前這個 tier 的點與地面（build 時換掉）
  let disposables: { dispose(): void }[] = [];
  const points: Points[] = [];
  let groundPoints: Points | null = null;

  const releaseParticles = (): void => {
    for (const d of disposables) d.dispose();
    disposables = [];
    for (const p of points) body.remove(p);
    points.length = 0;
    if (groundPoints) body.remove(groundPoints);
    groundPoints = null;
  };

  /** 取景：直向與橫向各自決定人物佔畫面的大小與偏移（試作的值）。 */
  const fit = (): void => {
    const aspect = cssWidth / cssHeight;
    camera.aspect = aspect;
    let visibleH: number;
    if (aspect >= 1) {
      visibleH = Math.max(3.4, 5.9 / aspect);
      look.set(-visibleH * aspect * 0.13, 1.05, 0);
    } else {
      visibleH = Math.max(3.4, 2.75 / aspect);
      look.set(0, 1.05 - visibleH * 0.13, 0);
    }
    const distance = visibleH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    baseCamera.set(look.x, look.y + 0.15, distance);
    shared.uFocus.value = distance;
    camera.updateProjectionMatrix();
  };

  const applySize = (): void => {
    renderer.setSize(cssWidth, cssHeight, false);
    renderer.getDrawingBufferSize(drawingSize);
    glow.setSize(drawingSize.x, drawingSize.y);
    shared.uPixelRatio.value = renderer.getPixelRatio() * glow.sceneScale;
    fit();
  };

  const placeCamera = (): void => {
    camera.position.copy(baseCamera);
    camera.lookAt(look);
    camera.updateMatrixWorld();
    body.updateMatrixWorld();
  };

  const stage: Stage = {
    camera,
    body,
    build(opts) {
      releaseParticles();
      const { side, lite } = opts;
      const count = side * side;
      // 光暈的場景 RT 是半精度：兩個浮點 render target 擴充都沒有就退成不開光暈（直接畫到螢幕），不能黑畫面
      const glowOn = opts.glow && halfFloatTargets(renderer);
      glow.setEnabled(glowOn);
      renderer.setClearColor(glowOn ? 0x000000 : BACKDROP_HEX, 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? MAX_PIXEL_RATIO.lite : MAX_PIXEL_RATIO.rich));
      shared.uPx.value = lite ? POINT_PX.lite : POINT_PX.rich;
      shared.uDensity.value = count / SHAPE_COUNT;

      const refs = new Float32Array(count * 2);
      const seeds = new Float32Array(count);
      const random = rng(9);
      for (let i = 0; i < count; i++) {
        refs[i * 2] = ((i % side) + 0.5) / side;
        refs[i * 2 + 1] = (Math.floor(i / side) + 0.5) / side;
        seeds[i] = random();
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
      geometry.setAttribute('ref', new BufferAttribute(refs, 2));
      geometry.setAttribute('seed', new BufferAttribute(seeds, 1));
      disposables.push(geometry);

      const defines = glowOn ? {} : { QI_DIRECT: '' };
      const material = (mirror: boolean): ShaderMaterial => {
        const m = new ShaderMaterial({
          uniforms: { ...shared, uMirror: { value: mirror ? 1 : 0 } },
          defines,
          vertexShader: pointsVertex,
          fragmentShader: pointsFragment,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          blending: AdditiveBlending,
        });
        disposables.push(m);
        return m;
      };
      const figure = new Points(geometry, material(false));
      figure.frustumCulled = false;
      body.add(figure);
      points.push(figure);
      if (!lite) {
        const reflection = new Points(geometry, material(true));
        reflection.frustumCulled = false;
        body.add(reflection);
        points.push(reflection);
      }

      // 地面：一片很淡的光點（落地的衝擊波由 setEffects 驅動）
      const groundCount = lite ? GROUND.count.lite : GROUND.count.rich;
      const ground = new BufferGeometry();
      const groundRandom = rng(5);
      const gp = new Float32Array(groundCount * 3);
      const gs = new Float32Array(groundCount);
      for (let i = 0; i < groundCount; i++) {
        const a = groundRandom() * Math.PI * 2;
        const r = Math.pow(groundRandom(), 0.65) * GROUND.radius;
        gp[i * 3] = Math.cos(a) * r;
        gp[i * 3 + 1] = 0;
        gp[i * 3 + 2] = Math.sin(a) * r * GROUND.depth;
        gs[i] = groundRandom();
      }
      ground.setAttribute('position', new BufferAttribute(gp, 3));
      ground.setAttribute('seed', new BufferAttribute(gs, 1));
      disposables.push(ground);
      const groundMaterial = new ShaderMaterial({
        uniforms: {
          uRing1: { value: ring1 },
          uRing2: { value: ring2 },
          uFlash: flash,
          uLevel: { value: 1 },
          uPx: shared.uPx,
          uFocus: shared.uFocus,
          uPixelRatio: shared.uPixelRatio,
          uGold: shared.uGold,
          uPaper: shared.uPaper,
        },
        defines,
        vertexShader: groundVertex,
        fragmentShader: pointsFragment,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      });
      disposables.push(groundMaterial);
      groundPoints = new Points(ground, groundMaterial);
      groundPoints.frustumCulled = false;
      body.add(groundPoints);

      stage.setVisible(false); // 第一個姿勢擺好之前什麼都不畫
      applySize(); // pixel ratio 與光暈 RT 可能因 tier 改變
    },
    bind(position, velocity) {
      shared.tPos.value = position;
      shared.tVel.value = velocity;
    },
    setVisible(visible) {
      for (const p of points) p.visible = visible;
      if (groundPoints) groundPoints.visible = visible;
    },
    setSize(width, height) {
      cssWidth = Math.max(1, width);
      cssHeight = Math.max(1, height);
      applySize();
    },
    update(time, dt, input, animate = true) {
      if (animate) {
        // 鏡頭：極慢的呼吸、滑鼠視差
        const targetYaw = Math.sin(time * 0.11) * 0.22 + (input.idle ? 0 : input.nx * 0.32);
        const targetPitch = input.idle ? 0 : -input.ny * 0.05;
        body.rotation.y += (targetYaw - body.rotation.y) * Math.min(1, dt * 2);
        body.rotation.x += (targetPitch - body.rotation.x) * Math.min(1, dt * 2);
        const breathe = Math.sin(time * 0.42);
        camera.position.copy(baseCamera);
        camera.position.z += breathe * 0.07;
        camera.position.y += breathe * 0.02;
        aim.copy(look);
        if (shake > 0) {
          // 落地的鏡頭震：鏡頭與注視點一起平移（只動位置、注視點不動的話，人形在畫面中心附近幾乎不會抖）。
          // 確定性的偽亂數（不用 Math.random，截圖與測試才可重現）
          const dx = Math.sin(time * 173.3) * shake * 0.5;
          const dy = Math.sin(time * 131.7 + 1.7) * shake * 0.5;
          camera.position.x += dx;
          camera.position.y += dy;
          aim.x += dx;
          aim.y += dy;
        }
        camera.lookAt(aim);
        camera.updateMatrixWorld();
        body.updateMatrixWorld();
      } else {
        placeCamera();
      }
    },
    setEffects(effects) {
      shockT = Number.isFinite(effects.shockT) ? effects.shockT : -1;
      const first = shockwave(shockT);
      const second = shockwaveSecond(shockT);
      ring1.set(first.radius, first.width, first.amp);
      ring2.set(second.radius, second.width, second.amp);
      flash.value = first.flash;
      shake = cameraShake(shockT);
      shared.uStreak.value = Math.max(1, effects.streak);
    },
    render() {
      glow.render(scene, camera);
    },
    project(x, y, z, out = { x: 0, y: 0 }) {
      camera.updateMatrixWorld();
      body.updateMatrixWorld();
      const v = new Vector3(x, y, z).applyMatrix4(body.matrixWorld).project(camera);
      const rect = canvas.getBoundingClientRect();
      out.x = rect.left + (v.x * 0.5 + 0.5) * rect.width;
      out.y = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      return out;
    },
    bufferSize() {
      const gl = renderer.getContext();
      return { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, pixelRatio: renderer.getPixelRatio() };
    },
    uniforms() {
      const out: Record<string, number> = {};
      for (const [name, uniform] of Object.entries(shared) as [string, IUniform][]) {
        if (typeof uniform.value === 'number') out[name] = uniform.value;
      }
      out.glow = glow.enabled ? 1 : 0;
      out.uShockT = shockT;
      out.uFlash = flash.value;
      out.uShake = shake;
      out.uRingRadius = ring1.x;
      out.uRingAmp = ring1.z;
      out.uRing2Amp = ring2.z;
      return out;
    },
    dispose() {
      releaseParticles();
      glow.dispose();
    },
  };
  return stage;
}
