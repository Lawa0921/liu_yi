/**
 * `npm run qi:snapshot-weapons`：把 `src/scripts/three/weapons.ts` 建出來的三件兵器（劍、苗刀、大槍）
 * 存成 `src/qi/data/weapons/{jian,miaodao,spear}.geo`（D29）。快照入庫；建置與執行時都不 import `weapons.ts`，
 * 只有這個腳本（與 `tests/unit/qi-weapon-snapshot.test.ts` 的比對）會載入它。改了 `weapons.ts` 的造型就要重跑一次。
 *
 * 材質：`weapons.ts` 的建模函式要一組材質，這裡只要幾何，所以給一組只帶 `userData.cls` 的空殼
 * （搬自已刪除的 /lab/ 試作的 `shapes.ts`（歷史在 commit `e56a090`） 的 `taggedMaterials`）：2 鋼、3 銅、4 紅纓、5 暗色（柄、桿）。
 * 同一種 cls 的 mesh 併成一個零件（鋼、銅、紅纓、暗色各最多一個）：取樣的面積權重（面積^0.6 × 種類加權）以零件為單位，
 * 若維持一個 mesh 一個零件，許多細小的銅箍、劍首會因為開次方而各自分到過多的點，把鋼與暗色擠掉。
 *
 * 兩個與試作相同的處理：
 *   - 劍鞘拿掉（它會把整把劍的刃蓋住，取樣只要刃與柄）；
 *   - 纓穗繞自己的紮點轉 +90°（Z 軸）：快照座標系的長軸是 +Y，纓穗原本垂在長軸上（−Y）；取樣時長軸平放到 +x，
 *     這時朝 +X 的纓穗剛好朝下（世界的 −y），不會順著桿或劍身躺平。
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Mesh, MeshBasicMaterial } from 'three';
import { buildJian, buildMiaodao, buildSpear, type Weapon } from '../../src/scripts/three/weapons';
import type { Materials } from '../../src/scripts/three/materials';
import { encodeSnapshot, type WeaponPart, type WeaponSnapshot } from '../../src/qi/shapes/weapon-snapshot';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WEAPONS_TS = 'src/scripts/three/weapons.ts';
const OUT_DIR = resolve(ROOT, 'src/qi/data/weapons');

export const WEAPON_NAMES = ['jian', 'miaodao', 'spear'] as const;
type Name = (typeof WEAPON_NAMES)[number];

const CLASS_STEEL = 2;
const CLASS_BRASS = 3;
const CLASS_RED = 4;
const CLASS_DARK = 5;

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

function build(name: Name, materials: Materials): Weapon {
  return name === 'jian' ? buildJian(materials) : name === 'miaodao' ? buildMiaodao(materials) : buildSpear(materials);
}

/** 把同一種 cls 的幾個零件併成一個（頂點串接、索引加上位移）。 */
function mergeParts(cls: WeaponPart['cls'], list: WeaponPart[]): WeaponPart {
  const vertices = list.reduce((sum, p) => sum + p.positions.length / 3, 0);
  const positions = new Float32Array(vertices * 3);
  const indices = new Uint32Array(list.reduce((sum, p) => sum + p.indices.length, 0));
  let vertexAt = 0;
  let indexAt = 0;
  for (const part of list) {
    positions.set(part.positions, vertexAt * 3);
    for (let i = 0; i < part.indices.length; i++) indices[indexAt + i] = part.indices[i]! + vertexAt;
    vertexAt += part.positions.length / 3;
    indexAt += part.indices.length;
  }
  return { cls, positions, indices };
}

/** 建一件兵器並轉成快照（座標沿用 weapons.ts：長軸 +Y、公尺）。 */
export function buildSnapshot(name: Name, sourceHash?: string): WeaponSnapshot {
  const weapon = build(name, taggedMaterials());
  if (weapon.sheath) weapon.root.remove(weapon.sheath);
  for (const pendulum of weapon.pendulums) pendulum.rotation.z = Math.PI / 2;
  weapon.root.updateMatrixWorld(true);

  const byClass = new Map<WeaponPart['cls'], WeaponPart[]>();
  weapon.root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const cls = (object.material as MeshBasicMaterial).userData.cls as WeaponPart['cls'] | undefined;
    if (cls === undefined) throw new Error(`${name} 有 mesh 沒有 cls 標記`);

    const e = object.matrixWorld.elements;
    const positions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      positions[i * 3] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      positions[i * 3 + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      positions[i * 3 + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
    }
    const indices = new Uint32Array(index ? index.count : position.count);
    if (index) for (let i = 0; i < index.count; i++) indices[i] = index.getX(i);
    else for (let i = 0; i < indices.length; i++) indices[i] = i;
    if (indices.length === 0) return;
    const list = byClass.get(cls) ?? [];
    list.push({ cls, positions, indices });
    byClass.set(cls, list);
  });
  weapon.dispose();
  const parts = ([CLASS_STEEL, CLASS_BRASS, CLASS_RED, CLASS_DARK] as const).flatMap((cls) => {
    const list = byClass.get(cls);
    return list ? [mergeParts(cls, list)] : [];
  });

  const snapshot: WeaponSnapshot = { name, tip: weapon.tip, butt: weapon.butt, parts };
  if (sourceHash !== undefined) snapshot.sourceHash = sourceHash;
  return snapshot;
}

/** `weapons.ts` 的 git hash-object（只讀，不寫入 object database）。 */
function weaponsSourceHash(): string {
  const out = execFileSync('git', ['hash-object', WEAPONS_TS], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (!/^[0-9a-f]{40}$/.test(out)) throw new Error(`git hash-object 回傳了不認得的內容：${out}`);
  return out;
}

function main(): void {
  const hash = weaponsSourceHash();
  mkdirSync(OUT_DIR, { recursive: true });
  let total = 0;
  for (const name of WEAPON_NAMES) {
    const snapshot = buildSnapshot(name, hash);
    const bytes = encodeSnapshot(snapshot);
    writeFileSync(resolve(OUT_DIR, `${name}.geo`), bytes);
    total += bytes.byteLength;
    const triangles = snapshot.parts.reduce((sum, p) => sum + p.indices.length / 3, 0);
    console.log(`${name}.geo  ${(bytes.byteLength / 1024).toFixed(1)} KB  零件 ${snapshot.parts.length}  三角面 ${triangles}`);
  }
  console.log(`合計 ${(total / 1024).toFixed(1)} KB  weapons.ts ${hash}`);
}

// 被 import（測試）時不執行；`tsx scripts/qi/snapshot-weapons.ts` 直接跑才產檔。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
