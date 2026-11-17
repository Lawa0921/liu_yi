/**
 * 姿勢與 beat 的對應（D17）：首頁每個 `[data-beat]` 段落在大人／小孩模式下各自聚成哪個形體，
 * 以及換到該姿勢時光點往哪裡炸（衝量）。
 *
 * `PoseId` 大多就是 `config/shapes.ts` 的 `SHAPES` 鍵（也是 `.bin` 檔名）。例外：
 *   - `flow`：緩緩飄浮的氣（全部光點都是低亮度的環境煙），程序化產生，沒有形體配方、沒有 `.bin`。
 *     Task 25 起不再屬於任何 beat（收費課表段改成 `scroll`），只在入館閘門期間當背景：閘門後的光點在這裡飄，按下「入館」才吸氣聚成拳師。
 *   - `lift`：只屬於開場時間軸（吸氣聚成抬腳），不對應任何 beat。
 *   - `seal`：朱印（Task 25 起預約段改成光點館徽 `crest`，朱印縮成按鈕旁的小型靜態印章）；形體檔保留但沒有任何 beat 載入它。
 *
 * 純資料與查表，不碰 three／DOM。
 */

export type Audience = 'adult' | 'kid';

export type BeatId =
  | 'opening'
  | 'fist'
  | 'combat-a'
  | 'combat-b'
  | 'weapon-a'
  | 'weapon-b'
  | 'weapon-c'
  | 'others'
  | 'coaches'
  | 'pricing'
  | 'booking';

export type PoseId =
  | 'lift'
  | 'land'
  | 'dingzhou'
  | 'chengchui'
  | 'kao'
  | 'jian'
  | 'miaodao'
  | 'spear'
  | 'others'
  | 'salute'
  | 'flow'
  | 'seal'
  | 'scroll'
  | 'crest'
  | 'kid-wushu'
  | 'kid-defense-a'
  | 'kid-defense-b'
  | 'kid-weapon'
  | 'kid-miaodao'
  | 'kid-spear';

/** 首頁 beat 的先後順序（即頁面由上而下）。 */
export const BEATS: readonly BeatId[] = [
  'opening',
  'fist',
  'combat-a',
  'combat-b',
  'weapon-a',
  'weapon-b',
  'weapon-c',
  'others',
  'coaches',
  'pricing',
  'booking',
];

/**
 * 小孩版只換「拳」「格鬥」「兵器 a」四段；開場、其他課程、師資、收費、預約與大人版相同，
 * 兵器 b、c 也沿用大人的妙刀與槍。
 */
export const POSE_BY_BEAT: Record<Audience, Record<BeatId, PoseId>> = {
  adult: {
    opening: 'land',
    fist: 'dingzhou',
    'combat-a': 'chengchui',
    'combat-b': 'kao',
    'weapon-a': 'jian',
    'weapon-b': 'miaodao',
    'weapon-c': 'spear',
    others: 'others',
    coaches: 'salute',
    pricing: 'scroll',
    booking: 'crest',
  },
  kid: {
    opening: 'land',
    fist: 'kid-wushu',
    'combat-a': 'kid-defense-a',
    'combat-b': 'kid-defense-b',
    'weapon-a': 'kid-weapon',
    'weapon-b': 'kid-miaodao',
    'weapon-c': 'kid-spear',
    others: 'others',
    coaches: 'salute',
    pricing: 'scroll',
    booking: 'crest',
  },
};

/**
 * 換招衝量：換到這一式時光點往哪裡炸。
 *   - `dir`：方向（引擎會 normalize，所以不可為零向量）。
 *   - `power`：力道。
 *   - `mode`：0 順著方向；1 左右分開（撐捶；竹簡攤開也用它）；2 從腳下往四周（震腳）；3 向內收（朱印、光點館徽）。
 *   - `hold`：彈簧鬆開的時間尺度（預設 1）；0 表示不鬆彈簧（落地要「啪」一下就定住）。
 */
export interface Burst {
  dir: [number, number, number];
  power: number;
  mode: 0 | 1 | 2 | 3;
  hold?: number;
}

export const BURSTS: Record<PoseId, Burst> = {
  // 試作 STEPS 的值，原樣搬入
  dingzhou: { dir: [1, 0.15, 0.1], power: 3.2, mode: 0 },
  chengchui: { dir: [1, 0.1, 0], power: 3.0, mode: 1 },
  kao: { dir: [1, 0.35, 0.15], power: 3.4, mode: 0 },
  jian: { dir: [1, 0.25, 0], power: 3.0, mode: 0 },
  miaodao: { dir: [0.6, -0.8, 0], power: 3.2, mode: 0 },
  spear: { dir: [1, 0, 0], power: 3.6, mode: 0 },
  land: { dir: [0, -1, 0], power: 2.2, mode: 2 },
  lift: { dir: [0, 1, 0], power: 1.8, mode: 2, hold: 0.5 },
  // 新姿勢：others 四個小人形同時升起、salute 抱拳收勢（力道取 1.4–1.8，不搶戲）
  others: { dir: [0, 1, 0], power: 1.8, mode: 2 },
  salute: { dir: [0, -1, 0], power: 1.4, mode: 2 },
  flow: { dir: [1, 0, 0], power: 1.0, mode: 0 },
  seal: { dir: [0, -1, 0], power: 2.0, mode: 3 },
  // Task 25：收費段的竹簡「攤開」（左右分開，力道輕——光點退成背景的氣）；預約段的光點館徽向內收（同朱印）
  scroll: { dir: [1, 0.05, 0], power: 1.6, mode: 1 },
  crest: { dir: [0, -1, 0], power: 2.0, mode: 3 },
  // 小孩的四式沿用 chengchui 的左右分開
  'kid-wushu': { dir: [1, 0.1, 0], power: 3.0, mode: 1 },
  'kid-defense-a': { dir: [1, 0.1, 0], power: 3.0, mode: 1 },
  'kid-defense-b': { dir: [1, 0.1, 0], power: 3.0, mode: 1 },
  'kid-weapon': { dir: [1, 0.1, 0], power: 3.0, mode: 1 },
  // Task 27 追加：小孩持刀、持槍（兵器三段都有小孩版），同其他小孩段
  'kid-miaodao': { dir: [1, 0.1, 0], power: 3.0, mode: 1 },
  'kid-spear': { dir: [1, 0.1, 0], power: 3.0, mode: 1 },
};

export function poseFor(beat: BeatId, audience: Audience): PoseId {
  return POSE_BY_BEAT[audience][beat];
}
