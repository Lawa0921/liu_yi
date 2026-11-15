// 三件兵器的程式建模（設計文件 §15.1）：中國劍、苗刀、大槍。單位公尺，長軸是 +Y（鋒尖朝上），
// 刃面朝 ±Z，寬在 X。全部用剖面放樣、車削、擠出與曲線掃掠做出來，不載任何模型檔。
//
// 造型是中國兵器：
//   劍   直身雙刃、菱形剖面（劍脊兩側兩個斜面，一明一暗）、收鋒的劍尖、兩翼前掠的回紋劍格、
//        纏繩柄、劍首、劍穗，另有劍鞘。
//   苗刀 依實物的共通特徵（見 buildMiaodao 的註解）：柄很長且直、刀身近乎直而只在前段微彎、
//        刀背／鎬線／刃口斜面三個面、血槽、順弧收尖（沒有橫手線）、吞口、橢圓的小盤護、柄中與柄首的銅箍。
//   大槍 有錐度的白蠟桿、帶脊的柳葉形槍頭、槍庫、垂掛的紅纓、槍鐏。

import {
  CatmullRomCurve3,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WeaponKind } from '../../lib/arsenal/pose';
import { DIAMOND_EDGE_FACES, diamondRing, ellipseRing, loft, ringBands, type RingPoint, type Station } from './loft';
import { JIAN_TURNS, MIAO_TURNS, type Materials } from './materials';

export interface Weapon {
  kind: WeaponKind;
  root: Group;
  /** 長軸上的兩端（鋒尖與尾端）的 Y。 */
  tip: number;
  butt: number;
  /** 長軸兩側最寬的零件（護手、盤護）伸出去多遠。 */
  clearance: number;
  /** 垂掛的穗有多長（沒有就是 0）：擺位置時要在下方留這麼多。 */
  drop: number;
  /** 劍鞘（只有劍有）。 */
  sheath?: Group;
  /** 會受重力下垂的纓穗：viewer 每格把它們轉回朝下。 */
  pendulums: Group[];
  dispose(): void;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const smooth = (t: number) => {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
};

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 收集幾何以便之後釋放，並統一設定陰影。 */
class Builder {
  readonly root = new Group();
  private readonly geometries: BufferGeometry[] = [];

  add(geometry: BufferGeometry, material: Material, parent: Group = this.root): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    this.geometries.push(geometry);
    return mesh;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
  }
}

type Along = (a: number) => { x: number; y: number; bend: number };
const STRAIGHT: Along = (a) => ({ x: 0, y: a, bend: 0 });

/** 沿長軸的橢圓柱段：給箍、柄、鞘這些零件。profile 是 [沿軸位置, 半寬, 半厚]。 */
function tube(
  profile: [number, number, number][],
  options: { capStart?: boolean; capEnd?: boolean; uPerMetre?: number; segments?: number; along?: Along } = {},
) {
  const along = options.along ?? STRAIGHT;
  const from = profile[0]![0];
  const stations: Station[] = profile.map(([a, halfWidth, halfThickness]) => ({
    ...along(a),
    along: Math.abs(a - from),
    ring: ellipseRing(halfWidth, halfThickness, options.segments ?? 24),
  }));
  return loft(stations, options);
}

/**
 * 纏繩的柄：除了貼圖，繩圈本身也做在幾何上（一圈一圈鼓起來），側影才看得出是繩不是橡膠套。
 * from → to 沿軸，radius(t) 回傳 [半寬, 半厚]。
 */
function wrappedGrip(from: number, to: number, turns: number, radius: (t: number) => [number, number], along: Along = STRAIGHT) {
  const perTurn = 6;
  const count = turns * perTurn;
  const profile: [number, number, number][] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    // 一圈之內：中間鼓、兩邊陷進縫裡。
    const swell = Math.pow(Math.abs(Math.sin(t * turns * Math.PI)), 0.6) * 0.0011;
    const [halfWidth, halfThickness] = radius(t);
    profile.push([lerp(from, to, t), halfWidth + swell, halfThickness + swell]);
  }
  return tube(profile, { uPerMetre: 1 / Math.abs(to - from), along, segments: 20 });
}

/** 一束絲線：每一根是一條細管，全部併成一個幾何。 */
function strands(count: number, radius: number, path: (index: number, random: () => number) => Vector3[], seed: number): BufferGeometry {
  const random = seeded(seed);
  const tubes: BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const curve = new CatmullRomCurve3(path(i, random));
    tubes.push(new TubeGeometry(curve, 9, radius * (0.8 + random() * 0.5), 3, false));
  }
  const merged = mergeGeometries(tubes)!;
  for (const item of tubes) item.dispose();
  return merged;
}

/**
 * 垂掛的穗：原點在繫點，沿 -Y 垂下。絲線分成幾綹（每綹先聚在一起、越往下越鬆開），
 * 長短參差、微微彎曲——是軟的、順著重力的，不是炸開的掃把。
 */
function hangingFringe(options: {
  count: number;
  locks: number;
  top: number;
  length: number;
  spread: number;
  radius: number;
  seed: number;
}): BufferGeometry {
  const { count, locks, top, length, spread, radius, seed } = options;
  const lockRandom = seeded(seed * 7 + 1);
  // 每一綹自己的方位、外張的程度與擺向。
  const groups = Array.from({ length: locks }, (_, i) => ({
    angle: (i / locks) * Math.PI * 2 + lockRandom() * 0.6,
    lean: 0.45 + lockRandom() * 0.55,
    swayX: (lockRandom() - 0.5) * 0.022,
    swayZ: (lockRandom() - 0.5) * 0.022,
    length: 0.82 + lockRandom() * 0.26,
  }));
  return strands(
    count,
    radius,
    (index, random) => {
      const lock = groups[index % locks]!;
      const jitter = () => (random() - 0.5) * spread * 0.5;
      const cos = Math.cos(lock.angle);
      const sin = Math.sin(lock.angle);
      const reach = spread * lock.lean;
      const own = length * lock.length * (0.78 + random() * 0.3);
      const ox = jitter();
      const oz = jitter();
      return [
        new Vector3(cos * top + ox * 0.3, 0, sin * top + oz * 0.3),
        new Vector3(cos * (top + reach * 0.45) + ox * 0.6, -own * 0.22, sin * (top + reach * 0.45) + oz * 0.6),
        new Vector3(cos * (top + reach * 0.8) + ox + lock.swayX * 0.5, -own * 0.6, sin * (top + reach * 0.8) + oz + lock.swayZ * 0.5),
        new Vector3(cos * (top + reach) + ox * 1.3 + lock.swayX, -own, sin * (top + reach) + oz * 1.3 + lock.swayZ),
      ];
    },
    seed,
  );
}

/** 把擠出幾何的 UV 換成「公尺 × 每公尺幾格」，浮雕的花紋才是等大的方格。 */
function tileUv(geometry: BufferGeometry, perMetre: number): void {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i) * perMetre, position.getY(i) * perMetre);
  uv.needsUpdate = true;
}

// ── 中國劍 ──────────────────────────────────────────────────────────

const JIAN = {
  bladeFrom: 0.012,
  bladeLength: 0.745,
  baseWidth: 0.039,
  shoulderWidth: 0.031,
  /** 從這個比例開始收鋒。 */
  tipFrom: 0.86,
  gripFrom: -0.018,
  gripTo: -0.172,
  pommelTo: -0.218,
};

function jianBlade(materials: Materials): { geometry: BufferGeometry; material: Material } {
  const { bladeFrom, bladeLength, baseWidth, shoulderWidth, tipFrom } = JIAN;
  const steps: number[] = [];
  for (let i = 0; i <= 12; i++) steps.push((i / 12) * tipFrom);
  for (let i = 1; i <= 16; i++) steps.push(tipFrom + (i / 16) * (1 - tipFrom));

  const stations: Station[] = steps.map((s) => {
    const k = s <= tipFrom ? 0 : (s - tipFrom) / (1 - tipFrom);
    const width = s <= tipFrom ? lerp(baseWidth, shoulderWidth, s / tipFrom) : shoulderWidth * (1 - Math.pow(k, 1.7));
    // 劍脊夠厚，兩側斜面各傾十五度左右：一面映到燈、另一面映到暗處，稜線才分明。
    const thickness = lerp(0.0108, 0.0062, s) * (1 - 0.78 * k * k);
    const ring: RingPoint[] =
      s >= 1
        ? diamondRing(1e-5, 1e-5, 1e-6, 1e-6)
        : diamondRing(width, thickness, 0.0042 * (width / baseWidth), thickness * 0.3);
    return { x: 0, y: bladeFrom + s * bladeLength, along: s * bladeLength, ring };
  });
  return {
    geometry: loft(stations, { uPerMetre: 1 }),
    material: materials.blade(ringBands(stations[0]!.ring, DIAMOND_EDGE_FACES)),
  };
}

/** 劍格：兩翼前掠（朝鋒尖）的元寶形，在刃面的平面上畫輪廓再擠出厚度；面上是回紋浮雕。 */
function jianGuard(): BufferGeometry {
  const half: [number, number, number, number][] = [
    // [控制點 x, y, 終點 x, y]（二次曲線）
    [0.02, -0.0185, 0.031, -0.013],
    [0.044, -0.0075, 0.048, 0.006],
    [0.0505, 0.016, 0.049, 0.0235],
    [0.041, 0.0105, 0.026, 0.0105],
    [0.012, 0.0105, 0, 0.0205],
  ];
  const shape = new Shape();
  shape.moveTo(0, -0.0175);
  for (const [cx, cy, x, y] of half) shape.quadraticCurveTo(cx, cy, x, y);
  for (let i = half.length - 1; i >= 0; i--) {
    const [cx, cy] = half[i]!;
    const [, , x, y] = i > 0 ? half[i - 1]! : [0, 0, 0, -0.0175];
    shape.quadraticCurveTo(-cx, cy, -x, y);
  }
  const depth = 0.017;
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.0035,
    bevelSize: 0.003,
    bevelSegments: 3,
    curveSegments: 14,
  });
  geometry.translate(0, 0, -depth / 2);
  // 一格回紋約 1.5 公分。
  tileUv(geometry, 1 / 0.015);
  return geometry;
}

function jianSheath(materials: Materials, builder: Builder): Group {
  const sheath = new Group();
  const from = 0.022;
  const to = JIAN.bladeFrom + JIAN.bladeLength + 0.028;
  const body: [number, number, number][] = [
    [from, 0.0235, 0.0108],
    [lerp(from, to, 0.5), 0.0218, 0.0102],
    [to - 0.03, 0.0198, 0.0094],
    [to - 0.008, 0.0185, 0.0088],
    [to, 0.015, 0.007],
  ];
  builder.add(tube(body, { capEnd: true, capStart: true }), materials.lacquer, sheath);

  // 銅件：鞘口、兩道護環（各帶一個掛環）、鞘尾。
  const band = (y0: number, y1: number, scale = 1) => {
    const t0 = (y0 - from) / (to - from);
    const t1 = (y1 - from) / (to - from);
    const widthAt = (t: number) => lerp(0.0235, 0.0192, t) + 0.0016;
    const thickAt = (t: number) => lerp(0.0108, 0.009, t) + 0.0016;
    return tube(
      [
        [y0, widthAt(t0) * scale - 0.0008, thickAt(t0) * scale - 0.0008],
        [y0 + 0.002, widthAt(t0) * scale, thickAt(t0) * scale],
        [y1 - 0.002, widthAt(t1) * scale, thickAt(t1) * scale],
        [y1, widthAt(t1) * scale - 0.0008, thickAt(t1) * scale - 0.0008],
      ],
      { capStart: true, capEnd: true },
    );
  };
  builder.add(band(from - 0.002, from + 0.046), materials.brass, sheath);
  for (const y of [0.175, 0.335]) {
    builder.add(band(y, y + 0.016, 1.03), materials.brass, sheath);
    const loop = new TorusGeometry(0.0062, 0.0016, 8, 20);
    loop.rotateY(Math.PI / 2);
    loop.translate(-0.0305, y + 0.008, 0);
    builder.add(loop, materials.brass, sheath);
  }
  builder.add(
    tube(
      [
        [to - 0.074, 0.0212, 0.0102],
        [to - 0.072, 0.0222, 0.011],
        [to - 0.02, 0.0206, 0.0102],
        [to - 0.004, 0.0185, 0.009],
        [to + 0.003, 0.012, 0.006],
      ],
      { capStart: true, capEnd: true },
    ),
    materials.brass,
    sheath,
  );
  return sheath;
}

const JIAN_TASSEL = 0.2;

/** 劍穗：一段繩、一個結、一束朱紅的穗。原點在掛點，沿 -Y 垂下，全長約 20 公分。 */
function jianTassel(materials: Materials, builder: Builder): Group {
  const tassel = new Group();
  const cord = new TubeGeometry(
    new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(0.003, -0.018, 0.002), new Vector3(-0.002, -0.036, -0.001), new Vector3(0, -0.05, 0)]),
    12,
    0.0015,
    6,
    false,
  );
  builder.add(cord, materials.tasselDeep, tassel);
  const knot = new SphereGeometry(0.0068, 14, 10);
  knot.scale(1, 1.25, 1);
  knot.translate(0, -0.056, 0);
  builder.add(knot, materials.tasselDeep, tassel);
  builder.add(
    tube(
      [
        [-0.063, 0.0048, 0.0048],
        [-0.073, 0.006, 0.006],
      ],
      { capStart: true, segments: 12 },
    ),
    materials.brass,
    tassel,
  );
  const fringe = hangingFringe({ count: 70, locks: 6, top: 0.0035, length: JIAN_TASSEL - 0.072, spread: 0.012, radius: 0.0008, seed: 101 });
  fringe.translate(0, -0.071, 0);
  builder.add(fringe, materials.tassel, tassel);
  return tassel;
}

export function buildJian(materials: Materials): Weapon {
  const builder = new Builder();
  const { gripFrom, gripTo, pommelTo } = JIAN;

  const blade = jianBlade(materials);
  builder.add(blade.geometry, blade.material);
  builder.add(jianGuard(), materials.brassFret);

  // 劍柄：微微鼓腹的橢圓柱，藏青的繩一圈一圈纏上去。
  builder.add(
    wrappedGrip(gripFrom, gripTo, JIAN_TURNS, (t) => {
      const belly = Math.sin(t * Math.PI) * 0.0014;
      return [0.0132 + belly, 0.0104 + belly];
    }),
    materials.cordCool,
  );

  // 柄與劍格之間的箍。
  builder.add(
    tube(
      [
        [gripFrom + 0.004, 0.0152, 0.012],
        [gripFrom - 0.009, 0.0152, 0.012],
        [gripFrom - 0.011, 0.0142, 0.011],
      ],
      { capStart: true },
    ),
    materials.brass,
  );

  // 劍首：往外張再收圓。
  builder.add(
    tube(
      [
        [gripTo + 0.004, 0.0142, 0.0112],
        [gripTo - 0.006, 0.0165, 0.0124],
        [gripTo - 0.02, 0.0228, 0.0146],
        [gripTo - 0.032, 0.0238, 0.015],
        [gripTo - 0.04, 0.0205, 0.013],
        [pommelTo, 0.011, 0.0072],
      ],
      { capEnd: true },
    ),
    materials.brass,
  );

  const sheath = jianSheath(materials, builder);
  builder.root.add(sheath);

  const pendulum = jianTassel(materials, builder);
  pendulum.position.set(0, pommelTo - 0.001, 0);
  builder.root.add(pendulum);

  return {
    kind: 'jian',
    root: builder.root,
    tip: JIAN.bladeFrom + JIAN.bladeLength,
    butt: pommelTo,
    clearance: 0.052,
    drop: JIAN_TASSEL,
    sheath,
    pendulums: [pendulum],
    dispose: () => builder.dispose(),
  };
}

// ── 苗刀 ────────────────────────────────────────────────────────────
//
// 依據的實物特徵（查了幾家賣實戰苗刀的規格與 Mandarin Mansion 的古董苗刀條目）：
//   · 全長約 1.2–1.45 m，刀身 80–100 cm，柄 30–46 cm——柄佔全長約三成，雙手握。這裡取全長 1.42、柄 0.44。
//   · 「苗」是說刀身細長如禾苗：單刃、弧度很淺而柔。這裡刀身後段是直的，只有前半才漸漸上彎。
//   · 護手是圓盤或橢圓盤（實物約 8 × 9 cm 以內），不是方鍔。這裡取 7.6 × 6.6 cm 的小橢圓盤。
//   · 刀身常有血槽。
// 與日本刀拉開的地方：柄是直的、粗、平繞的繩加銅箍（不是菱形柄卷）；柄中與柄首各一道銅箍；
// 刀根有吞口；刀尖順著刃的弧一路收上去，沒有橫手線；刀身比較寬。

const MIAO = {
  bladeFrom: 0.006,
  bladeTo: 0.97,
  /** 從這裡開始才上彎，之前是直的。 */
  curveFrom: 0.4,
  /** 彎到底的曲率（1/m）。 */
  curvature: 0.5,
  gripTo: -0.41,
  pommelTo: -0.452,
  baseWidth: 0.041,
  tipWidth: 0.037,
};

/** 苗刀的中心線：柄與刀身後段是直的，前段的曲率由 0 漸增。每 2 mm 積分一次存成表。 */
const MIAO_STEP = 0.002;
const MIAO_LINE = (() => {
  const table: { x: number; y: number; bend: number }[] = [{ x: 0, y: 0, bend: 0 }];
  let x = 0;
  let y = 0;
  let bend = 0;
  for (let a = 0; a < MIAO.bladeTo + 0.02; a += MIAO_STEP) {
    const curvature = MIAO.curvature * smooth((a - MIAO.curveFrom) / (MIAO.bladeTo - MIAO.curveFrom));
    bend += curvature * MIAO_STEP;
    x -= Math.sin(bend) * MIAO_STEP;
    y += Math.cos(bend) * MIAO_STEP;
    table.push({ x, y, bend });
  }
  return table;
})();

const miaoAlong: Along = (a) => {
  if (a <= 0) return { x: 0, y: a, bend: 0 };
  const index = Math.min(MIAO_LINE.length - 2, Math.floor(a / MIAO_STEP));
  const t = a / MIAO_STEP - index;
  const p = MIAO_LINE[index]!;
  const q = MIAO_LINE[index + 1]!;
  return { x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t), bend: lerp(p.bend, q.bend, t) };
};

/**
 * 苗刀的剖面（刃口在 +u、刀背在 -u），三個面加一道槽：
 *   刀背（平的）→ 鎬地（刀背到鎬線，上面開血槽）→ 鎬線（最厚的一道稜）→ 刃口大斜面 → 刃口小斜面（研磨帶）。
 */
function miaoRing(width: number, thickness: number, groove: number, pull: number, closed: boolean): RingPoint[] {
  const half = width / 2;
  const ridgeU = -half + width * 0.4;
  const ridgeZ = thickness / 2;
  const spineZ = ridgeZ * 0.8;
  const shoulderU = half - 0.0042;
  const shoulderZ = thickness * 0.085;
  const g0 = -half + 0.0036;
  const g1 = ridgeU - 0.0034;
  const gm = (g0 + g1) / 2;
  const flatZ = (u: number) => lerp(spineZ, ridgeZ, (u + half) / (ridgeU + half));
  // 鋒尖：所有的點往刀背收（pull 由 1 到 0）。
  const point = (u: number, z: number, isSmooth = false): RingPoint => ({
    u: -half + (u + half) * pull,
    z: closed ? 0 : z,
    smooth: isSmooth,
  });
  return [
    point(half, 0),
    point(shoulderU, shoulderZ),
    point(ridgeU, ridgeZ),
    point(g1, flatZ(g1)),
    point(gm, flatZ(gm) - groove, true),
    point(g0, flatZ(g0)),
    point(-half, spineZ),
    point(-half, -spineZ),
    point(g0, -flatZ(g0)),
    point(gm, -(flatZ(gm) - groove), true),
    point(g1, -flatZ(g1)),
    point(ridgeU, -ridgeZ),
    point(shoulderU, -shoulderZ),
  ];
}

/** miaoRing() 裡屬於刃口小斜面的兩個面。 */
const MIAO_EDGE_FACES = [0, 12];

const miaoWidth = (s: number) => lerp(MIAO.baseWidth, MIAO.tipWidth, s);
const miaoThickness = (s: number) => lerp(0.0098, 0.0058, s);

function miaoBlade(materials: Materials): { geometry: BufferGeometry; material: Material } {
  const { bladeFrom, bladeTo } = MIAO;
  // 刀尖：最後 14% 順著弧慢慢收，沒有橫手線那種折角。
  const tipFrom = 0.86;
  const steps: number[] = [];
  for (let i = 0; i <= 30; i++) steps.push((i / 30) * tipFrom);
  for (let i = 1; i <= 22; i++) steps.push(tipFrom + (i / 22) * (1 - tipFrom));

  const stations: Station[] = steps.map((s) => {
    const a = lerp(bladeFrom, bladeTo, s);
    const k = s <= tipFrom ? 0 : (s - tipFrom) / (1 - tipFrom);
    const thickness = miaoThickness(s) * (1 - 0.82 * k * k);
    // 血槽：過了吞口才開始、收尖之前淡出。
    const groove = 0.0017 * smooth((s - 0.075) / 0.05) * (1 - smooth((s - 0.7) / 0.12));
    const pull = k === 0 ? 1 : 1 - Math.pow(k, 2.1);
    return { ...miaoAlong(a), along: a, ring: miaoRing(miaoWidth(s), thickness, groove, pull, s >= 1) };
  });
  return {
    geometry: loft(stations, { uPerMetre: 1 }),
    material: materials.blade(ringBands(stations[0]!.ring, MIAO_EDGE_FACES)),
  };
}

export function buildMiaodao(materials: Materials): Weapon {
  const builder = new Builder();
  const { gripTo, pommelTo } = MIAO;

  const blade = miaoBlade(materials);
  builder.add(blade.geometry, blade.material);

  // 吞口：包住刀身根部的銅套，前緣斜切，刀背那一側伸得比較長。
  const collarRing = (a: number, grow: number): RingPoint[] => {
    const s = a / MIAO.bladeTo;
    const half = miaoWidth(s) / 2 + grow;
    const thick = miaoThickness(s) / 2 + grow;
    return [
      { u: half, z: 0 },
      { u: half - 0.005, z: thick * 0.5 },
      { u: -half + miaoWidth(s) * 0.4, z: thick },
      { u: -half, z: thick * 0.84 },
      { u: -half, z: -thick * 0.84 },
      { u: -half + miaoWidth(s) * 0.4, z: -thick },
      { u: half - 0.005, z: -thick * 0.5 },
    ];
  };
  const collar: Station[] = [0.002, 0.014, 0.052, 0.058].map((a, i) => {
    const at = miaoAlong(a);
    return { ...at, bend: at.bend + (i >= 2 ? -0.5 : 0), along: a, ring: collarRing(a, i === 3 ? 0.0005 : 0.0017) };
  });
  builder.add(loft(collar, { capStart: true, capEnd: true }), materials.brass);

  // 盤護：橢圓的小盤，微微朝刀身凹，邊緣起一道唇；盤面一圈回紋。
  const guard = new LatheGeometry(
    [
      new Vector2(0.0095, -0.0034),
      new Vector2(0.024, -0.0038),
      new Vector2(0.034, -0.0022),
      new Vector2(0.0372, 0.0012),
      new Vector2(0.0382, 0.005),
      new Vector2(0.0366, 0.0064),
      new Vector2(0.0344, 0.0042),
      new Vector2(0.024, 0.0016),
      new Vector2(0.0095, 0.0018),
    ],
    56,
  );
  // 車削的 UV：U 繞一圈、V 沿剖面。繞一圈排 14 格回紋，剖面來回各 2 格。
  const guardUv = guard.getAttribute('uv');
  for (let i = 0; i < guardUv.count; i++) guardUv.setXY(i, guardUv.getX(i) * 14, guardUv.getY(i) * 4);
  guard.scale(1, 1, 0.87);
  builder.add(guard, materials.brassFret);

  // 長柄：直的、粗，雙手握。靠盤護一道箍、柄中一道箍、柄首一個帶箍的銅帽；中間兩段是平繞的褐色繩。
  const gripRadius: [number, number] = [0.0178, 0.0146];
  const ferruleTo = -0.034;
  const hoopFrom = lerp(ferruleTo, gripTo, 0.5) + 0.009;
  const hoopTo = hoopFrom - 0.018;
  const half = Math.floor(MIAO_TURNS / 2);
  builder.add(wrappedGrip(ferruleTo, hoopFrom, half, () => gripRadius), materials.cord);
  builder.add(wrappedGrip(hoopTo, gripTo, MIAO_TURNS - half, () => gripRadius), materials.cord);

  const hoop = (from: number, to: number, grow = 0.0018) =>
    tube(
      [
        [from + 0.0015, gripRadius[0] + grow - 0.001, gripRadius[1] + grow - 0.001],
        [from, gripRadius[0] + grow, gripRadius[1] + grow],
        [to, gripRadius[0] + grow, gripRadius[1] + grow],
        [to - 0.0015, gripRadius[0] + grow - 0.001, gripRadius[1] + grow - 0.001],
      ],
      { capStart: true, capEnd: true },
    );
  builder.add(hoop(-0.004, ferruleTo - 0.002), materials.brass);
  builder.add(hoop(hoopFrom + 0.002, hoopTo - 0.002), materials.brass);

  // 柄首：銅帽，中間束一道凸箍，尾端略收、平頂。
  builder.add(
    tube(
      [
        [gripTo + 0.004, gripRadius[0] + 0.0012, gripRadius[1] + 0.0012],
        [gripTo - 0.006, gripRadius[0] + 0.0018, gripRadius[1] + 0.0018],
        [gripTo - 0.012, gripRadius[0] + 0.0042, gripRadius[1] + 0.0042],
        [gripTo - 0.018, gripRadius[0] + 0.0042, gripRadius[1] + 0.0042],
        [gripTo - 0.022, gripRadius[0] + 0.0016, gripRadius[1] + 0.0016],
        [gripTo - 0.036, gripRadius[0] + 0.0004, gripRadius[1] + 0.0004],
        [pommelTo, gripRadius[0] - 0.004, gripRadius[1] - 0.004],
      ],
      { capEnd: true },
    ),
    materials.brass,
  );

  return {
    kind: 'miaodao',
    root: builder.root,
    tip: miaoAlong(MIAO.bladeTo).y,
    butt: pommelTo,
    clearance: 0.05,
    drop: 0,
    pendulums: [],
    dispose: () => builder.dispose(),
  };
}

// ── 大槍 ────────────────────────────────────────────────────────────

const SPEAR = {
  shaftTo: 2.7,
  socketTo: 2.795,
  headTo: 3.0,
  buttRadius: 0.019,
  neckRadius: 0.0112,
};

const SPEAR_TASSEL = 0.24;

function spearHead(materials: Materials): { geometry: BufferGeometry; material: Material } {
  const from = SPEAR.socketTo - 0.004;
  const length = SPEAR.headTo - from;
  const widest = 0.3;
  const steps: number[] = [];
  for (let i = 0; i <= 10; i++) steps.push((i / 10) * widest);
  for (let i = 1; i <= 22; i++) steps.push(widest + (i / 22) * (1 - widest));

  const stations: Station[] = steps.map((s) => {
    const k = s <= widest ? 0 : (s - widest) / (1 - widest);
    // 柳葉形：由頸部鼓出去，再一路收成尖。
    const width = s <= widest ? lerp(0.015, 0.044, smooth(s / widest)) : 0.044 * (1 - Math.pow(k, 1.55));
    const thickness = (s <= widest ? lerp(0.0135, 0.0112, s / widest) : lerp(0.0112, 0.0036, k)) * (1 - 0.6 * k * k * k);
    const ring = s >= 1 ? diamondRing(1e-5, 1e-5, 1e-6, 1e-6) : diamondRing(width, thickness, 0.0042 * (width / 0.044), thickness * 0.3);
    return { x: 0, y: from + s * length, along: s * length, ring };
  });
  // 貼圖的 V 是照第一個剖面的周長比例排的，研磨帶的位置也用同一個剖面算。
  return {
    geometry: loft(stations, { uPerMetre: 3, capStart: true }),
    material: materials.blade(ringBands(stations[0]!.ring, DIAMOND_EDGE_FACES)),
  };
}

export function buildSpear(materials: Materials): Weapon {
  const builder = new Builder();
  const { shaftTo, socketTo, headTo, buttRadius, neckRadius } = SPEAR;

  // 白蠟桿：由尾到頭明顯收細。
  const shaft: [number, number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    // 前三分之一收得快一些（白蠟桿的梢）。
    const radius = lerp(buttRadius, neckRadius, Math.pow(t, 1.25));
    shaft.push([t * shaftTo, radius, radius]);
  }
  builder.add(tube(shaft, { uPerMetre: 0.9, capStart: true, segments: 28 }), materials.waxwood);

  // 槍鐏：尾端的銅套。
  const butt = new LatheGeometry(
    [
      new Vector2(0.0001, -0.05),
      new Vector2(0.006, -0.046),
      new Vector2(0.0145, -0.02),
      new Vector2(0.0198, 0.0),
      new Vector2(0.0204, 0.03),
      new Vector2(0.0192, 0.034),
    ],
    32,
  );
  builder.add(butt, materials.brass);

  // 槍庫：套住桿梢的錐形鋼套，兩端各一道箍。
  const socket = new LatheGeometry(
    [
      new Vector2(0.0118, shaftTo - 0.03),
      new Vector2(0.0142, shaftTo - 0.027),
      new Vector2(0.0146, shaftTo - 0.021),
      new Vector2(0.0128, shaftTo - 0.017),
      new Vector2(0.0122, shaftTo),
      new Vector2(0.0092, socketTo - 0.02),
      new Vector2(0.0112, socketTo - 0.016),
      new Vector2(0.0116, socketTo - 0.01),
      new Vector2(0.0096, socketTo - 0.006),
      new Vector2(0.0076, socketTo),
    ],
    36,
  );
  builder.add(socket, materials.steel);

  const head = spearHead(materials);
  builder.add(head.geometry, head.material);

  // 紅纓：繫在槍庫下緣。紮線固定在桿上；纓本身是掛著的，順著重力垂下來（viewer 每格把它轉回朝下）。
  const tieY = shaftTo - 0.03;
  const tie = new TorusGeometry(0.0142, 0.0026, 8, 28);
  tie.rotateX(Math.PI / 2);
  tie.translate(0, tieY + 0.002, 0);
  builder.add(tie, materials.tasselDeep);

  const pendulum = new Group();
  pendulum.position.set(0, tieY, 0);
  // 外層鮮紅、內層深一點，才有厚度。
  builder.add(
    hangingFringe({ count: 190, locks: 11, top: 0.014, length: SPEAR_TASSEL, spread: 0.03, radius: 0.00105, seed: 211 }),
    materials.tassel,
    pendulum,
  );
  builder.add(
    hangingFringe({ count: 110, locks: 7, top: 0.008, length: SPEAR_TASSEL * 0.9, spread: 0.018, radius: 0.00105, seed: 223 }),
    materials.tasselDeep,
    pendulum,
  );
  builder.root.add(pendulum);

  return {
    kind: 'spear',
    root: builder.root,
    tip: headTo,
    butt: -0.05,
    clearance: 0.03,
    drop: SPEAR_TASSEL,
    pendulums: [pendulum],
    dispose: () => builder.dispose(),
  };
}

export function buildWeapon(kind: WeaponKind, materials: Materials): Weapon {
  if (kind === 'jian') return buildJian(materials);
  if (kind === 'miaodao') return buildMiaodao(materials);
  return buildSpear(materials);
}
