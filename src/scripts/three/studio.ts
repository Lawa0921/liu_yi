// 攝影棚環境：一個深色的空間加幾條長條發光面板，經 PMREMGenerator 轉成環境貼圖。
// 金屬的質感幾乎全靠它——長條燈在長刃上反射成一道一道的光帶，兵器一轉，光帶就跟著流動。
// 不載 HDR 檔（設計文件 §15.1）。
//
// 鏡頭在 +Z 看向原點，所以正對鏡頭的刃面反射的是 +Z 那半邊：燈主要架在前上方一圈。

import {
  BackSide,
  BoxGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  PlaneGeometry,
  Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';

interface Panel {
  /** 面板中心的方向：方位角（繞 Y，0 是正前方 +Z，正值往 +X）與仰角，單位度。 */
  azimuth: number;
  elevation: number;
  distance: number;
  width: number;
  height: number;
  /** 面板在自己平面內的旋轉（度）：0 是長邊水平。 */
  roll: number;
  /** 亮度（HDR，可以遠大於 1）。 */
  intensity: number;
  /** 色調：warm 偏古金、cool 偏青白、white 中性。 */
  tone: 'white' | 'warm' | 'cool';
}

// 長條燈斜著架（roll 不是 0 或 90），兵器不論橫放、直立還是轉身，光帶都會斜斜地掃過刃面，而不是整面同時亮。
// 拋光的鋼是一面鏡子。暗場裡它大部分是深色的——映到的是暗的空間——只有映到燈條的地方是又窄又亮的光帶，
// 明暗的邊界很清楚。所以這裡的原則是：空間暗、燈條少而窄、亮度高。
//
// 燈條架成兩組交叉的斜向（一組往右上斜、一組往左上斜）：只架一個方向的話，刃的走向一和燈條平行，
// 整面就只剩一個亮度。交叉之後，兵器不論橫放、斜放還是直立，總有燈條斜斜地橫過刃面，
// 兵器一轉，光帶就沿著刃滑過去。往左上斜的那一組帶暖色：刃上的光帶白裡夾金，和站上的古金一路。
const LATTICE_ROLL = 58;
const strip = (elevation: number, roll: number, intensity: number, tone: Panel['tone']): Panel => ({
  azimuth: 0,
  elevation,
  distance: 5,
  width: 9,
  // 約 2.5° 寬：在刃上映成一道窄而銳利的亮帶。
  height: 0.22,
  roll,
  intensity,
  tone,
});
const PANELS: Panel[] = [
  // ── 往右上斜的一組（白） ──
  strip(-34, LATTICE_ROLL, 20, 'white'),
  strip(4, LATTICE_ROLL, 34, 'white'),
  strip(42, LATTICE_ROLL, 38, 'cool'),
  // ── 往左上斜的一組（暖） ──
  strip(-14, -LATTICE_ROLL, 24, 'warm'),
  strip(24, -LATTICE_ROLL, 30, 'warm'),
  strip(62, -LATTICE_ROLL, 28, 'white'),

  // ── 兩側直立的燈條：刃側著的時候靠它們 ──
  { azimuth: -88, elevation: 4, distance: 5, width: 0.3, height: 7, roll: -18, intensity: 24, tone: 'warm' },
  { azimuth: 88, elevation: 8, distance: 5, width: 0.3, height: 7, roll: 18, intensity: 20, tone: 'cool' },

  // ── 背後：刃口與桿邊緣的輪廓光 ──
  { azimuth: 158, elevation: 30, distance: 5, width: 7, height: 0.3, roll: 6, intensity: 16, tone: 'warm' },
  { azimuth: -142, elevation: 0, distance: 5, width: 0.3, height: 6, roll: 12, intensity: 14, tone: 'white' },
  { azimuth: 142, elevation: -6, distance: 5, width: 0.3, height: 6, roll: -12, intensity: 12, tone: 'warm' },

  // ── 頭頂一大片極暗的柔光：朝上的斜面是深鋼灰、朝下的斜面近黑，劍脊兩側才分得出明暗 ──
  { azimuth: 0, elevation: 80, distance: 9, width: 14, height: 12, roll: 0, intensity: 0.34, tone: 'cool' },
];

const TONES: Record<Panel['tone'], [number, number, number]> = {
  white: [1, 0.98, 0.95],
  warm: [1, 0.8, 0.52],
  cool: [0.82, 0.92, 1],
};

const RAD = Math.PI / 180;

export function createStudioEnvironment(renderer: WebGLRenderer, size = 256): Texture {
  const scene = new Scene();
  const disposables: { dispose(): void }[] = [];

  // 空間本身：很暗的冷灰。刃的「暗部」映到的就是它——深鋼灰，不是死黑（死黑的話，刃在黑底的頁面上會整把消失）。
  const roomGeometry = new BoxGeometry(24, 24, 24);
  const roomMaterial = new MeshBasicMaterial({ color: new Color(0.05, 0.054, 0.062), side: BackSide });
  scene.add(new Mesh(roomGeometry, roomMaterial));
  disposables.push(roomGeometry, roomMaterial);

  for (const panel of PANELS) {
    const geometry = new PlaneGeometry(panel.width, panel.height);
    const [r, g, b] = TONES[panel.tone];
    const material = new MeshBasicMaterial({
      color: new Color(r * panel.intensity, g * panel.intensity, b * panel.intensity),
      side: DoubleSide,
    });
    material.toneMapped = false;
    const mesh = new Mesh(geometry, material);
    const azimuth = panel.azimuth * RAD;
    const elevation = panel.elevation * RAD;
    mesh.position.set(
      Math.sin(azimuth) * Math.cos(elevation) * panel.distance,
      Math.sin(elevation) * panel.distance,
      Math.cos(azimuth) * Math.cos(elevation) * panel.distance,
    );
    // 面朝原點（lookAt 讓 +Z 朝外，所以材質要雙面），再在自己的平面內轉 roll。
    mesh.lookAt(mesh.position.clone().multiplyScalar(2));
    mesh.rotateZ(panel.roll * RAD);
    scene.add(mesh);
    disposables.push(geometry, material);
  }

  const pmrem = new PMREMGenerator(renderer);
  // sigma 是預先模糊的程度：一點點就好，燈條的邊才不會像刀切的一樣硬。
  const target = pmrem.fromScene(scene, 0.006, 0.1, 40, { size });
  pmrem.dispose();
  for (const item of disposables) item.dispose();
  return target.texture;
}
