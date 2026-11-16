// 淬火成形（第三版）：兵器台切換時，舊兵器沿噪聲邊界燃盡、新兵器從尖端往柄燒出來。
// 做法：在每個兵器材質的著色器裡插一段——某一點的「門檻」高於目前的進度就丟掉（discard），
// 剛好在邊界上的一圈發朱紅到金的光；邊緣再噴火星與金屑（Sparks）。
// 進度由 src/lib/arsenal/forge.ts 從切換狀態算出來，門檻的算式兩邊一致。

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Matrix4,
  Points,
  PointsMaterial,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
} from 'three';

export interface ForgeUniforms {
  /** 溶解進度（0–1）；≥ 0.999 時整段略過（平常不花任何成本）。 */
  uForge: { value: number };
  /** 門檻裡沿長軸位置的比重。 */
  uForgeAxis: { value: number };
  /** 長軸兩端在兵器自己座標裡的 Y：(鋒尖, 柄尾)。 */
  uForgeSpan: { value: Vector2 };
  /** 世界座標 → 兵器自己的座標。 */
  uForgeInverse: { value: Matrix4 };
  /** 邊界的火光：最邊上是朱紅，往裡是金。 */
  uForgeHot: { value: Color };
  uForgeGold: { value: Color };
}

export function createForgeUniforms(hot: string, gold: string): ForgeUniforms {
  return {
    uForge: { value: 1 },
    uForgeAxis: { value: 0.85 },
    uForgeSpan: { value: new Vector2(1, 0) },
    uForgeInverse: { value: new Matrix4() },
    uForgeHot: { value: new Color(hot) },
    uForgeGold: { value: new Color(gold) },
  };
}

const VERTEX_HEAD = /* glsl */ `
uniform mat4 uForgeInverse;
varying vec3 vForgePos;
`;

const VERTEX_BODY = /* glsl */ `
vForgePos = (uForgeInverse * modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform float uForge;
uniform float uForgeAxis;
uniform vec2 uForgeSpan;
uniform vec3 uForgeHot;
uniform vec3 uForgeGold;
varying vec3 vForgePos;

float forgeHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float forgeNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(forgeHash(i), forgeHash(i + vec3(1, 0, 0)), f.x), mix(forgeHash(i + vec3(0, 1, 0)), forgeHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(forgeHash(i + vec3(0, 0, 1)), forgeHash(i + vec3(1, 0, 1)), f.x), mix(forgeHash(i + vec3(0, 1, 1)), forgeHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z
  );
}
`;

// 和 src/lib/arsenal/forge.ts 的 forgeThreshold 同一條算式。
const FRAGMENT_DISCARD = /* glsl */ `
float forgeEdge = 0.0;
if (uForge < 0.999) {
  float forgeAxisAt = clamp((uForgeSpan.x - vForgePos.y) / (uForgeSpan.x - uForgeSpan.y), 0.0, 1.0);
  float forgeGrain = forgeNoise(vForgePos * 70.0) * 0.65 + forgeNoise(vForgePos * 190.0) * 0.35;
  float forgeThreshold = 0.02 + 0.96 * (forgeAxisAt * uForgeAxis + forgeGrain * (1.0 - uForgeAxis));
  if (forgeThreshold > uForge) discard;
  forgeEdge = 1.0 - smoothstep(0.0, 0.075, uForge - forgeThreshold);
}
`;

const FRAGMENT_GLOW = /* glsl */ `
totalEmissiveRadiance += mix(uForgeGold, uForgeHot, forgeEdge) * forgeEdge * forgeEdge * 7.0;
`;

/** 把淬火的那一段插進材質的著色器（MeshStandardMaterial／MeshPhysicalMaterial）。 */
export function applyForge(material: Material, uniforms: ForgeUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAGMENT_DISCARD}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAGMENT_GLOW}`);
  };
  // 改過的著色器要有自己的快取鍵，不然會和沒改過的同型材質共用程式。
  material.customProgramCacheKey = () => 'forge';
}

const MAX_SPARKS = 260;
const SCRATCH = new Vector3();

/** 火星與金屑：加色混合的小光點，從燃燒的邊界噴出來，往上飄一下再落下、熄掉。 */
export class Sparks {
  readonly points: Points;
  private readonly positions = new Float32Array(MAX_SPARKS * 3);
  private readonly colors = new Float32Array(MAX_SPARKS * 3);
  private readonly velocity = new Float32Array(MAX_SPARKS * 3);
  private readonly life = new Float32Array(MAX_SPARKS);
  private readonly span = new Float32Array(MAX_SPARKS);
  private readonly tone = new Float32Array(MAX_SPARKS);
  private readonly geometry = new BufferGeometry();
  private readonly material: PointsMaterial;
  private readonly map: CanvasTexture;
  private readonly hot: Color;
  private readonly gold: Color;
  private cursor = 0;
  private seed = 1;
  alive = 0;

  constructor(hot: string, gold: string, pixelRatio: number) {
    this.hot = new Color(hot);
    this.gold = new Color(gold);
    // 一顆實心的小方粒（不是暈開的光球）。
    const dot = document.createElement('canvas');
    dot.width = dot.height = 8;
    const ctx = dot.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(1, 1, 6, 6);
    this.map = new CanvasTexture(dot);
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    this.material = new PointsMaterial({
      size: 3.2 * pixelRatio,
      sizeAttenuation: false,
      map: this.map,
      vertexColors: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.points.visible = false;
  }

  private random(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** 在兵器長軸上 y 的位置（兵器自己的座標）附近噴 count 顆；scale 是兵器在畫面上的倍率。 */
  emit(root: Object3D, y: number, count: number, scale: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_SPARKS;
      // 貼著兵器：只在刃寬的範圍內抖一點點。
      SCRATCH.set((this.random() - 0.5) * 0.03, y + (this.random() - 0.5) * 0.012, (this.random() - 0.5) * 0.006);
      root.localToWorld(SCRATCH);
      this.positions[i * 3] = SCRATCH.x;
      this.positions[i * 3 + 1] = SCRATCH.y;
      this.positions[i * 3 + 2] = SCRATCH.z + 0.05;
      const angle = this.random() * Math.PI * 2;
      const speed = (0.00012 + this.random() * 0.0004) * scale;
      this.velocity[i * 3] = Math.cos(angle) * speed;
      this.velocity[i * 3 + 1] = Math.abs(Math.sin(angle)) * speed + 0.00012 * scale;
      this.velocity[i * 3 + 2] = 0;
      // 短命：火星貼著燃燒的邊緣迸出就熄，不在兵器上方飄成一片。
      this.span[i] = 160 + this.random() * 300;
      this.life[i] = this.span[i]!;
      this.tone[i] = this.random();
    }
  }

  step(dtMs: number): void {
    const dt = Math.min(dtMs, 64);
    let alive = 0;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.life[i]! <= 0) {
        this.colors[i * 3] = this.colors[i * 3 + 1] = this.colors[i * 3 + 2] = 0;
        continue;
      }
      this.life[i]! -= dt;
      alive += 1;
      this.velocity[i * 3 + 1]! -= 0.0000012 * dt;
      this.positions[i * 3]! += this.velocity[i * 3]! * dt;
      this.positions[i * 3 + 1]! += this.velocity[i * 3 + 1]! * dt;
      // 越燒越暗（加色混合：顏色變黑就是看不見）；剛噴出來偏金，快熄時偏紅。
      const k = Math.max(0, this.life[i]! / this.span[i]!);
      const color = SCRATCH_COLOR.copy(this.hot).lerp(this.gold, Math.min(1, k * 1.2 * (0.5 + this.tone[i]! * 0.5)));
      this.colors[i * 3] = color.r * k * 1.6;
      this.colors[i * 3 + 1] = color.g * k * 1.6;
      this.colors[i * 3 + 2] = color.b * k * 1.6;
    }
    this.alive = alive;
    this.points.visible = alive > 0;
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('color').needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.map.dispose();
  }
}

const SCRATCH_COLOR = new Color();
