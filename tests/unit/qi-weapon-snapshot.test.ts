import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../../scripts/qi/snapshot-weapons';
import { decodeSnapshot, encodeSnapshot, type WeaponPart, type WeaponSnapshot } from '../../src/qi/shapes/weapon-snapshot';

const NAMES = ['jian', 'miaodao', 'spear'] as const;
const geoUrl = (name: string) => new URL(`../../src/qi/data/weapons/${name}.geo`, import.meta.url);
const readGeo = (name: string): Uint8Array => new Uint8Array(readFileSync(geoUrl(name)));

/** 固定種子的小亂數，讓合成資料可重現。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makePart(cls: WeaponPart['cls'], vertices: number, seed: number): WeaponPart {
  const random = lcg(seed);
  const positions = new Float32Array(vertices * 3);
  for (let i = 0; i < vertices; i++) {
    positions[i * 3] = (random() - 0.5) * 0.08;
    positions[i * 3 + 1] = random() * 1.2 - 0.3;
    positions[i * 3 + 2] = (random() - 0.5) * 0.03;
  }
  const triangles = vertices - 2;
  const indices = new Uint32Array(triangles * 3);
  for (let t = 0; t < triangles; t++) {
    indices[t * 3] = t;
    indices[t * 3 + 1] = t + 1;
    indices[t * 3 + 2] = t + 2;
  }
  return { cls, positions, indices };
}

function makeSnapshot(): WeaponSnapshot {
  return {
    name: 'spear',
    tip: 3,
    butt: -0.05,
    sourceHash: '0123456789abcdef0123456789abcdef01234567',
    parts: [makePart(2, 40, 1), makePart(3, 17, 2), makePart(4, 64, 3), makePart(5, 9, 4)],
  };
}

/** 全部頂點的各軸外框與量化步長（用 u16 一格）。 */
function boundsOf(parts: WeaponPart[]) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    for (let i = 0; i < p.positions.length; i++) {
      const a = i % 3;
      if (p.positions[i]! < min[a]!) min[a] = p.positions[i]!;
      if (p.positions[i]! > max[a]!) max[a] = p.positions[i]!;
    }
  }
  return { min, max, step: max.map((v, a) => (v - min[a]!) / 65535) };
}

describe('兵器快照格式 QWG1：編解碼', () => {
  it('往返：名稱、tip／butt、零件種類與索引逐項還原，頂點誤差 ≤ 量化步長', () => {
    const source = makeSnapshot();
    const back = decodeSnapshot(encodeSnapshot(source));
    expect(back.name).toBe('spear');
    expect(back.tip).toBe(Math.fround(3));
    expect(back.butt).toBe(Math.fround(-0.05));
    expect(back.parts.map((p) => p.cls)).toEqual([2, 3, 4, 5]);
    const { step } = boundsOf(source.parts);
    source.parts.forEach((part, k) => {
      const got = back.parts[k]!;
      expect(got.positions.length).toBe(part.positions.length);
      expect(Array.from(got.indices)).toEqual(Array.from(part.indices));
      let worst = 0;
      for (let i = 0; i < part.positions.length; i++) {
        const error = Math.abs(got.positions[i]! - part.positions[i]!) / step[i % 3]!;
        if (error > worst) worst = error;
      }
      expect(worst).toBeLessThanOrEqual(1); // 以「步長」計：實際上取整只會差半格
    });
  });

  it('檔頭記錄 weapons.ts 的 git hash-object（40 位十六進位），解碼後原樣回來', () => {
    const bytes = encodeSnapshot(makeSnapshot());
    expect(new TextDecoder().decode(bytes.subarray(40, 80))).toBe('0123456789abcdef0123456789abcdef01234567');
    expect(decodeSnapshot(bytes).sourceHash).toBe('0123456789abcdef0123456789abcdef01234567');
  });

  it('沒給 sourceHash 時檔頭留空，解碼回 undefined', () => {
    const snapshot = makeSnapshot();
    delete snapshot.sourceHash;
    expect(decodeSnapshot(encodeSnapshot(snapshot)).sourceHash).toBeUndefined();
  });

  it('頂點數超過 65 535 的零件改用 u32 索引，仍能往返', () => {
    const vertices = 70000;
    const positions = new Float32Array(vertices * 3);
    for (let i = 0; i < positions.length; i++) positions[i] = (i % 977) / 977;
    const indices = new Uint32Array([0, 1, 2, 69997, 69998, 69999]);
    const back = decodeSnapshot(encodeSnapshot({ name: 'jian', tip: 1, butt: 0, parts: [{ cls: 2, positions, indices }] }));
    expect(Array.from(back.parts[0]!.indices)).toEqual([0, 1, 2, 69997, 69998, 69999]);
    expect(back.parts[0]!.positions.length).toBe(positions.length);
  });

  it('編碼拒絕不合法的輸入：未知種類、索引越界、索引數不是 3 的倍數、positions 長度不是 3 的倍數', () => {
    const base = makeSnapshot();
    expect(() => encodeSnapshot({ ...base, parts: [{ ...base.parts[0]!, cls: 6 as never }] })).toThrow(/cls/);
    expect(() => encodeSnapshot({ ...base, parts: [{ cls: 2, positions: new Float32Array(9), indices: new Uint32Array([0, 1, 3]) }] })).toThrow(/越界|範圍/);
    expect(() => encodeSnapshot({ ...base, parts: [{ cls: 2, positions: new Float32Array(9), indices: new Uint32Array([0, 1]) }] })).toThrow(/3 的倍數/);
    expect(() => encodeSnapshot({ ...base, parts: [{ cls: 2, positions: new Float32Array(8), indices: new Uint32Array(0) }] })).toThrow(/3 的倍數/);
  });

  it('解碼拒絕壞檔：魔數不符、版本不符、被截斷', () => {
    const good = encodeSnapshot(makeSnapshot());
    const badMagic = good.slice();
    badMagic[0] = 0x58;
    expect(() => decodeSnapshot(badMagic)).toThrow(/魔數/);
    const badVersion = good.slice();
    new DataView(badVersion.buffer).setUint16(4, 9, true);
    expect(() => decodeSnapshot(badVersion)).toThrow(/版本/);
    expect(() => decodeSnapshot(good.subarray(0, good.byteLength - 5))).toThrow(/長度|截斷/);
    expect(() => decodeSnapshot(good.subarray(0, 20))).toThrow(/長度|header/);
  });
});

describe('兵器快照檔 src/qi/data/weapons/*.geo（入庫的來源，D29）', () => {
  it('三個檔都在，單檔 ≤ 260 KB、合計 ≤ 600 KB', () => {
    let total = 0;
    for (const name of NAMES) {
      const size = statSync(geoUrl(name)).size;
      expect(size, `${name}.geo`).toBeLessThanOrEqual(260 * 1024);
      total += size;
    }
    expect(total).toBeLessThanOrEqual(600 * 1024);
  });

  it.each(NAMES)('%s：名稱對、零件非空、tip > butt、種類只有 2–5、索引都在範圍內、檔頭有 git hash', (name) => {
    const snapshot = decodeSnapshot(readGeo(name));
    expect(snapshot.name).toBe(name);
    expect(snapshot.parts.length).toBeGreaterThan(0);
    expect(snapshot.tip).toBeGreaterThan(snapshot.butt);
    expect(snapshot.sourceHash).toMatch(/^[0-9a-f]{40}$/);
    for (const part of snapshot.parts) {
      expect([2, 3, 4, 5]).toContain(part.cls);
      expect(part.positions.length % 3).toBe(0);
      expect(part.indices.length % 3).toBe(0);
      expect(part.indices.length).toBeGreaterThan(0);
      const vertices = part.positions.length / 3;
      let top = 0;
      for (const index of part.indices) if (index > top) top = index;
      expect(top).toBeLessThan(vertices);
    }
  });

  it.each(NAMES)('%s：同一種 cls 只有一個零件（取樣的面積權重以零件為單位）', (name) => {
    const classes = decodeSnapshot(readGeo(name)).parts.map((p) => p.cls);
    expect(new Set(classes).size).toBe(classes.length);
  });

  it('三件都有鋼（刃）與朱紅（纓）；劍與槍有紅纓，苗刀沒有；大槍的桿（暗色）在、劍鞘不在', () => {
    const classes = (name: string) => new Set(decodeSnapshot(readGeo(name)).parts.map((p) => p.cls));
    expect(classes('jian').has(2)).toBe(true);
    expect(classes('jian').has(4)).toBe(true);
    expect(classes('miaodao').has(2)).toBe(true);
    expect(classes('miaodao').has(4)).toBe(false);
    expect(classes('spear').has(4)).toBe(true);
    expect(classes('spear').has(5)).toBe(true);

    // 劍鞘（暗紅漆，會歸暗色）是一整條護著刃的長管；不入快照＝暗色零件只剩劍柄那麼長（< 0.3 m）。
    const jian = decodeSnapshot(readGeo('jian'));
    for (const part of jian.parts.filter((p) => p.cls === 5)) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 1; i < part.positions.length; i += 3) {
        lo = Math.min(lo, part.positions[i]!);
        hi = Math.max(hi, part.positions[i]!);
      }
      expect(hi - lo).toBeLessThan(0.3);
    }
  });

  it.each(NAMES)('%s：入庫的檔與現在的 weapons.ts 建出來的幾何一致（改了兵器就要重跑 npm run qi:snapshot-weapons）', (name) => {
    const stored = decodeSnapshot(readGeo(name));
    const fresh = decodeSnapshot(encodeSnapshot(buildSnapshot(name, stored.sourceHash)));
    expect(fresh.tip).toBe(stored.tip);
    expect(fresh.butt).toBe(stored.butt);
    expect(fresh.parts.length).toBe(stored.parts.length);
    fresh.parts.forEach((part, k) => {
      const old = stored.parts[k]!;
      expect(part.cls).toBe(old.cls);
      expect(Array.from(part.indices)).toEqual(Array.from(old.indices));
      expect(Array.from(part.positions)).toEqual(Array.from(old.positions));
    });
  });
});
