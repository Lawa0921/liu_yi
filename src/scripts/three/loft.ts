// 程式建模的基礎：把一串剖面（ring）沿著一條平面曲線放樣成實體。
// 劍身、刀身、槍頭、劍鞘、刀柄都用它；稜線與刃口是真的幾何折角，高光才會成一條線。
//
// 座標：兵器的長軸在 XY 平面上（直的兵器就是 +Y），剖面的 u 是「寬」（在 XY 平面內、垂直於長軸），
// z 是「厚」。每個剖面點可標 smooth：相鄰兩個面在這一點共用頂點（法線平滑）；沒標就是硬折角。

import { BufferAttribute, BufferGeometry } from 'three';

export interface RingPoint {
  u: number;
  z: number;
  smooth?: boolean;
}

export interface Station {
  /** 剖面中心在 XY 平面上的位置。 */
  x: number;
  y: number;
  /** 長軸在這裡的方向（弧度，由 +Y 往 -X 量）；直的兵器是 0。 */
  bend?: number;
  /** 沿長軸的距離（公尺），當作貼圖的 U。 */
  along: number;
  ring: RingPoint[];
}

export interface LoftOptions {
  capStart?: boolean;
  capEnd?: boolean;
  /** 貼圖 U 每公尺重複幾次。 */
  uPerMetre?: number;
}

export function loft(stations: Station[], options: LoftOptions = {}): BufferGeometry {
  const { capStart = false, capEnd = false, uPerMetre = 1 } = options;
  const ringSize = stations[0]!.ring.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // 每個剖面點在每個站各有「這一面的起點」與「上一面的終點」兩個頂點；smooth 的點兩者共用。
  const startIndex: number[][] = [];
  const endIndex: number[][] = [];

  // 剖面周長（用第一個不是收成一點的站來量），當作貼圖的 V。
  const reference = stations.find((s) => s.ring.some((p) => Math.abs(p.u) + Math.abs(p.z) > 1e-6))!.ring;
  const cumulative = [0];
  for (let j = 0; j < ringSize; j++) {
    const a = reference[j]!;
    const b = reference[(j + 1) % ringSize]!;
    cumulative.push(cumulative[j]! + Math.hypot(b.u - a.u, b.z - a.z));
  }
  const perimeter = cumulative[ringSize]! || 1;

  stations.forEach((station, i) => {
    const bend = station.bend ?? 0;
    // 寬的方向：長軸方向（-sin, cos）順時針轉 90° →（cos, sin）。
    const wx = Math.cos(bend);
    const wy = Math.sin(bend);
    startIndex[i] = [];
    endIndex[i] = [];
    const push = (point: RingPoint, v: number) => {
      positions.push(station.x + wx * point.u, station.y + wy * point.u, point.z);
      uvs.push(station.along * uPerMetre, v);
      return positions.length / 3 - 1;
    };
    for (let j = 0; j < ringSize; j++) {
      const point = station.ring[j]!;
      const v = cumulative[j]! / perimeter;
      const index = push(point, v);
      startIndex[i]![j] = index;
      // 接縫（j=0）的終點要用 V=1，不能共用。
      endIndex[i]![j] = point.smooth && j !== 0 ? index : push(point, j === 0 ? 1 : v);
    }
  });

  for (let i = 0; i < stations.length - 1; i++) {
    for (let j = 0; j < ringSize; j++) {
      const next = (j + 1) % ringSize;
      const a = startIndex[i]![j]!;
      const b = endIndex[i]![next]!;
      const c = endIndex[i + 1]![next]!;
      const d = startIndex[i + 1]![j]!;
      indices.push(a, b, c, a, c, d);
    }
  }

  const cap = (stationIndex: number, flip: boolean) => {
    const station = stations[stationIndex]!;
    const bend = station.bend ?? 0;
    const wx = Math.cos(bend);
    const wy = Math.sin(bend);
    const first = positions.length / 3;
    for (const point of station.ring) {
      positions.push(station.x + wx * point.u, station.y + wy * point.u, point.z);
      uvs.push(point.u * 10 + 0.5, point.z * 10 + 0.5);
    }
    for (let j = 1; j < ringSize - 1; j++) {
      if (flip) indices.push(first, first + j + 1, first + j);
      else indices.push(first, first + j, first + j + 1);
    }
  };
  if (capStart) cap(0, true);
  if (capEnd) cap(stations.length - 1, false);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  orientOutward(geometry, stations);
  return geometry;
}

/** 法線若整體朝內（剖面點的繞向相反），把三角形反過來。 */
function orientOutward(geometry: BufferGeometry, stations: Station[]): void {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const middle = stations[Math.floor(stations.length / 2)]!;
  let score = 0;
  for (let i = 0; i < position.count; i++) {
    // 只看離中段最近的頂點就夠判斷了。
    const dy = position.getY(i) - middle.y;
    const dx = position.getX(i) - middle.x;
    if (dx * dx + dy * dy > 0.01) continue;
    score += normal.getX(i) * dx + normal.getY(i) * dy + normal.getZ(i) * position.getZ(i);
  }
  if (score >= 0) return;
  const index = geometry.getIndex()!;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  geometry.computeVertexNormals();
}

/** 橢圓剖面（全部平滑），給鞘、柄這類圓滑的東西。 */
export function ellipseRing(halfWidth: number, halfThickness: number, segments = 20): RingPoint[] {
  return Array.from({ length: segments }, (_, j) => {
    const angle = (j / segments) * Math.PI * 2;
    return { u: Math.cos(angle) * halfWidth, z: Math.sin(angle) * halfThickness, smooth: true };
  });
}

/**
 * 雙刃的菱形剖面：中央一道劍脊，兩側斜面微微鼓起（蛤刃），靠刃口再折一道小斜面。
 *   width 全寬、thickness 脊的全厚、edge 刃口小斜面的寬、edgeThickness 小斜面起點的全厚。
 */
export function diamondRing(width: number, thickness: number, edge: number, edgeThickness: number): RingPoint[] {
  const w = width / 2;
  const t = thickness / 2;
  const e = Math.min(edge, w * 0.45);
  const te = Math.min(edgeThickness / 2, t * 0.6);
  const shoulder = w - e;
  // 斜面中點：在脊與小斜面起點的連線上再鼓出一點點。
  const midU = shoulder * 0.5;
  const midZ = (t + te) / 2 + t * 0.07;
  return [
    { u: w, z: 0 },
    { u: shoulder, z: te },
    { u: midU, z: midZ, smooth: true },
    { u: 0, z: t },
    { u: -midU, z: midZ, smooth: true },
    { u: -shoulder, z: te },
    { u: -w, z: 0 },
    { u: -shoulder, z: -te },
    { u: -midU, z: -midZ, smooth: true },
    { u: 0, z: -t },
    { u: midU, z: -midZ, smooth: true },
    { u: shoulder, z: -te },
  ];
}

/**
 * 剖面上某幾個面（第 j 個面是第 j 點到第 j+1 點）在貼圖 V 上佔的區段。
 * 和 loft() 算 V 的方式一致（依周長比例），給「刃口研磨帶」這類只落在特定面上的貼圖用。
 */
export function ringBands(ring: RingPoint[], faces: number[]): [number, number][] {
  const cumulative = [0];
  for (let j = 0; j < ring.length; j++) {
    const a = ring[j]!;
    const b = ring[(j + 1) % ring.length]!;
    cumulative.push(cumulative[j]! + Math.hypot(b.u - a.u, b.z - a.z));
  }
  const perimeter = cumulative[ring.length]! || 1;
  return faces.map((j) => [cumulative[j]! / perimeter, cumulative[j + 1]! / perimeter]);
}

/** diamondRing() 裡屬於刃口小斜面的四個面。 */
export const DIAMOND_EDGE_FACES = [0, 5, 6, 11];
