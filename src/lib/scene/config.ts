/**
 * 剪影場景的配對表（Task 27，使用者要求「每一頁都是粒子感覺稍微有點審美疲勞、前中後遠景的效果沒有出現、整體太抽象」）。
 * 純資料與查表，不碰 DOM／Astro；元件（`components/Scene.astro`、`components/home/Depth.astro`）與單元測試共用。
 *
 * 子頁（課程總覽、課程內頁、師資、教練、場地、收費、課表、404）頁首是一幕分層剪影，由後到前四層：
 *   1. far     遠景：屋脊與院牆（`bg-far-roofs`），最慢、最淡、略帶霧色。
 *   2. mid     中景：院門、兵器架、鼓、旗、木人樁，依頁面。
 *   3. subject 人物：該頁對應的剪影（課程內頁＝該課程的 `fig-*`／`kid-*`，師資與 404＝抱拳收勢 `fig-salute`）；
 *              場地是空場，主體改成場上的器具（木人樁），所以場地沒有人物，但四層仍然齊全。
 *   4. fg      前景 1–2 張（簷角、柱框、窗櫺、石階、近處的兵器架）：最快、最暗，貼著畫面邊緣框住場景。
 * 每一頁的組合都不同（`sceneSignature` 互不相同，單元測試守住），課程內頁的人物各門課專屬，避免看膩。
 * 素材是 `src/assets/silhouettes/<名稱>.webp`（黑色加透明的剪影）；層的位置與大小在 `styles/scene.css`（依 `data-asset`）。
 *
 * 首頁（`HOME_DEPTH`、`MID_BY_BEAT`）：光點拳師照舊，遠景屋脊與中景（院門、兵器架…，在人形旁邊）襯在光點後面，前景（簷角、窗櫺）框在畫面左右；
 * 中景依段落換（兵器三段是兵器架）。
 */

import type { BeatId } from '../../qi/config/poses';

/** 一個剪影層：素材名稱（不含副檔名）與是否左右翻轉（同一張素材在不同頁面換邊，避免看膩）。 */
export interface SceneLayerRef {
  asset: string;
  flip?: boolean;
}

export interface SceneSpec {
  far: SceneLayerRef;
  mid: SceneLayerRef;
  subject: SceneLayerRef;
  /** 前景 1–2 張，由後到前。 */
  fg: SceneLayerRef[];
}

/** 沒有「課程」維度的頁面種類（課程內頁另由 `sceneForCourse` 依課程決定）。 */
export type PageSceneKind = 'courses' | 'coaches' | 'coach' | 'facility' | 'pricing' | 'schedule' | 'lost';

const ROOFS = 'bg-far-roofs';

function scene(mid: string, subject: string, fg: (string | [string, 'flip'])[], flip: { mid?: boolean; subject?: boolean } = {}): SceneSpec {
  return {
    far: { asset: ROOFS },
    mid: { asset: mid, flip: flip.mid },
    subject: { asset: subject, flip: flip.subject },
    fg: fg.map((entry) => (typeof entry === 'string' ? { asset: entry } : { asset: entry[0], flip: true })),
  };
}

export const PAGE_SCENES: Record<PageSceneKind, SceneSpec> = {
  // 課程總覽：站樁的人物，滑過或聚焦課程卡時換成該課的剪影（`Scene.astro` 的 swap）
  courses: scene('bg-mid-gate', 'fig-zhenjiao-land', ['fg-pillars']),
  coaches: scene('mid-banner', 'fig-salute', ['fg-eave', 'fg-steps']),
  // 窗櫺在左下、簷角在右上（窗櫺翻到右下會蓋住手機上人物的腳）
  coach: scene('mid-drum', 'fig-salute', ['fg-lattice', 'fg-eave']),
  // 場地：空場。主體是場上的木人樁（石鎖看起來像「禁止」的符號，已拿掉）
  facility: scene('bg-mid-gate', 'mid-dummy', ['fg-steps', 'fg-pillars']),
  pricing: scene('mid-banner', 'fig-zhenjiao', ['fg-lattice', ['fg-steps', 'flip']]),
  schedule: scene('mid-drum', 'fig-zhenjiao-land', [['fg-eave', 'flip']]),
  // 404：一個人收勢站在空院子裡
  lost: scene('mid-dummy', 'fig-salute', ['fg-steps']),
};

/** 每門課各自的場景（鍵是課程 id＝檔名）：人物專屬。 */
export const COURSE_SCENES: Record<string, SceneSpec> = {
  bajiquan: scene('bg-mid-gate', 'fig-dingzhou', ['fg-eave', 'fg-steps']),
  sanshou: scene('mid-dummy', 'fig-chengchui', ['fg-pillars'], { subject: true }),
  'chinese-weapons': scene('bg-mid-rack', 'fig-jian', ['fg-rack-close', 'fg-eave']),
  'kids-martial-arts': scene('mid-banner', 'fig-kid-wushu', ['fg-eave', 'fg-lattice']),
  'kids-self-defense': scene('mid-drum', 'fig-kid-defense-a', [['fg-pillars', 'flip'], ['fg-steps', 'flip']], { subject: true }),
  'kids-weapons': scene('bg-mid-rack', 'fig-kid-weapon', [['fg-eave', 'flip']], { mid: true }),
  bjj: scene('mid-drum', 'fig-kao', ['fg-lattice']),
  'core-yoga': scene('mid-banner', 'fig-zhenjiao', [['fg-eave', 'flip'], ['fg-steps', 'flip']]),
};

/**
 * 每種前景素材貼在場景的哪個角落（不翻轉時）。`v` 是上緣、下緣或整個高度（貼著一側的邊緣），`h` 是左或右；翻轉（flip）把左右對調。
 * `styles/scene.css` 照這張表放位置；單元測試確認同一場景的兩張前景在左右兩側、不擠在同一個角落（使用者的審查：兒童武術的兩張前景都在左下，擠成一團）。
 */
export const FG_ANCHOR: Record<string, { v: 'top' | 'bottom' | 'full'; h: 'left' | 'right' }> = {
  'fg-eave': { v: 'top', h: 'right' },
  'fg-lattice': { v: 'bottom', h: 'left' },
  'fg-steps': { v: 'bottom', h: 'left' },
  'fg-rack-close': { v: 'bottom', h: 'left' },
  // 單根廊柱（上有斗拱托住的橫梁一角）貼著右緣、從地面立到頂：只取一根柱子，不是兩柱一梁的門形（那個會像日本鳥居）
  'fg-pillars': { v: 'full', h: 'right' },
};

/** 一張前景（含翻轉）實際貼的角落，例如 `top-right`、`bottom-left`、`full-left`。 */
export function fgCorner(layer: SceneLayerRef): string {
  const anchor = FG_ANCHOR[layer.asset];
  if (!anchor) throw new Error(`fg anchor missing: ${layer.asset}`);
  const h = layer.flip ? (anchor.h === 'left' ? 'right' : 'left') : anchor.h;
  return `${anchor.v}-${h}`;
}

export type CourseCategory = 'weapon' | 'fist' | 'combat' | 'other';
export type CourseAudience = 'adult' | 'kid' | 'all';

/**
 * 表裡沒有的課程（日後新增）依分類與對象退回的預設場景：拳→定軸、格鬥→撐捶、兵器→劍、其他→站樁；兒童課用 `kid-*`
 * （其他類的兒童課沒有專屬剪影，用落地站姿）。「不分對象」視為大人。
 */
export const CATEGORY_SCENES: Record<CourseCategory, Record<CourseAudience, SceneSpec>> = {
  fist: {
    adult: scene('bg-mid-gate', 'fig-dingzhou', ['fg-eave']),
    kid: scene('bg-mid-gate', 'fig-kid-wushu', ['fg-eave']),
    all: scene('bg-mid-gate', 'fig-dingzhou', ['fg-eave']),
  },
  combat: {
    adult: scene('mid-dummy', 'fig-chengchui', ['fg-pillars']),
    kid: scene('mid-dummy', 'fig-kid-defense-a', ['fg-pillars']),
    all: scene('mid-dummy', 'fig-chengchui', ['fg-pillars']),
  },
  weapon: {
    adult: scene('bg-mid-rack', 'fig-jian', ['fg-eave']),
    kid: scene('bg-mid-rack', 'fig-kid-weapon', ['fg-eave']),
    all: scene('bg-mid-rack', 'fig-jian', ['fg-eave']),
  },
  other: {
    adult: scene('mid-drum', 'fig-zhenjiao-land', ['fg-steps']),
    kid: scene('mid-drum', 'fig-zhenjiao-land', ['fg-steps']),
    all: scene('mid-drum', 'fig-zhenjiao-land', ['fg-steps']),
  },
};

/** 課程內頁（與課程總覽的課程卡）的場景：先查專屬的表，沒有就依分類與對象退回預設。 */
export function sceneForCourse(course: { id: string; category: CourseCategory; audience: CourseAudience }): SceneSpec {
  return COURSE_SCENES[course.id] ?? CATEGORY_SCENES[course.category][course.audience];
}

/** 場景的簽章（單元測試用：每頁的組合不得重複）。 */
export function sceneSignature(spec: SceneSpec): string {
  const side = (layer: SceneLayerRef) => `${layer.asset}${layer.flip ? '~' : ''}`;
  return [side(spec.far), side(spec.mid), side(spec.subject), spec.fg.map(side).join('+')].join('|');
}

/** 場景用到的全部素材名稱（去重）。 */
export function sceneAssets(spec: SceneSpec): string[] {
  return [...new Set([spec.far.asset, spec.mid.asset, spec.subject.asset, ...spec.fg.map((layer) => layer.asset)])];
}

// ── 首頁 ────────────────────────────────────────────────────────

export type HomeMidKey = 'gate' | 'rack' | 'drum' | 'banner' | 'dummy';

export const HOME_DEPTH: {
  far: SceneLayerRef;
  mids: Record<HomeMidKey, SceneLayerRef>;
  fg: SceneLayerRef[];
} = {
  far: { asset: ROOFS },
  mids: {
    gate: { asset: 'bg-mid-gate' },
    rack: { asset: 'bg-mid-rack' },
    drum: { asset: 'mid-drum' },
    banner: { asset: 'mid-banner' },
    dummy: { asset: 'mid-dummy' },
  },
  // 前景兩張框住左右：簷角在右上、窗櫺在左下（直向在左上）
  fg: [{ asset: 'fg-eave' }, { asset: 'fg-lattice' }],
};

/**
 * 左下角的窗櫺（前景第二張）只在這幾段出現：開場的站名、副標垂直排在左側一路到畫面底，收費與預約等段的內容是整寬的，左下角都有字。
 * 其餘段落左下角是空的（文字在視窗中間偏左），窗櫺才不壓到字；e2e 每段量過。
 */
export const HOME_FG_LEFT_BEATS: readonly BeatId[] = ['fist', 'combat-a', 'combat-b', 'weapon-a', 'weapon-b', 'weapon-c'];

/** 每個段落（beat）的中景：開場與拳是院門、格鬥是木人樁、兵器三段是兵器架、其他課程是鼓、師資與收費是旗、預約回到院門。 */
export const MID_BY_BEAT: Record<BeatId, HomeMidKey> = {
  opening: 'gate',
  fist: 'gate',
  'combat-a': 'dummy',
  'combat-b': 'dummy',
  'weapon-a': 'rack',
  'weapon-b': 'rack',
  'weapon-c': 'rack',
  others: 'drum',
  coaches: 'banner',
  pricing: 'banner',
  booking: 'gate',
};
