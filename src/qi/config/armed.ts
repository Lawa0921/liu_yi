/**
 * 持械形體的設定（Task 27）：首頁兵器三段（劍、苗刀、大槍）與小孩的持劍，光點聚成「拳師拿著兵器」，不再是單獨一把兵器。
 *
 * 每一筆：
 *   - `src`：`src/assets/silhouettes/` 下的剪影（`fig-jian`、`fig-miaodao`、`fig-daqiang`、`fig-kid-weapon`、`fig-kid-miaodao`、`fig-kid-daqiang`，剪影裡的人本來就拿著兵器）。
 *   - `headPx`／`scaleOverride`：與 `config/figures.ts` 同一套比例規則（頭部對齊落地那張，`scale = land.headPx / headPx`）。持械的架勢列寬輪廓裡沒有
 *     可靠的頸谷（兵器的細線也算進列寬），所以 `headPx` 是看圖量的（剪影的頭頂到頸與肩交界的高度，註解寫在各筆）。
 *   - `weapon`：用哪一件兵器的幾何（`src/qi/data/weapons/<name>.geo`；小孩的劍用劍的幾何，縮在較短的軸上）。
 *   - `spec`：剪影裡兵器的鋒尖與尾端（原圖 px，y 向下）、要從剪影剔掉的區域（`shapes/sample-armed.ts` 的 `EraseSpec`：兵器的膠囊與垂下來的纓穗，
 *     但手與頭的「保留圈」不剔）、兵器點占的比例。這些座標是對著剪影量的（`tests/unit/qi-armed-assets.test.ts` 驗：軸穿過手、鋒尖與尾端落在兵器上、
 *     剔掉之後人形仍是單一連通的一塊）。
 */

/** 沿一條線段、半寬 `r` 的區域（原圖 px）。 */
export interface Capsule {
  a: [number, number];
  b: [number, number];
  r: number;
}

export interface EraseSpec {
  capsules?: Capsule[];
  /** 矩形 [x0, y0, x1, y1]（含邊界，原圖 px）。 */
  rects?: [number, number, number, number][];
  /** 保留圈 [cx, cy, r]：圈內的像素不剔（手、頭）。 */
  keep?: [number, number, number][];
}

export interface ArmedSpec {
  /** 剪影裡兵器的鋒尖與尾端（原圖 px，y 向下）。 */
  tip: [number, number];
  butt: [number, number];
  erase: EraseSpec;
  /** 兵器點占全部點的比例（0–1，不含端點）。 */
  weaponShare: number;
  /** 兵器的點裡貼在表面（相對於貼著兵器的氣）的比例；不給就是 `sampleWeapon` 的預設 0.3。 */
  surfaceShare?: number;
}

export interface ArmedDef {
  /** `src/assets/silhouettes/` 下的檔名，無副檔名。 */
  src: string;
  /** 原圖中的頭高（px，看圖量；見各筆註解）。 */
  headPx: number;
  weapon: 'jian' | 'miaodao' | 'spear';
  spec: ArmedSpec;
}

export type ArmedId = 'jian' | 'miaodao' | 'spear' | 'kid-weapon' | 'kid-miaodao' | 'kid-spear';

export const ARMED: Record<ArmedId, ArmedDef> = {
  // 劍：弓步刺劍，劍朝左平伸。頭頂 y = 8、頸與肩的交界約 y = 135 → 頭高 127。
  // 劍身與護手在 x < 303（y 128–182），劍柄在拳裡（x 305–365），劍穗從柄尾垂下（x 335–380、y 186–330）：都剔掉，換成劍的幾何。
  jian: {
    src: 'fig-jian',
    headPx: 127,
    weapon: 'jian',
    spec: {
      tip: [8, 157],
      butt: [362, 152],
      erase: { rects: [[0, 126, 303, 184], [334, 188, 380, 332]] },
      weaponShare: 0.3,
      surfaceShare: 0.5,
    },
  },
  // 苗刀：雙手高舉長刀，刀身斜過頭頂。頭頂 y = 210、頸與肩的交界約 y = 335 → 頭高 125。
  // 刀身從左上的鋒尖（6, 10）斜到右下的刀柄尾（757, 385）；刀身穿過頭（保留圈，不然會在頭上挖洞）與兩隻手。
  // 剪影的刀身是弧的（中段比鋒尖與刀柄的連線低約 35 px），所以剔除用一串膠囊貼著弧走；兵器幾何則放在鋒尖到刀柄尾的連線上。
  miaodao: {
    src: 'fig-miaodao',
    headPx: 125,
    weapon: 'miaodao',
    spec: {
      tip: [6, 10],
      butt: [757, 385],
      erase: {
        capsules: [
          { a: [6, 10], b: [120, 96], r: 30 },
          { a: [120, 96], b: [300, 188], r: 30 },
          { a: [300, 188], b: [412, 232], r: 30 },
          { a: [537, 288], b: [757, 388], r: 26 },
        ],
        keep: [[472, 275, 68], [575, 312, 40], [700, 362, 38]],
      },
      weaponShare: 0.34,
      surfaceShare: 0.55,
    },
  },
  // 大槍（Task 27 重生，1536×1024 橫式畫布，後處理成 1378×600）：弓步平扎，槍朝左平伸、槍桿微微往右下斜（約 2°）。前手在 (575, 182) 握槍桿、
  // 後手在 (1097, 218) 握槍桿尾段（槍桿從拳後露出到 x = 1357），兩手都在槍桿線上。頭頂 y = 8、頸與肩的交界約 y = 120 → 頭高 112。
  // 槍頭、纓與前手之前的槍桿在 x < 538；後手之後露出的槍尾在 x > 1122：都剔掉，換成大槍的幾何；兩隻手與身體（槍桿在身體前面的那一段與身體黏在一起）保留。
  spear: {
    src: 'fig-daqiang',
    headPx: 112,
    weapon: 'spear',
    spec: {
      tip: [8, 167],
      butt: [1357, 217],
      erase: { rects: [[0, 140, 538, 292], [1122, 195, 1378, 238]] },
      weaponShare: 0.44,
      surfaceShare: 0.66,
    },
  },
  // 小孩持劍：單手握劍斜指右上。頭高沿用 `FIGURES['kid-weapon']` 的量測值（171）。
  // 劍身與護手從拳（362, 318）往右上到鋒尖（693, 10）；握劍的拳是保留圈。
  'kid-weapon': {
    src: 'fig-kid-weapon',
    headPx: 171,
    weapon: 'jian',
    spec: {
      tip: [693, 10],
      butt: [328, 327],
      erase: { capsules: [{ a: [372, 288], b: [700, 4], r: 24 }], rects: [[352, 240, 420, 308]], keep: [[362, 322, 42]] },
      weaponShare: 0.26,
      surfaceShare: 0.5,
    },
  },
  // 小孩持刀（Task 27 追加，用 `tools/silhouettes` 產線生成，854×1177）：站姿雙手握長刀，刀斜指右上、安全朝上，沒有對人。頭頂 y = 245、頸與肩的交界約 y = 405 → 頭高 160。
  // 刀從拳（380, 555）往右上到鋒尖（843, 12）：剪影的刀身是弧的（比弦凸約 15 px），剔除用一串膠囊貼著弧走；握刀的兩隻拳（x 360–450、y 490–590）是保留圈。
  'kid-miaodao': {
    src: 'fig-kid-miaodao',
    headPx: 160,
    weapon: 'miaodao',
    spec: {
      tip: [843, 12],
      butt: [380, 560],
      erase: {
        capsules: [
          { a: [843, 12], b: [760, 130], r: 28 },
          { a: [760, 130], b: [640, 265], r: 32 },
          { a: [640, 265], b: [520, 400], r: 32 },
          { a: [520, 400], b: [440, 490], r: 32 },
        ],
        rects: [[395, 455, 465, 495]],
        keep: [[390, 548, 72]],
      },
      weaponShare: 0.3,
      surfaceShare: 0.5,
    },
  },
  // 小孩持槍（Task 27 追加，1213×574，橫式）：低弓步向前扎槍（指向空處），前手在 (470, 205) 握槍桿、後手在 (930, 235) 握槍桿尾段，槍桿在身體前面、微微往右下斜。
  // 頭頂 y = 8、頸與肩的交界約 y = 145 → 頭高 135。槍頭、纓與前手之前的槍桿在 x < 432；後手之後露出的槍尾在 x > 990。
  'kid-spear': {
    src: 'fig-kid-daqiang',
    headPx: 135,
    weapon: 'spear',
    spec: {
      tip: [8, 200],
      butt: [1147, 228],
      erase: { rects: [[0, 160, 432, 275], [990, 208, 1213, 245]] },
      weaponShare: 0.46,
      surfaceShare: 0.7,
    },
  },
};
