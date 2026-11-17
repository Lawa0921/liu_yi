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
  // 苗刀（Task 27 第 2 輪重生，1536×1024 橫式畫布，後處理成 1240×570）：弓步撩刀，雙手握長柄在右髖，刀身在身前往左上伸（約 24°），不穿過頭與肩；
  // 原本是雙手高舉過頭、刀身斜過頭頂，像日本劍道的上段，違反設計 §4 的反目標。頭頂 y = 22、頸與肩的交界約 y = 154 → 頭高 132；低弓步的人形整體很矮（身高 554 px），所以 headPx 取 120（比量到的小一些，人形放大一點，整體外框高才過 1.2 世界單位的下限，也比小孩高一截）。
  // 刀身從左上的鋒尖（8, 12）往右下到圓盤護手（536, 243）；前拳（578, 258）握在護手之後，後拳（720, 303）在右髖；剪影的刀身是弧的（中段比弦低約 25 px），
  // 剔除用一串膠囊貼著弧走（厚度 23 px，半徑 17）；護手在 x 522–552（保留前拳的圈蓋住 x ≥ 546）。兵器幾何依「護手在整支兵器的 68.2% 處」放在鋒尖到柄尾的連線上：
  // 柄尾 = 鋒尖 + (鋒尖到護手的距離 ÷ 0.682) × 方向，落在髖後的身體裡（(783, 349)），護手才會落在剪影的護手上。
  miaodao: {
    src: 'fig-miaodao',
    headPx: 120,
    weapon: 'miaodao',
    spec: {
      tip: [8, 12],
      butt: [783, 349],
      erase: {
        capsules: [
          { a: [8, 12], b: [100, 66], r: 17 },
          { a: [100, 66], b: [190, 109], r: 17 },
          { a: [190, 109], b: [280, 148], r: 17 },
          { a: [280, 148], b: [370, 183], r: 17 },
          { a: [370, 183], b: [460, 216], r: 17 },
          { a: [460, 216], b: [524, 238], r: 17 },
        ],
        rects: [[520, 212, 552, 272]],
        keep: [[580, 258, 34]],
      },
      weaponShare: 0.42,
      surfaceShare: 0.65,
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
  // 小孩持刀（Task 27 追加，第 2 輪重生，1536×1024 橫式畫布，後處理成 1238×620）：低弓步前指，雙手握長柄在右髖，刀身在身前往左、只略朝上（約 8°），指向空處；
  // 原本是直立雙手持刀、刀尖朝上，像日本劍道的架勢。頭頂 y = 8、頸與肩的交界約 y = 172 → 頭高 172；整體外框高要 ≥ 1.2 世界單位，所以 headPx 取 150（約是大人的 87% 高）。
  // 刀身從左邊的鋒尖（8, 206）往右到圓盤護手（545, 286）；前拳（585, 290）、後拳（655, 292）；剔除與柄尾的算法同大人苗刀（柄尾 (795, 323)）。
  'kid-miaodao': {
    src: 'fig-kid-miaodao',
    headPx: 150,
    weapon: 'miaodao',
    spec: {
      tip: [8, 206],
      butt: [795, 323],
      erase: {
        capsules: [
          { a: [8, 206], b: [100, 230], r: 16 },
          { a: [100, 230], b: [190, 245], r: 16 },
          { a: [190, 245], b: [280, 257], r: 16 },
          { a: [280, 257], b: [370, 268], r: 16 },
          { a: [370, 268], b: [460, 277], r: 16 },
          { a: [460, 277], b: [524, 284], r: 16 },
        ],
        rects: [[534, 250, 556, 324]],
        keep: [[588, 290, 30]],
      },
      weaponShare: 0.34,
      surfaceShare: 0.55,
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
