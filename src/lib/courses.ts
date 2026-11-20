// 課程資料的篩選與排序（純邏輯，不依賴 Astro，可單元測試）。

export type Audience = 'adult' | 'kid';
export type CourseAudience = Audience | 'all';
export type MainCategory = 'weapon' | 'fist' | 'combat';
export type Category = MainCategory | 'other';

export const AUDIENCES: readonly Audience[] = ['adult', 'kid'];
export const MAIN_CATEGORIES: readonly MainCategory[] = ['weapon', 'fist', 'combat'];

export const AUDIENCE_LABEL: Record<CourseAudience, string> = {
  adult: '大人',
  kid: '小孩',
  all: '不分',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  weapon: '兵器',
  fist: '拳術',
  combat: '格鬥',
  other: '其他',
};

/** 每個主分類的代表單字（首頁三幕與文字卡用）。 */
export const CATEGORY_GLYPH: Record<MainCategory, string> = {
  weapon: '兵',
  fist: '拳',
  combat: '搏',
};

/** 這些函式只需要的最小形狀；內容集合的 entry 符合它。 */
export interface CourseLike {
  id: string;
  data: {
    audience: CourseAudience;
    category: Category;
    published: boolean;
    order: number;
    coaches: readonly { id: string }[];
  };
}

function byOrder(a: CourseLike, b: CourseLike): number {
  return a.data.order - b.data.order || a.id.localeCompare(b.id);
}

/** 已發布的課程，依 order（同分依 id）排序。不會改動傳入的陣列。 */
export function publishedCourses<T extends CourseLike>(courses: readonly T[]): T[] {
  return courses.filter((c) => c.data.published).sort(byOrder);
}

/**
 * 選定對象後要顯示的卡片：兵器、拳術、格鬥各一張，固定這個順序。
 * 某分類沒有課就跳過，不補別的。
 */
export function cardsFor<T extends CourseLike>(courses: readonly T[], audience: Audience): T[] {
  const published = publishedCourses(courses);
  return MAIN_CATEGORIES.flatMap((category) => {
    const found = published.find((c) => c.data.audience === audience && c.data.category === category);
    return found ? [found] : [];
  });
}

/** 「其他課程」區：已發布、分類為其他。 */
export function otherCourses<T extends CourseLike>(courses: readonly T[]): T[] {
  return publishedCourses(courses).filter((c) => c.data.category === 'other');
}

export interface CategoryPair<T> {
  category: MainCategory;
  adult: T | undefined;
  kid: T | undefined;
}

/** 首頁三幕用：每個主分類的大人課與小孩課。 */
export function pairByCategory<T extends CourseLike>(courses: readonly T[]): CategoryPair<T>[] {
  const adult = cardsFor(courses, 'adult');
  const kid = cardsFor(courses, 'kid');
  return MAIN_CATEGORIES.map((category) => ({
    category,
    adult: adult.find((c) => c.data.category === category),
    kid: kid.find((c) => c.data.category === category),
  }));
}

/** 課程內頁要顯示的照片：去掉只給課程卡用的（cardOnly，例如影片截圖）。順序不變，不改動傳入的陣列。 */
export function pagePhotos<P extends { cardOnly?: boolean }>(photos: readonly P[]): P[] {
  return photos.filter((photo) => !photo.cardOnly);
}

/** 某位教練教的已發布課程。 */
export function coursesOfCoach<T extends CourseLike>(courses: readonly T[], coachId: string): T[] {
  return publishedCourses(courses).filter((c) => c.data.coaches.some((coach) => coach.id === coachId));
}
