// 立體空間的場景設定（第三版追加）：首屏的演武場、兵器幕與拳術幕的景深層。純資料與純函式。
//
// 做法：一疊由遠到近的剪影層放在同一個 CSS 3D 空間裡（perspective + translateZ），
// 層與層之間夾著霧與逆光的光束；指標（或裝置傾斜）移動透視原點就有視差，捲動時鏡頭沿 Z 軸往前推進。
// 素材是 src/assets/silhouettes/ 裡的黑色剪影（由別人生成、可抽換）；哪張沒到，那一層就略過。

export type SceneRole = 'far' | 'mid' | 'light' | 'atmos' | 'fog' | 'ground' | 'figure' | 'dust' | 'fore';

/**
 * 人形清單：全站用到的人形都在這裡，一個代號對一張素材。
 * 姿勢是生成的、未必是正確的架勢——之後要換（例如改用業主本人照片描的剪影），只要換這裡的檔名或換掉同名的檔案。
 */
export interface FigureSpec {
  asset: string;
  label: string;
  /**
   * 頭在原圖裡有多高（px）。各張圖裡人的縮放不一樣，用頭的大小把它們對齊：
   * 畫面上每個人的頭一樣大，也就是身高一致。換素材時量一下新圖的頭高填進來。
   */
  head: number;
  /** 腳底離圖的下緣多少 px（圖四周有透明邊）：腳要踩在地平線上。 */
  foot: number;
  /** 身體的中心在圖寬的哪裡（0–1）：拿兵器的圖，人不在正中央。 */
  centre: number;
  /** 震腳的人：落下的那隻腳在圖寬的哪裡（0–1）。裂紋的中心放在它下面。 */
  landing?: number;
}

export const FIGURES = {
  /** 首屏開場：震腳落下前的一瞬。 */
  stomp: { asset: 'fig-zhenjiao', label: '震腳', head: 150, foot: 9, centre: 0.56, landing: 0.2 },
  /** 首屏定格：頂肘。 */
  hero: { asset: 'fig-dingzhou', label: '頂肘', head: 100, foot: 9, centre: 0.56 },
  /** 拳術幕：馬步撐捶。 */
  fist: { asset: 'fig-chengchui', label: '馬步撐捶', head: 110, foot: 9, centre: 0.56 },
  jian: { asset: 'fig-jian', label: '持劍前刺', head: 98, foot: 9, centre: 0.66 },
  miaodao: { asset: 'fig-miaodao', label: '雙手苗刀斜劈', head: 103, foot: 9, centre: 0.56 },
  spear: { asset: 'fig-daqiang', label: '大槍前扎', head: 87, foot: 9, centre: 0.68 },
  /**
   * 首屏擊中那一拍：震腳落地（第二批素材）。兩張圖裡人的縮放不同：主體高 1161（落地）對 1104（抬腳），
   * 頭高依同一比例換算（150 × 1161 / 1104），換上時才不會跳。落下的是畫面左邊那隻腳（圖寬 0.18）。
   */
  land: { asset: 'fig-zhenjiao-land', label: '震腳落地', head: 157.7, foot: 9, centre: 0.5, landing: 0.18 },
  /** 拳術幕的貼山靠：撞過去的那個人（第二批素材）。手臂與軀幹黏成一團，只在撞的那一下快速掠過，不停在畫面上。 */
  kao: { asset: 'fig-kao', label: '貼山靠', head: 115, foot: 9, centre: 0.5 },
} as const satisfies Record<string, FigureSpec>;

export type FigureKey = keyof typeof FIGURES;

/** 一個站直的人大約幾個頭高。 */
const HEADS_TALL = 7.5;

/**
 * 人形的框：圖要畫多高（以「一個站直的人的身高」為 1）、腳底的透明邊佔圖高多少、身體中心在圖寬的哪裡。
 * 這樣不同的圖裡，人的身高在畫面上一致，腳都踩在同一條地平線上。
 */
export function figureBox(spec: FigureSpec, image: { width: number; height: number }): { height: number; foot: number; centre: number } {
  const height = image.height > 0 && spec.head > 0 ? image.height / (spec.head * HEADS_TALL) : 1;
  return { height, foot: image.height > 0 ? spec.foot / image.height : 0, centre: spec.centre };
}

/** 落點相對於身體中心的橫向偏移（以人形框的寬度為 1）：沒有指定落腳的人形就是 0。 */
export function landingOffset(spec: FigureSpec): number {
  return spec.landing === undefined ? 0 : spec.landing - spec.centre;
}

export interface SceneLayer {
  id: string;
  role: SceneRole;
  /** 素材的檔名（不含副檔名）；霧、光束、塵粒這些不需要素材的是 null。 */
  asset: string | null;
  /** 人形層：用的是哪個人形（FIGURES 的代號）。 */
  figure?: FigureKey;
  /** 景深：0 最遠，1 最近。 */
  depth: number;
  /** 不透明度：遠的淡（被霧吃掉），近的實。 */
  opacity: number;
  /** 失焦（px）：最近的前景略糊，像從廊下往院子裡看。 */
  blur?: number;
  /** 手機也顯示這一層（手機層數較少）。 */
  mobile: boolean;
  /** 首屏就載入（只有最近的前景）；其餘延後載入。 */
  eager?: boolean;
  /** 素材還沒到時改用這一張（已核准的現有剪影）；連它也沒有就整層略過。 */
  fallback?: string;
  /**
   * 擺在哪裡（不給就是整層鋪滿）：
   *   split        立柱加橫樑的畫框拆成左右兩根柱子，各自只佔畫面最邊上的一條（框只包住柱子，不蓋到文字）
   *   top-right    右上角（簷角）
   *   bottom-left  左下角出框（近處的兵器架）
   *   bottom-right 右下角出框
   *   bottom       沿著下緣（石階的地面）
   *   left-mid / right-mid  中景道具，站在地平線上、靠左／靠右
   *   banner       旗幡：從上緣垂下來、輕輕擺
   */
  place?: 'split' | 'top-right' | 'bottom-left' | 'bottom-right' | 'bottom' | 'left-mid' | 'right-mid' | 'banner';
}

const figure = (key: FigureKey, layer: Omit<SceneLayer, 'role' | 'asset' | 'figure' | 'id'> & { id?: string }): SceneLayer => ({
  id: layer.id ?? `figure-${key}`,
  role: 'figure',
  asset: FIGURES[key].asset,
  figure: key,
  ...layer,
});

export const SCENES = {
  // 首屏：演武場。由廊下往院子裡看——遠處屋脊（後面有流動的霧）、旗幡、院門（門洞透出逆光，WebGL2 體積光）、
  // 場中的人、飄著的塵、近處的立柱與簷角。
  hero: [
    { id: 'far-roofs', role: 'far', asset: 'bg-far-roofs', depth: 0.05, opacity: 0.55, blur: 1.2, mobile: true },
    { id: 'fog-far', role: 'fog', asset: null, depth: 0.12, opacity: 0.7, mobile: true },
    { id: 'mid-banner', role: 'mid', asset: 'mid-banner', depth: 0.22, opacity: 0.7, blur: 0.8, place: 'banner', mobile: false },
    { id: 'mid-gate', role: 'mid', asset: 'bg-mid-gate', depth: 0.28, opacity: 0.8, blur: 0.6, mobile: true },
    // 逆光：支援 WebGL2 時是體積光著色器（atmos），否則退回 CSS 的光束（beam）。
    { id: 'beam', role: 'light', asset: null, depth: 0.33, opacity: 0.55, mobile: false },
    { id: 'atmos', role: 'atmos', asset: null, depth: 0.36, opacity: 1, mobile: true },
    { id: 'fog-mid', role: 'fog', asset: null, depth: 0.4, opacity: 0.5, mobile: false },
    figure('stomp', { depth: 0.55, opacity: 1, mobile: true }),
    figure('land', { depth: 0.55, opacity: 1, mobile: true }),
    figure('hero', { depth: 0.55, opacity: 1, mobile: true }),
    // 地面：金色地平線加石板的透視線（用 CSS 畫，不靠素材）。
    { id: 'ground', role: 'ground', asset: null, depth: 0.5, opacity: 1, mobile: true },
    { id: 'dust', role: 'dust', asset: null, depth: 0.7, opacity: 1, mobile: false },
    { id: 'fore-eave', role: 'fore', asset: 'fg-eave', depth: 0.94, opacity: 0.9, blur: 2.5, place: 'top-right', mobile: false },
    { id: 'fore-pillars', role: 'fore', asset: 'fg-pillars', depth: 1, opacity: 1, blur: 3, place: 'split', mobile: true, eager: true },
  ],
  // 兵器幕：3D 兵器的背後是兵器架與霧，側邊是對應的持械人形（低對比，不搶兵器的戲）；兵器前後各一層塵；
  // 近處一座兵器架從左下出框（素材沒到時先用遠處那張兵器架）。
  weapon: [
    // 兵器架只留一抹輪廓在霧裡。
    { id: 'mid-rack', role: 'mid', asset: 'bg-mid-rack', depth: 0.1, opacity: 0.1, blur: 2, mobile: true },
    { id: 'fog-far', role: 'fog', asset: null, depth: 0.22, opacity: 0.6, mobile: true },
    // 人形小、偏在一側、在霧後面：3D 兵器才是主角。
    figure('jian', { depth: 0.28, opacity: 0.4, blur: 0.6, mobile: true }),
    // 苗刀人形的刀單看輪廓仍像日本刀：放更遠、更暗，不當主視覺。
    figure('miaodao', { depth: 0.2, opacity: 0.3, blur: 0.8, mobile: true }),
    figure('spear', { depth: 0.28, opacity: 0.4, blur: 0.6, mobile: true }),
    { id: 'dust-back', role: 'dust', asset: null, depth: 0.4, opacity: 0.8, mobile: false },
    { id: 'dust-front', role: 'dust', asset: null, depth: 0.85, opacity: 1, mobile: true },
    { id: 'fore-rack', role: 'fore', asset: 'fg-rack-close', fallback: 'bg-mid-rack', depth: 0.96, opacity: 0.55, blur: 3.5, place: 'bottom-left', mobile: false },
  ],
  // 拳術幕：一面透光的窗櫺牆（很淡、在霧後），中景有鼓與木人樁，前面是八極人形，近處是石階與立柱。
  fist: [
    { id: 'mid-lattice', role: 'mid', asset: 'fg-lattice', depth: 0.06, opacity: 0.07, blur: 1.5, mobile: true },
    { id: 'fog-far', role: 'fog', asset: null, depth: 0.2, opacity: 0.85, mobile: true },
    { id: 'mid-drum', role: 'mid', asset: 'mid-drum', depth: 0.3, opacity: 0.35, blur: 1, place: 'left-mid', mobile: false },
    { id: 'mid-dummy', role: 'mid', asset: 'mid-dummy', depth: 0.32, opacity: 0.35, blur: 1, place: 'right-mid', mobile: false },
    figure('fist', { depth: 0.45, opacity: 0.85, mobile: true }),
    figure('kao', { depth: 0.45, opacity: 0.85, mobile: true }),
    { id: 'fore-steps', role: 'fore', asset: 'fg-steps', depth: 0.92, opacity: 0.8, blur: 2.5, place: 'bottom', mobile: false },
    { id: 'fore-pillars', role: 'fore', asset: 'fg-pillars', depth: 1, opacity: 0.85, blur: 3, place: 'split', mobile: false },
  ],
  // 格鬥幕：遠處屋脊與霧，近處立柱。（石鎖的剪影近看像提包，依指示不用。）
  combat: [
    { id: 'far-roofs', role: 'far', asset: 'bg-far-roofs', depth: 0.05, opacity: 0.35, blur: 1.2, mobile: true },
    { id: 'fog-far', role: 'fog', asset: null, depth: 0.2, opacity: 0.8, mobile: true },
    { id: 'fore-pillars', role: 'fore', asset: 'fg-pillars', depth: 1, opacity: 0.85, blur: 3, place: 'split', mobile: false },
  ],
  // 下方各區塊：遠景（屋脊或窗櫺）加霧，再一個從畫面邊緣掃過的前景。
  courses: [
    { id: 'far-roofs', role: 'far', asset: 'bg-far-roofs', depth: 0.05, opacity: 0.28, blur: 1.2, mobile: true },
    { id: 'fog-far', role: 'fog', asset: null, depth: 0.2, opacity: 0.85, mobile: true },
    { id: 'fore-pillars', role: 'fore', asset: 'fg-pillars', depth: 1, opacity: 0.8, blur: 3, place: 'split', mobile: false },
  ],
  coaches: [
    { id: 'far-lattice', role: 'far', asset: 'fg-lattice', depth: 0.05, opacity: 0.06, blur: 1.5, mobile: true },
    { id: 'fog-far', role: 'fog', asset: null, depth: 0.2, opacity: 0.85, mobile: true },
    // 左下（右下角是固定的「預約體驗」鈕，要讓開）。
    { id: 'fore-rack', role: 'fore', asset: 'fg-rack-close', fallback: 'bg-mid-rack', depth: 0.96, opacity: 0.45, blur: 3.5, place: 'bottom-left', mobile: false },
  ],
  facility: [
    { id: 'far-roofs', role: 'far', asset: 'bg-far-roofs', depth: 0.05, opacity: 0.28, blur: 1.2, mobile: true },
    { id: 'fog-far', role: 'fog', asset: null, depth: 0.2, opacity: 0.85, mobile: true },
    { id: 'fore-pillars', role: 'fore', asset: 'fg-pillars', depth: 1, opacity: 0.8, blur: 3, place: 'split', mobile: false },
  ],
  contact: [
    { id: 'far-lattice', role: 'far', asset: 'fg-lattice', depth: 0.05, opacity: 0.06, blur: 1.5, mobile: true },
    { id: 'fog-far', role: 'fog', asset: null, depth: 0.2, opacity: 0.85, mobile: true },
    { id: 'fore-eave', role: 'fore', asset: 'fg-eave', depth: 0.94, opacity: 0.8, blur: 2.5, place: 'top-right', mobile: false },
    { id: 'fore-pillars', role: 'fore', asset: 'fg-pillars', depth: 1, opacity: 0.8, blur: 3, place: 'split', mobile: false },
  ],
} satisfies Record<string, SceneLayer[]>;

export type SceneName = keyof typeof SCENES;

/** 實際要畫的層：素材沒到的略過、手機拿掉不必要的，由遠到近排好。 */
export function resolveScene(layers: readonly SceneLayer[], available: ReadonlySet<string>, options: { mobile: boolean }): SceneLayer[] {
  return layers
    .map((layer): SceneLayer | null => {
      if (layer.asset === null || available.has(layer.asset)) return layer;
      // 正式素材沒到：有指定替代（已核准的現有剪影）就先用它。
      if (layer.fallback && available.has(layer.fallback)) return { ...layer, asset: layer.fallback };
      return null;
    })
    .filter((layer): layer is SceneLayer => layer !== null)
    .filter((layer) => !options.mobile || layer.mobile)
    .sort((a, b) => a.depth - b.depth);
}

/**
 * 捲動視差：區塊從畫面下緣捲到上緣（進度 -1 → 1）時，這一層多走多少 px。遠的幾乎不動、近的走得多，
 * 最近的前景快到能從畫面中掃過。手機減半。
 */
export function scrollParallax(depth: number, options: { mobile?: boolean } = {}): number {
  const d = Math.max(0, Math.min(1, depth));
  return (12 + Math.pow(d, 1.6) * 240) * (options.mobile ? 0.5 : 1);
}

export interface FrameSlice {
  /** 這根柱子的框在畫面上的左右緣（以畫面寬為 1，可略出框）。 */
  from: number;
  to: number;
  /** 取原圖寬的哪一段（0–1）。 */
  source: [number, number];
}

/**
 * 立柱拆成左右兩根：素材是「兩根柱子加一條橫樑」的畫框，柱子在原圖寬的 0.075–0.147 與 0.853–0.925。
 * 這裡各取柱子那一條，放在畫面最邊上，框只包住柱子本身。
 */
export function splitFrame(): [FrameSlice, FrameSlice] {
  return [
    // 右柱讓開右下角固定的「預約體驗」鈕（它的右緣約在畫面寬的 0.94）。
    { from: -0.03, to: 0.055, source: [0.065, 0.15] },
    { from: 0.955, to: 1.04, source: [0.85, 0.935] },
  ];
}


/** 透視距離（px）：鏡頭離畫面多遠。 */
export const PERSPECTIVE = 1000;
/** 最遠與最近的層在 Z 軸上的位置（px；正值靠近鏡頭）。 */
const FAR_Z = -900;
const NEAR_Z = 260;

/** 景深 → 這一層在 3D 空間的 Z，以及抵銷透視用的縮放（靜止時每層看起來都是原本的大小）。 */
export function layerPlacement(depth: number): { z: number; scale: number } {
  const d = Math.max(0, Math.min(1, depth));
  const z = FAR_Z + (NEAR_Z - FAR_Z) * d;
  return { z, scale: (PERSPECTIVE - z) / PERSPECTIVE };
}

const clampUnit = (value: number) => (Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0);

/** 視差：透視原點最多偏離中央多少（%）。 */
const ORIGIN_SWING = 15;

/**
 * 指標視差：指標從正中央移到邊上（-1..1）時，這一層橫向多走多少 px。遠的幾乎不動、近的走得多（前景最多約 110px）。
 * 透視原點本身固定在正中央：只靠透視原點移動的話，遠層和近層會往相反方向走一樣多，看不出「近的動得多」。
 */
export function pointerParallax(depth: number): number {
  const d = Math.max(0, Math.min(1, depth));
  return 4 + Math.pow(d, 1.8) * 106;
}

/** 指標位置（-1..1，正中央是 0）→ 透視原點（%）。原點一動，近的層就比遠的層移得多。 */
export function parallaxOrigin(pointer: { x: number; y: number }): { x: number; y: number } {
  return { x: 50 + clampUnit(pointer.x) * ORIGIN_SWING, y: 50 + clampUnit(pointer.y) * ORIGIN_SWING * 0.7 };
}

/** 捲動進度（0–1）→ 鏡頭沿 Z 軸往前推進多少（px）。先慢後快；捲到底時已經穿過最近的前景層。 */
export function pushDepth(progress: number): number {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const reach = (PERSPECTIVE - NEAR_Z) * 1.25;
  return reach * (0.7 * p + 0.3 * p * p);
}

/** 首屏的捲動 → 推進的進度：捲動頭六成就推到底，之後才把畫面交給下一幕。 */
export function heroPush(scrollY: number, heroHeight: number): number {
  if (!(heroHeight > 0)) return 0;
  return Math.max(0, Math.min(1, scrollY / (heroHeight * 0.6)));
}

/**
 * 首屏的鏡頭呼吸（px，沿 Z 軸往前）：開場後一直在走——頭 20 秒極慢地推近到 40px，再疊上 11 秒一個來回的呼吸（±14px）。
 */
export function heroBreath(elapsedMs: number): number {
  const t = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const creep = 40 * Math.min(1, t / 20000);
  return creep + 14 * (1 - Math.cos((t / 11000) * Math.PI * 2));
}

/** 開場時各層次第亮起：由遠到近，這一層在落腳之後多久（ms）開始亮。 */
export function revealDelay(depth: number): number {
  // 最近的一層在落腳後 0.5 秒開始亮、0.7 秒亮完：整段進場在 1.2 秒內。
  return Math.round(80 + Math.max(0, Math.min(1, depth)) * 420);
}

export type PointerMode = 'static' | 'mouse' | 'tilt' | 'drift';

/** 視差跟誰走。 */
export function pointerMode(facts: { reducedMotion: boolean; hover: boolean; tilt: 'available' | 'needs-permission' | 'none' }): PointerMode {
  if (facts.reducedMotion) return 'static';
  if (facts.hover) return 'mouse';
  // 陀螺儀要另外請求權限的（iOS）不強求：改成緩慢的自動漂移。
  return facts.tilt === 'available' ? 'tilt' : 'drift';
}

/** 裝置傾斜（deviceorientation 的 beta 前後、gamma 左右，度）→ 指標位置。手機自然拿著約前傾 45°，當作正中央。 */
export function tiltPointer(beta: number | null, gamma: number | null): { x: number; y: number } {
  if (beta === null || gamma === null) return { x: 0, y: 0 };
  return { x: clampUnit(gamma / 28), y: clampUnit((beta - 45) / 28) };
}

/** 沒有滑鼠也沒有陀螺儀：緩慢的自動漂移（幅度小）。 */
export function driftPointer(elapsedMs: number): { x: number; y: number } {
  const t = elapsedMs / 1000;
  return { x: Math.sin(t * 0.21) * 0.34, y: Math.sin(t * 0.13 + 1.3) * 0.22 };
}
