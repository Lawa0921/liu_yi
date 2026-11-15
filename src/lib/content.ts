// 內容集合的讀取入口：頁面一律從這裡拿「已發布、已排序」的資料，不直接呼叫 getCollection。
import { getCollection, type CollectionEntry } from 'astro:content';
import { CATEGORY_LABEL, AUDIENCE_LABEL, publishedCourses } from './courses';

export type Course = CollectionEntry<'courses'>;
export type Coach = CollectionEntry<'coaches'>;

export async function getPublishedCourses(): Promise<Course[]> {
  return publishedCourses(await getCollection('courses'));
}

export async function getPublishedCoaches(): Promise<Coach[]> {
  const coaches = await getCollection('coaches', ({ data }) => data.published);
  return coaches.sort((a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id));
}

/** 課程的授課教練（只回已發布的）。 */
export function coachesOfCourse(course: Course, coaches: readonly Coach[]): Coach[] {
  return course.data.coaches.flatMap((ref) => coaches.filter((coach) => coach.id === ref.id));
}

/** 卡片與課程頁上方的小標，例如「兵器 · 大人」；其他課程只寫「其他課程」。 */
export function courseLabel(course: Course): string {
  const { category, audience } = course.data;
  if (category === 'other') return audience === 'all' ? '其他課程' : `其他課程 · ${AUDIENCE_LABEL[audience]}`;
  return audience === 'all' ? CATEGORY_LABEL[category] : `${CATEGORY_LABEL[category]} · ${AUDIENCE_LABEL[audience]}`;
}
