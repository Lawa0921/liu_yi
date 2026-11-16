// 試作「氣聚成人」：把剪影與兵器幾何取樣成光點的目標位置。
//
// 每一個目標形狀都是 count 個 vec4（RGBA float 貼圖的一格）：
//   xyz：位置（世界單位，人物身高約 2，腳底在 y = 0）
//   w  ：種類。0–1 是人形（數值是「靠近輪廓的程度」，畫的時候輪廓亮一點）；
//        2 鋼（刃）、3 銅件、4 朱紅（纓穗）、5 暗色（柄、桿）、6 兵器四周的氣；
//        -1 是在四周飄的煙（每個形狀都在同一批索引）。

import { Group, Mesh, MeshBasicMaterial, Vector3, type BufferGeometry } from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import type { Materials } from '../../scripts/three/materials';
import { buildJian, buildMiaodao, buildSpear, type Weapon } from '../../scripts/three/weapons';

export const AMBIENT = -1;
const AMBIENT_SHARE = 0.07;

/** 固定種子的亂數（每次載入都長一樣）。 */
export function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** 哪些索引是四周的煙：所有形狀共用，換招時它們不會被拉進人形。 */
export function ambientMask(count: number): Uint8Array {
  const random = rng(7);
  const mask = new Uint8Array(count);
  for (let i = 0; i < count; i++) mask[i] = random() < AMBIENT_SHARE ? 1 : 0;
  return mask;
}

function fillAmbient(out: Float32Array, mask: Uint8Array, random: () => number): void {
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    // 人物周圍一個扁的殼：近的稀、遠的多，背景才有一層煙。
    const a = random() * Math.PI * 2;
    const r = 1.3 + Math.pow(random(), 0.7) * 4.5;
    out[i * 4] = Math.cos(a) * r;
    out[i * 4 + 1] = -0.2 + random() * 3.6;
    out[i * 4 + 2] = Math.sin(a) * r * 0.8 - 0.8;
    out[i * 4 + 3] = AMBIENT;
  }
}

// ── 剪影 ──────────────────────────────────────────────────────────

export interface FigureSpec {
  src: string;
  /**
   * 這張圖裡的人畫得多大（相對於落地那張）。剪影的原圖比例不一，蹲低的架勢外框矮，
   * 但人並沒有變小：用頭的大小對過，不是直接拿外框高度去等比。
   */
  scale: number;
}

/** 落地那張的主體高（px）對應到世界單位 2。 */
const REFERENCE_PX = 1161;
const WORLD_HEIGHT = 2;
/** 取樣網格：每 px 原圖縮到多少格。 */
const GRID = 0.32;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`載不到剪影：${src}`));
    image.src = src;
  });
}

/** 內部到輪廓的距離（chamfer 3-4，單位：格）。 */
function insideDistance(mask: Uint8Array, w: number, h: number): Float32Array {
  const inf = 1e6;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? inf : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]!);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  for (let i = 0; i < d.length; i++) d[i] = d[i]! / 3;
  return d;
}

export async function sampleFigure(spec: FigureSpec, count: number, mask: Uint8Array, seed: number): Promise<Float32Array> {
  const image = await loadImage(spec.src);
  const w = Math.max(1, Math.round(image.naturalWidth * GRID));
  const h = Math.max(1, Math.round(image.naturalHeight * GRID));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, w, h);
  const rgba = context.getImageData(0, 0, w, h).data;

  const inside = new Uint8Array(w * h);
  let minX = w,
    maxX = 0,
    maxY = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3]! < 128) continue;
      inside[y * w + x] = 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  const distance = insideDistance(inside, w, h);

  const cells: number[] = [];
  const rim: number[] = [];
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i]) continue;
    cells.push(i);
    if (distance[i]! < 1.7) rim.push(i);
  }

  // 格 → 世界：同一比例尺，腳底（外框底）對齊 y = 0，外框中線對齊 x = 0。
  const unit = (WORLD_HEIGHT / REFERENCE_PX / GRID) * spec.scale;
  const centerX = (minX + maxX + 1) / 2;
  const random = rng(seed);
  const out = new Float32Array(count * 4);
  fillAmbient(out, mask, random);

  for (let i = 0; i < count; i++) {
    if (mask[i]) continue;
    const fromRim = random() < 0.22;
    const pool = fromRim ? rim : cells;
    const cell = pool[Math.floor(random() * pool.length)]!;
    const cx = cell % w;
    const cy = Math.floor(cell / w);
    const x = (cx + random() - centerX) * unit;
    const y = (maxY + 1 - (cy + random())) * unit;
    // 厚度：離輪廓越遠越厚（軀幹厚、手腳薄），再加一點噪聲，轉一點角度才看得出是一團有體積的氣。
    const depth = distance[cell]! * unit;
    const thick = 0.27 * Math.sqrt(Math.min(depth / 0.24, 1)) + 0.025;
    const z = (random() * 2 - 1) * thick * (0.85 + random() * 0.3) + (random() - 0.5) * 0.03;
    out[i * 4] = x;
    out[i * 4 + 1] = y;
    out[i * 4 + 2] = z;
    out[i * 4 + 3] = fromRim ? 1 : Math.max(0, 1 - depth / 0.05) * 0.6;
  }
  return out;
}

// ── 兵器 ──────────────────────────────────────────────────────────

const CLASS_STEEL = 2;
const CLASS_BRASS = 3;
const CLASS_RED = 4;
const CLASS_DARK = 5;
const CLASS_AURA = 6;
const SURFACE_SHARE = 0.3;

/**
 * weapons.ts 的建模函式要一組材質；這裡只要幾何，所以給一組只帶「種類」的空材質。
 * 用 Proxy 是因為 Materials 欄位多，取樣只在乎每個 mesh 屬於哪一類。
 */
function taggedMaterials(): Materials {
  const tag = (cls: number) => {
    const m = new MeshBasicMaterial();
    m.userData.cls = cls;
    return m;
  };
  const byKey: Record<string, MeshBasicMaterial> = {
    steel: tag(CLASS_STEEL),
    brass: tag(CLASS_BRASS),
    brassFret: tag(CLASS_BRASS),
    waxwood: tag(CLASS_DARK),
    lacquer: tag(CLASS_DARK),
    cordCool: tag(CLASS_DARK),
    cord: tag(CLASS_DARK),
    tassel: tag(CLASS_RED),
    tasselDeep: tag(CLASS_RED),
  };
  const blade = tag(CLASS_STEEL);
  return new Proxy({} as Materials, {
    get(_target, key) {
      if (key === 'blade') return () => blade;
      if (key === 'dispose') return () => {};
      return byKey[key as string] ?? blade;
    },
  });
}

function triangleArea(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  const triangles = index ? index.count / 3 : position.count / 3;
  let area = 0;
  for (let t = 0; t < triangles; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(position, i0);
    b.fromBufferAttribute(position, i1);
    c.fromBufferAttribute(position, i2);
    area += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return area;
}

export type WeaponName = 'jian' | 'miaodao' | 'spear';

export interface WeaponLayout {
  /** 擺出來的全長（世界單位）。 */
  length: number;
  /** 長軸和水平的夾角（弧度，鋒尖朝右上）。 */
  tilt: number;
  /** 中點的高度。 */
  height: number;
}

export function sampleWeapon(name: WeaponName, layout: WeaponLayout, count: number, mask: Uint8Array, seed: number): Float32Array {
  const materials = taggedMaterials();
  const weapon: Weapon = name === 'jian' ? buildJian(materials) : name === 'miaodao' ? buildMiaodao(materials) : buildSpear(materials);
  if (weapon.sheath) weapon.root.remove(weapon.sheath);

  const span = weapon.tip - weapon.butt;
  const holder = new Group();
  holder.add(weapon.root);
  weapon.root.position.y = -(weapon.tip + weapon.butt) / 2;
  holder.scale.setScalar(layout.length / span);
  holder.rotation.z = -(Math.PI / 2 - layout.tilt);
  holder.position.y = layout.height;
  // 纓穗要朝下垂：把它轉回世界的下方。
  for (const pendulum of weapon.pendulums) pendulum.rotation.z = -holder.rotation.z;
  holder.updateMatrixWorld(true);

  const meshes: { mesh: Mesh; weight: number; cls: number }[] = [];
  holder.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const material = object.material as MeshBasicMaterial;
    const cls = (material.userData.cls as number | undefined) ?? CLASS_STEEL;
    // 面積開 0.6 次方：刃面大、纓穗細，直接按面積分配穗會幾乎看不到。
    const boost = cls === CLASS_STEEL ? 1.8 : cls === CLASS_RED ? 0.5 : cls === CLASS_DARK ? 1.4 : 1;
    meshes.push({ mesh: object, weight: Math.pow(triangleArea(object.geometry), 0.6) * boost, cls });
  });
  const total = meshes.reduce((sum, m) => sum + m.weight, 0);

  const random = rng(seed);
  const out = new Float32Array(count * 4);
  fillAmbient(out, mask, random);
  const slots: number[] = [];
  for (let i = 0; i < count; i++) if (!mask[i]) slots.push(i);
  // 打散：哪個光點去兵器的哪一段要是亂的，變形時才是整團重組，不是一條一條移過去。
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [slots[i], slots[j]] = [slots[j]!, slots[i]!];
  }

  // 兵器很細，幾萬顆全擠在表面上只會糊成一條白光：只用三成在表面，其餘散成貼著兵器的一層淡淡的氣。
  const surface = Math.round(slots.length * SURFACE_SHARE);
  const point = new Vector3();
  let cursor = 0;
  meshes.forEach((entry, k) => {
    const share = k === meshes.length - 1 ? surface - cursor : Math.round((entry.weight / total) * surface);
    const sampler = new MeshSurfaceSampler(entry.mesh).build();
    for (let n = 0; n < share && cursor < surface; n++, cursor++) {
      sampler.sample(point);
      point.applyMatrix4(entry.mesh.matrixWorld);
      const i = slots[cursor]!;
      // 兵器本身很薄，加一點點散布，光點才不會全疊在同一條線上。
      out[i * 4] = point.x + (random() - 0.5) * 0.012;
      out[i * 4 + 1] = point.y + (random() - 0.5) * 0.012;
      out[i * 4 + 2] = point.z + (random() - 0.5) * 0.04;
      out[i * 4 + 3] = entry.cls;
    }
  });
  for (; cursor < slots.length; cursor++) {
    const from = slots[Math.floor(random() * surface)]!;
    const i = slots[cursor]!;
    const reach = 0.03 + Math.pow(random(), 2.2) * 0.32;
    const u = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    out[i * 4] = out[from * 4]! + Math.cos(a) * s * reach;
    out[i * 4 + 1] = out[from * 4 + 1]! + u * reach;
    out[i * 4 + 2] = out[from * 4 + 2]! + Math.sin(a) * s * reach;
    out[i * 4 + 3] = CLASS_AURA;
  }
  weapon.dispose();
  return out;
}
