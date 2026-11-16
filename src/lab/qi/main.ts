// 試作「氣聚成人」：幾萬顆金色光點聚成八極拳師，捲動換架勢，最後聚成三件兵器。
//
// GPGPU：位置、速度兩張貼圖（GPUComputationRenderer），目標形狀是另一張貼圖，換招就換目標並給一次衝量。
// 這是拋棄式試作，不是正式站的元件。

import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  FloatType,
  Group,
  Matrix4,
  PerspectiveCamera,
  Plane,
  Points,
  Ray,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  type IUniform,
  type Texture,
} from 'three';
import { GPUComputationRenderer, type Variable } from 'three/addons/misc/GPUComputationRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ambientMask, rng, sampleFigure, sampleWeapon, type FigureSpec, type WeaponLayout } from './shapes';
import { groundVertex, pointsFragment, pointsVertex, positionShader, velocityShader } from './shaders';

type Pose = 'lift' | 'land' | 'dingzhou' | 'chengchui' | 'kao' | 'jian' | 'miaodao' | 'spear';
type FigurePose = Exclude<Pose, 'jian' | 'miaodao' | 'spear'>;

interface Step {
  pose: Pose;
  /** 換到這一式時光點往哪裡炸：方向、力道、模式（0 順向、1 左右分開、2 從腳下往外）。 */
  burst: { dir: [number, number, number]; power: number; mode: 0 | 1 | 2 };
}

const STEPS: Step[] = [
  { pose: 'land', burst: { dir: [0, 1, 0], power: 1.6, mode: 2 } },
  { pose: 'land', burst: { dir: [0, -1, 0], power: 2.2, mode: 2 } },
  { pose: 'dingzhou', burst: { dir: [1, 0.15, 0.1], power: 3.2, mode: 0 } },
  { pose: 'chengchui', burst: { dir: [1, 0.1, 0], power: 3.0, mode: 1 } },
  { pose: 'kao', burst: { dir: [1, 0.35, 0.15], power: 3.4, mode: 0 } },
  { pose: 'jian', burst: { dir: [1, 0.25, 0], power: 3.0, mode: 0 } },
  { pose: 'miaodao', burst: { dir: [0.6, -0.8, 0], power: 3.2, mode: 0 } },
  { pose: 'spear', burst: { dir: [1, 0, 0], power: 3.6, mode: 0 } },
];

/** 剪影的人畫得多大（以落地那張為 1，對頭的大小估的）。 */
const FIGURE_SCALE: Record<FigurePose, number> = {
  lift: 1.02,
  land: 1,
  dingzhou: 1.25,
  chengchui: 1.18,
  kao: 1.12,
};

const SPRING = 26;
const GOLD = new Color('#b3924f').convertSRGBToLinear();
const PAPER = new Color('#f1e3c6').convertSRGBToLinear();
const SEAL = new Color('#b3261e').convertSRGBToLinear();

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

declare global {
  interface Window {
    __qi?: { frames: number; step: number; ready: boolean; time: number };
  }
}

export async function initQi(): Promise<void> {
  const root = document.querySelector<HTMLElement>('[data-qi]');
  const canvas = document.querySelector<HTMLCanvasElement>('.qi-canvas');
  if (!root || !canvas) return;
  const steps = [...root.querySelectorAll<HTMLElement>('[data-step]')];
  const figureSrc = JSON.parse(root.dataset.figures ?? '{}') as Record<FigurePose, string>;

  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = matchMedia('(pointer: coarse)').matches;
  const lite = innerWidth < 960 || touch;
  const size = lite ? 144 : 256; // 20 736 或 65 536 顆
  const count = size * size;
  const stats: NonNullable<Window['__qi']> = { frames: 0, step: 0, ready: false, time: 0 };
  window.__qi = stats;

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch {
    root.classList.add('is-static');
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, lite ? 1.5 : 1.75));
  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  // ── 目標形狀 ────────────────────────────────────────────────
  const aspect0 = innerWidth / innerHeight;
  const weaponLayout = (length: number, tilt: number): WeaponLayout => ({ length, tilt, height: 1.05 });
  const wide = aspect0 >= 1;
  const mask = ambientMask(count);
  const figurePoses = Object.keys(FIGURE_SCALE) as FigurePose[];
  const figureData = await Promise.all(
    figurePoses.map((pose, i) => {
      const spec: FigureSpec = { src: figureSrc[pose], scale: FIGURE_SCALE[pose] };
      return sampleFigure(spec, count, mask, 101 + i * 17);
    }),
  );
  const data: Record<Pose, Float32Array> = {
    ...(Object.fromEntries(figurePoses.map((pose, i) => [pose, figureData[i]!])) as Record<FigurePose, Float32Array>),
    jian: sampleWeapon('jian', weaponLayout(wide ? 2.9 : 1.9, wide ? 0.16 : 0.5), count, mask, 301),
    miaodao: sampleWeapon('miaodao', weaponLayout(wide ? 3.2 : 2.1, wide ? 0.22 : 0.55), count, mask, 302),
    spear: sampleWeapon('spear', weaponLayout(wide ? 3.8 : 2.3, wide ? 0.05 : 0.45), count, mask, 303),
  };
  const textures = {} as Record<Pose, DataTexture>;
  for (const pose of Object.keys(data) as Pose[]) {
    const texture = new DataTexture(data[pose], size, size, RGBAFormat, FloatType);
    texture.needsUpdate = true;
    textures[pose] = texture;
  }

  // ── GPGPU ──────────────────────────────────────────────────
  const gpu = new GPUComputationRenderer(size, size, renderer);
  const pos0 = gpu.createTexture();
  const vel0 = gpu.createTexture();
  {
    const random = rng(42);
    const p = pos0.image.data as Float32Array;
    for (let i = 0; i < count; i++) {
      // 開場：散在四面八方的遠處。
      const u = random() * 2 - 1;
      const a = random() * Math.PI * 2;
      const r = 3 + random() * 6;
      const s = Math.sqrt(1 - u * u);
      p[i * 4] = Math.cos(a) * s * r;
      p[i * 4 + 1] = 1 + u * r * 0.7;
      p[i * 4 + 2] = Math.sin(a) * s * r - 1;
      p[i * 4 + 3] = 0;
      if (calm) p.set(data.land.subarray(i * 4, i * 4 + 4), i * 4);
    }
  }
  const velVar: Variable = gpu.addVariable('textureVelocity', velocityShader, vel0);
  const posVar: Variable = gpu.addVariable('texturePosition', positionShader, pos0);
  gpu.setVariableDependencies(velVar, [posVar, velVar]);
  gpu.setVariableDependencies(posVar, [posVar, velVar]);
  const vu = velVar.material.uniforms as Record<string, IUniform>;
  const pu = posVar.material.uniforms as Record<string, IUniform>;
  Object.assign(vu, {
    tTarget: { value: textures.lift },
    uTime: { value: 0 },
    uDt: { value: 0 },
    uSpring: { value: 0 },
    uCurl: { value: 0.6 },
    uDamp: { value: 3.2 },
    uHand: { value: new Vector3(99, 99, 0) },
    uHandA: { value: new Vector3(99, 99, 0) },
    uHandVel: { value: new Vector3() },
    uHandR: { value: 0.5 },
    uImpulse: { value: new Vector4() },
    uImpulseMode: { value: 0 },
    uImpulseCenter: { value: new Vector3(0, 1, 0) },
  });
  const impulse = { dir: new Vector3(), power: 0 };
  Object.assign(pu, { tTarget: vu.tTarget, uDt: vu.uDt });
  const gpuError = gpu.init();
  if (gpuError) {
    console.warn('[qi]', gpuError);
    root.classList.add('is-static');
    return;
  }

  // ── 場景 ──────────────────────────────────────────────────
  const scene = new Scene();
  // 底色走 scene.background（有色彩管理）。用 clearColor 的話，後製流程換過幾格後會被當成 sRGB 再編一次，底色變灰。
  scene.background = new Color('#0b0a09');
  const camera = new PerspectiveCamera(35, 1, 0.1, 60);
  const body = new Group();
  scene.add(body);

  const refs = new Float32Array(count * 2);
  const seeds = new Float32Array(count);
  {
    const random = rng(9);
    for (let i = 0; i < count; i++) {
      refs[i * 2] = ((i % size) + 0.5) / size;
      refs[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size;
      seeds[i] = random();
    }
  }
  const pointsGeometry = new BufferGeometry();
  pointsGeometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
  pointsGeometry.setAttribute('ref', new BufferAttribute(refs, 2));
  pointsGeometry.setAttribute('seed', new BufferAttribute(seeds, 1));

  const zero = new DataTexture(new Float32Array(count * 4), size, size, RGBAFormat, FloatType);
  zero.needsUpdate = true;
  const shared = {
    tPos: { value: calm ? textures.land : (pos0 as Texture) },
    tVel: { value: zero as Texture },
    uPx: { value: lite ? 2.6 : 2.2 },
    uFocus: { value: 6 },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uReveal: { value: calm ? 1 : 0.025 },
    uGold: { value: GOLD },
    uPaper: { value: PAPER },
    uSeal: { value: SEAL },
  };
  const pointsMaterial = (mirror: boolean) =>
    new ShaderMaterial({
      uniforms: { ...shared, uMirror: { value: mirror ? 1 : 0 } },
      vertexShader: pointsVertex,
      fragmentShader: pointsFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    });
  const figure = new Points(pointsGeometry, pointsMaterial(false));
  figure.frustumCulled = false;
  body.add(figure);
  if (!lite) {
    const reflection = new Points(pointsGeometry, pointsMaterial(true));
    reflection.frustumCulled = false;
    body.add(reflection);
  }

  // 地面
  const groundCount = lite ? 2200 : 6000;
  const ground = new BufferGeometry();
  {
    const random = rng(5);
    const p = new Float32Array(groundCount * 3);
    const s = new Float32Array(groundCount);
    for (let i = 0; i < groundCount; i++) {
      const a = random() * Math.PI * 2;
      const r = Math.pow(random(), 0.65) * 5;
      p[i * 3] = Math.cos(a) * r;
      p[i * 3 + 1] = 0;
      p[i * 3 + 2] = Math.sin(a) * r * 0.9;
      s[i] = random();
    }
    ground.setAttribute('position', new BufferAttribute(p, 3));
    ground.setAttribute('seed', new BufferAttribute(s, 1));
  }
  const groundUniforms = {
    uShockT: { value: -1 },
    uLevel: { value: calm ? 1 : 0 },
    uPx: shared.uPx,
    uFocus: shared.uFocus,
    uPixelRatio: shared.uPixelRatio,
    uGold: shared.uGold,
    uPaper: shared.uPaper,
  };
  const groundPoints = new Points(
    ground,
    new ShaderMaterial({
      uniforms: groundUniforms,
      vertexShader: groundVertex,
      fragmentShader: pointsFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    }),
  );
  groundPoints.frustumCulled = false;
  body.add(groundPoints);

  // ── 後製：一層輕的光暈 ───────────────────────────────────────
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(256, 256), lite ? 0.55 : 0.7, 0.55, 0.32);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ── 版面：鏡頭擺位 ─────────────────────────────────────────
  const look = new Vector3();
  const baseCam = new Vector3();
  const fit = () => {
    const w = innerWidth;
    const h = innerHeight;
    const aspect = w / h;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
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
    baseCam.set(look.x, look.y + 0.15, distance);
    shared.uFocus.value = distance;
    camera.updateProjectionMatrix();
  };
  fit();
  addEventListener('resize', fit);

  // ── 互動：掌風 ─────────────────────────────────────────────
  const pointer = { x: 0, y: 0, nx: 0, ny: 0, at: -1 };
  const ndc = new Vector2();
  const hand = new Vector3(99, 99, 0);
  const handA = new Vector3(99, 99, 0); // 上一格的手：這一格劃過 handA → hand 這條線段
  const hit = new Vector3();
  const handVel = new Vector3();
  const inverse = new Matrix4();
  const ray = new Ray();
  const plane = new Plane(new Vector3(0, 0, 1), 0);
  const setPointer = (x: number, y: number) => {
    pointer.x = x;
    pointer.y = y;
    pointer.nx = (x / innerWidth) * 2 - 1;
    pointer.ny = -(y / innerHeight) * 2 + 1;
    pointer.at = performance.now();
  };
  if (!calm) {
    addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') setPointer(e.clientX, e.clientY);
    });
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) setPointer(t.clientX, t.clientY);
    };
    addEventListener('touchstart', onTouch, { passive: true });
    addEventListener('touchmove', onTouch, { passive: true });
  }

  // ── 換招 ──────────────────────────────────────────────────
  let current = 0;
  let stompAt = -1; // 震腳那一式：先抬腳，過一拍再落地
  let shockStart = -1;
  let shakeStart = -1;
  let time = 0;
  let burstAt = -10;
  let burstHold = 1;
  let snapUntil = -1;

  const setTarget = (pose: Pose) => {
    vu.tTarget!.value = textures[pose];
    if (calm) shared.tPos.value = textures[pose];
  };
  /** 炸開：給一次衝量，並讓彈簧鬆一下，光點才飛得出去，再慢慢聚回。 */
  const fire = (burst: Step['burst'], hold = 1) => {
    burstAt = time;
    burstHold = hold;
    impulse.dir.set(...burst.dir).normalize();
    impulse.power = burst.power;
    vu.uImpulseMode!.value = burst.mode;
  };
  const land = () => {
    setTarget('land');
    // 落地要「啪」一下就定住：不鬆彈簧，反而加倍一小段時間，只讓腳下的光點往外濺。
    fire({ dir: [0, -1, 0], power: 0.9, mode: 2 }, 0);
    snapUntil = time + 0.5;
    shockStart = time;
    shakeStart = time;
  };
  const activate = (index: number) => {
    steps.forEach((el, i) => el.classList.toggle('is-active', i === index));
    stats.step = index;
  };
  const goTo = (index: number) => {
    const step = STEPS[Math.min(index, STEPS.length - 1)]!;
    current = index;
    activate(index);
    if (calm) {
      setTarget(step.pose);
      return;
    }
    if (index === 1) {
      setTarget('lift');
      fire({ dir: [0, 1, 0], power: 1.8, mode: 2 }, 0.5);
      stompAt = time + 1.6;
    } else {
      stompAt = -1;
      setTarget(step.pose);
      fire(step.burst);
    }
  };

  // ── 開場 ──────────────────────────────────────────────────
  // 0–0.7 s 全黑零星；0.7–2.4 s 吸氣聚成抬腳；停一拍，4.4 s 落地；之後站名浮現。
  let intro = !calm;
  const INTRO_LAND = 4.4;
  const endIntro = () => {
    intro = false;
    shared.uReveal.value = 1;
    groundUniforms.uLevel.value = 1;
    root.classList.add('is-awake');
    activate(current);
  };
  if (calm) {
    root.classList.add('is-awake');
    activate(0);
  }

  const scrollIndex = () => scrollY / innerHeight;
  let lastScroll = scrollIndex();
  let scrollSpeed = 0;
  let introLanded = false;

  let last = performance.now();
  const frame = () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    time += dt;
    stats.frames++;
    stats.time = time;

    const s = scrollIndex();
    scrollSpeed += (Math.abs(s - lastScroll) / Math.max(dt, 1e-3) - scrollSpeed) * 0.2;
    lastScroll = s;
    const nearest = Math.max(0, Math.min(STEPS.length - 1, Math.round(s)));
    const between = Math.abs(s - nearest);

    let spring = SPRING;
    if (intro) {
      shared.uReveal.value = 0.025 + smoothstep(0.6, 2.0, time) * 0.975;
      spring = SPRING * smoothstep(0.7, 2.0, time);
      groundUniforms.uLevel.value = smoothstep(1.5, 3.5, time);
      if (!introLanded && time >= INTRO_LAND) {
        introLanded = true;
        land();
      }
      if (time > INTRO_LAND + 0.5) endIntro();
      if (s > 0.25) {
        // 開場還沒演完就捲：直接收尾。
        if (!introLanded) land();
        introLanded = true;
        endIntro();
      }
    } else if (nearest !== current) {
      goTo(nearest);
    }
    if (stompAt > 0 && time >= stompAt) {
      stompAt = -1;
      if (current === 1) land();
    }

    // 捲動中途鬆開、停下時聚合。
    const scatter = smoothstep(0.08, 0.45, between);
    spring *= 1 - 0.82 * scatter;
    if (burstHold > 0) spring *= 0.1 + 0.9 * smoothstep(0.25 * burstHold, 1.2 * burstHold, time - burstAt);
    if (time < snapUntil) spring *= 2.2;
    vu.uSpring!.value = spring;
    vu.uCurl!.value = 0.32 + scatter * 1.3 + Math.min(scrollSpeed, 3) * 0.35;
    vu.uDamp!.value = intro && time < 2 ? 3 : 5.5;
    vu.uTime!.value = time;
    vu.uDt!.value = dt;

    // 鏡頭：極慢的呼吸、滑鼠視差、落地小震。
    const idle = pointer.at < 0;
    const targetYaw = Math.sin(time * 0.11) * 0.22 + (idle ? 0 : pointer.nx * 0.32);
    const targetPitch = idle ? 0 : -pointer.ny * 0.05;
    body.rotation.y += (targetYaw - body.rotation.y) * Math.min(1, dt * 2);
    body.rotation.x += (targetPitch - body.rotation.x) * Math.min(1, dt * 2);
    const breathe = Math.sin(time * 0.42);
    camera.position.copy(baseCam);
    camera.position.z += breathe * 0.07;
    camera.position.y += breathe * 0.02;
    if (shakeStart >= 0) {
      const k = Math.exp(-(time - shakeStart) * 9) * 0.05;
      camera.position.x += (Math.random() - 0.5) * k;
      camera.position.y += (Math.random() - 0.5) * k;
      if (time - shakeStart > 0.8) shakeStart = -1;
    }
    camera.lookAt(look);
    camera.updateMatrixWorld();
    body.updateMatrixWorld();

    // 手在人物所在平面（本地 z = 0）上的位置與速度。
    // 掌風停手後還會再吹一下（約 0.25 秒衰減），不是一放手就沒了。
    const fresh = now - pointer.at < 80;
    if (!calm && pointer.at >= 0) {
      ndc.set(pointer.nx, pointer.ny);
      ray.origin.setFromMatrixPosition(camera.matrixWorld);
      ray.direction.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(ray.origin).normalize();
      inverse.copy(body.matrixWorld).invert();
      ray.applyMatrix4(inverse);
      if (ray.intersectPlane(plane, hit)) {
        if (hand.x === 99) hand.copy(hit);
        handA.copy(hand);
        hand.copy(hit);
        if (fresh) {
          const raw = hit.clone().sub(handA).divideScalar(Math.max(dt, 1e-3));
          if (raw.length() > 30) raw.setLength(30);
          handVel.lerp(raw, 0.6);
        }
      }
    }
    if (!fresh) handVel.multiplyScalar(Math.exp(-dt * 4));
    (vu.uHandA!.value as Vector3).copy(handA);
    (vu.uHand!.value as Vector3).copy(hand);
    (vu.uHandVel!.value as Vector3).copy(handVel);

    (vu.uImpulse!.value as Vector4).set(impulse.dir.x, impulse.dir.y, impulse.dir.z, impulse.power);
    impulse.power = 0;

    if (!calm) {
      gpu.compute();
      shared.tPos.value = gpu.getCurrentRenderTarget(posVar).texture;
      shared.tVel.value = gpu.getCurrentRenderTarget(velVar).texture;
    }
    groundUniforms.uShockT.value = shockStart >= 0 ? time - shockStart : -1;
    if (shockStart >= 0 && time - shockStart > 3) shockStart = -1;

    composer.render();
    stats.ready = true;
    if (!calm) requestAnimationFrame(frame);
  };

  if (calm) {
    // 減少動態：只畫靜態的聚合拳師，捲動時直接換架勢。
    const still = () => {
      const index = Math.max(0, Math.min(STEPS.length - 1, Math.round(scrollIndex())));
      if (index !== current) goTo(index);
      requestAnimationFrame(frame);
    };
    addEventListener('scroll', still, { passive: true });
    addEventListener('resize', still);
    still();
  } else {
    requestAnimationFrame(frame);
  }
}
