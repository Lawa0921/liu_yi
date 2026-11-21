// 首頁的內容模型（純邏輯，不依賴 astro:content，可單元測試）。
// 頁面把已發布的課程與教練交進來，這裡排出「拳 → 格鬥 → 兵器」三步、其他課程與師資。
// 某對象或某分類沒有課、沒有教練、沒有其他課程時，結果就是少一段或空陣列，不留空殼（RF4）。
import type { BeatId } from '../qi/config/poses';

export type Category3 = 'fist' | 'combat' | 'weapon';

/** 首頁課程段的順序（設計 §7）。課程總覽頁另有自己的順序（兵器 → 拳術 → 格鬥）。 */
export const STEP_ORDER: readonly Category3[] = ['fist', 'combat', 'weapon'];

/** 每個分類在捲動上佔幾個 beat（每個 beat 是引擎的一個姿勢）。 */
export const BEATS_BY_CATEGORY: Record<Category3, readonly BeatId[]> = {
  fist: ['fist'],
  combat: ['combat-a', 'combat-b'],
  weapon: ['weapon-a', 'weapon-b', 'weapon-c'],
};

export interface CourseLike {
  id: string;
  data: {
    title: string;
    summary: string;
    audience: string;
    category: string;
    subItems: { name: string }[];
    published: boolean;
    order: number;
    coaches: { id: string }[];
  };
}

export interface StepModel<C extends CourseLike = CourseLike> {
  category: Category3;
  beats: BeatId[];
  adult?: C;
  kid?: C;
}

interface CoachLike {
  id: string;
  data: { name: string; role: string; published: boolean; order: number };
}

function byOrder<T extends { id: string; data: { order: number } }>(a: T, b: T): number {
  return a.data.order - b.data.order || a.id.localeCompare(b.id);
}

export function buildHomeModel<C extends CourseLike, K extends CoachLike>(
  courses: readonly C[],
  coaches: readonly K[],
): { steps: StepModel<C>[]; others: C[]; coaches: (K & { teaches: string[] })[] } {
  const published = courses.filter((course) => course.data.published).sort(byOrder);

  const steps = STEP_ORDER.flatMap((category): StepModel<C>[] => {
    const pick = (audience: 'adult' | 'kid') =>
      published.find((course) => course.data.category === category && course.data.audience === audience);
    const adult = pick('adult');
    const kid = pick('kid');
    // 兩個對象都沒有這個分類的課，整步不出現。
    if (!adult && !kid) return [];
    return [{ category, beats: [...BEATS_BY_CATEGORY[category]], adult, kid }];
  });

  // 只列大人小孩都適合的；只給單一對象的「其他」課（小孩的幼兒武術）放在課程總覽該對象的卡片裡（src/lib/courses.ts 的 cardsFor）。
  const others = published.filter((course) => course.data.category === 'other' && course.data.audience === 'all');

  const teachers = coaches
    .filter((coach) => coach.data.published)
    .sort(byOrder)
    .map((coach) => ({
      ...coach,
      teaches: published
        .filter((course) => course.data.coaches.some((ref) => ref.id === coach.id))
        .map((course) => course.data.title),
    }));

  return { steps, others, coaches: teachers };
}

/**
 * 課程內文的第一句（小孩課的招式註解用，例如防身格鬥的「戴上拳套，學會出手，也學會收手。」）。
 * 取第一個非空段落，去掉開頭的 Markdown 標題符號，截到第一個句尾標點（含標點）；沒有標點就整段。
 */
export function firstSentence(body: string | undefined): string {
  const paragraph = (body ?? '')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block !== '');
  if (!paragraph) return '';
  const text = paragraph.replace(/^#{1,6}\s+/, '').replace(/\s*\n\s*/g, '');
  const end = text.search(/[。！？!?]/);
  return end === -1 ? text : text.slice(0, end + 1);
}
