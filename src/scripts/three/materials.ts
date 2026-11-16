// 兵器的材質。顏色全部從 tokens.css 的語意色變數讀（--color-steel、--color-brass…），這裡不寫死色碼。
//   鋼：高金屬度、很低的粗糙度（鏡面）——暗場裡大部分是深色，只有映到燈條的地方是銳利的亮帶。
//       順刃的拉絲、極淡的鍛紋、刃口的研磨帶（霧面）都在粗糙度貼圖裡。
//   銅件：舊化的古金（深淺斑駁）；劍格與盤護另有回紋浮雕，凸處磨亮、凹處積暗。
//   木、纏繩、漆、纓：非金屬。

import { Color, DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial } from 'three';
import { applyForge, createForgeUniforms, type ForgeUniforms } from './forge';
import { agedBrass, bladeRoughness, brushedRoughness, cordWrap, fretBrass, rippleNormal, woodGrain, type Band } from './textures';

export interface Palette {
  steel: string;
  brass: string;
  waxwood: string;
  waxwoodGrain: string;
  hilt: string;
  hiltGrain: string;
  cord: string;
  cordCool: string;
  scabbard: string;
  tassel: string;
  tasselDeep: string;
}

const TOKENS: Record<keyof Palette, string> = {
  steel: '--color-steel',
  brass: '--color-brass',
  waxwood: '--color-waxwood',
  waxwoodGrain: '--color-waxwood-grain',
  hilt: '--color-hilt',
  hiltGrain: '--color-hilt-grain',
  cord: '--color-cord',
  cordCool: '--color-cord-cool',
  scabbard: '--color-scabbard',
  tassel: '--color-seal-strong',
  tasselDeep: '--color-seal',
};

export function readPalette(root: Element = document.documentElement): Palette {
  const style = getComputedStyle(root);
  const palette = {} as Palette;
  for (const key of Object.keys(TOKENS) as (keyof Palette)[]) {
    palette[key] = style.getPropertyValue(TOKENS[key]).trim();
  }
  return palette;
}

export interface Materials {
  /** 車出來的鋼件（槍庫）：沒有研磨帶。 */
  steel: MeshPhysicalMaterial;
  /** 刃：edges 是剖面一周裡屬於刃口小斜面的區段（研磨帶）。同樣的區段只建一次。 */
  blade(edges: Band[]): MeshPhysicalMaterial;
  /** 箍、劍首、吞口：舊化的古金銅件。 */
  brass: MeshPhysicalMaterial;
  /** 劍格、盤護：回紋浮雕的銅件。 */
  brassFret: MeshPhysicalMaterial;
  /** 白蠟桿。 */
  waxwood: MeshPhysicalMaterial;
  /** 劍鞘：暗紅漆。 */
  lacquer: MeshPhysicalMaterial;
  /** 劍柄的藏青纏繩。 */
  cordCool: MeshStandardMaterial;
  /** 苗刀柄的褐色纏繩。 */
  cord: MeshStandardMaterial;
  /** 纓、穗。 */
  tassel: MeshStandardMaterial;
  tasselDeep: MeshStandardMaterial;
  /** 淬火成形的共用參數（這個檢視器的所有兵器材質共用）。 */
  forge: ForgeUniforms;
  dispose(): void;
}

/** 劍柄與苗刀柄各纏幾圈（幾何上的繩圈也用這個數）。 */
export const JIAN_TURNS = 19;
export const MIAO_TURNS = 23;

/** 刃面的粗糙度（很低：鏡面）與刃口研磨帶的粗糙度（霧面）。 */
const FACE_ROUGHNESS = 0.11;
const GROUND_ROUGHNESS = 0.42;

export function createMaterials(palette: Palette): Materials {
  const disposables: { dispose(): void }[] = [];
  const forge = createForgeUniforms(palette.tassel, palette.brass);
  const keep = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    // 每個兵器材質的著色器都插進淬火的那一段。
    if (item instanceof MeshStandardMaterial) applyForge(item, forge);
    return item;
  };

  const steelRipple = keep(rippleNormal(0.1));
  const steelColor = new Color(palette.steel);

  const makeSteel = (edges: Band[] | null) => {
    const roughnessMap = keep(edges ? bladeRoughness(FACE_ROUGHNESS, GROUND_ROUGHNESS, edges) : brushedRoughness(0.2));
    return keep(
      new MeshPhysicalMaterial({
        color: steelColor,
        metalness: 1,
        // 粗糙度全由貼圖決定（刃面約 0.11、研磨帶約 0.42）。
        roughness: 1,
        roughnessMap,
        // 沿刃方向極緩的起伏（只擺幾度）：燈條映在刃上才會分成一段一段、隨轉動滑過去的光帶。
        // 不用 MeshPhysicalMaterial 的 anisotropy：three 對環境反射的各向異性是把法線往視線方向「折」，
        // 平的刃面一折，沿刃方向的變化就被抹平，整面只剩一個亮度（實測）。
        normalMap: steelRipple,
        envMapIntensity: 1,
      }),
    );
  };

  const steel = makeSteel(null);
  const blades = new Map<string, MeshPhysicalMaterial>();
  const blade = (edges: Band[]) => {
    const key = edges.map(([from, to]) => `${from.toFixed(4)}-${to.toFixed(4)}`).join('|');
    let material = blades.get(key);
    if (!material) {
      material = makeSteel(edges);
      blades.set(key, material);
    }
    return material;
  };

  const aged = agedBrass(palette.brass);
  keep(aged.map);
  keep(aged.roughness);
  const brass = keep(
    new MeshPhysicalMaterial({
      map: aged.map,
      metalness: 1,
      roughness: 1,
      roughnessMap: aged.roughness,
      envMapIntensity: 1.25,
    }),
  );

  const fret = fretBrass(palette.brass);
  keep(fret.map);
  keep(fret.roughness);
  keep(fret.bump);
  const brassFret = keep(
    new MeshPhysicalMaterial({
      map: fret.map,
      metalness: 1,
      roughness: 1,
      roughnessMap: fret.roughness,
      bumpMap: fret.bump,
      bumpScale: 1.1,
      envMapIntensity: 1.25,
    }),
  );

  const waxwoodMap = keep(woodGrain(palette.waxwood, palette.waxwoodGrain, 43, 5));
  const waxwood = keep(
    new MeshPhysicalMaterial({
      color: new Color(0.8, 0.76, 0.7),
      map: waxwoodMap,
      metalness: 0,
      roughness: 0.6,
      envMapIntensity: 0.9,
      // 白蠟桿被手盤得發亮：一層包漿，桿上會有一道順著長軸的亮線，看得出它是圓的、是木頭。
      clearcoat: 0.7,
      clearcoatRoughness: 0.2,
    }),
  );

  const lacquer = keep(
    new MeshPhysicalMaterial({
      color: new Color(palette.scabbard),
      metalness: 0,
      roughness: 0.42,
      clearcoat: 0.9,
      clearcoatRoughness: 0.16,
      envMapIntensity: 1,
    }),
  );

  const coolWrap = cordWrap(palette.cordCool, JIAN_TURNS);
  const brownWrap = cordWrap(palette.cord, MIAO_TURNS, 37);
  for (const texture of [coolWrap.map, coolWrap.bump, brownWrap.map, brownWrap.bump]) keep(texture);
  const makeCord = (wrap: typeof coolWrap) =>
    keep(
      new MeshStandardMaterial({
        map: wrap.map,
        bumpMap: wrap.bump,
        bumpScale: 2.4,
        metalness: 0,
        roughness: 0.95,
        envMapIntensity: 0.6,
      }),
    );
  const cordCool = makeCord(coolWrap);
  const cord = makeCord(brownWrap);

  // 朱紅要壓得住：太亮會被色調映射洗淡。
  const tassel = keep(
    new MeshStandardMaterial({
      color: new Color(palette.tassel).multiplyScalar(0.5),
      metalness: 0,
      roughness: 0.85,
      envMapIntensity: 0.3,
      side: DoubleSide,
    }),
  );
  const tasselDeep = keep(
    new MeshStandardMaterial({
      color: new Color(palette.tasselDeep).multiplyScalar(0.36),
      metalness: 0,
      roughness: 0.9,
      envMapIntensity: 0.3,
      side: DoubleSide,
    }),
  );

  return {
    steel,
    blade,
    brass,
    brassFret,
    waxwood,
    lacquer,
    cordCool,
    cord,
    tassel,
    tasselDeep,
    forge,
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
