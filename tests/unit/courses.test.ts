import { describe, expect, it } from 'vitest';
import {
  cardsFor,
  coursesOfCoach,
  otherCourses,
  pagePhotos,
  pairByCategory,
  publishedCourses,
  type CourseLike,
} from '../../src/lib/courses';

function course(
  id: string,
  audience: CourseLike['data']['audience'],
  category: CourseLike['data']['category'],
  extra: Partial<CourseLike['data']> = {},
): CourseLike {
  return { id, data: { audience, category, published: true, order: 0, coaches: [], ...extra } };
}

const all: CourseLike[] = [
  course('kids-self-defense', 'kid', 'combat', { order: 6 }),
  course('bjj', 'all', 'other', { order: 20, coaches: [{ id: 'owen' }] }),
  course('sanshou', 'adult', 'combat', { order: 3, coaches: [{ id: 'chan' }] }),
  course('bajiquan', 'adult', 'fist', { order: 2, coaches: [{ id: 'chan' }] }),
  course('kids-weapons', 'kid', 'weapon', { order: 4 }),
  course('chinese-weapons', 'adult', 'weapon', { order: 1, coaches: [{ id: 'chan' }] }),
  course('kids-martial-arts', 'kid', 'fist', { order: 5 }),
  course('core-yoga', 'all', 'other', { order: 10 }),
  course('street-dance', 'all', 'other', { order: 30, published: false }),
  course('youth-combat', 'kid', 'combat', { order: 0, published: false }),
];

const ids = (list: CourseLike[]) => list.map((c) => c.id);

describe('publishedCourses', () => {
  it('drops unpublished entries and sorts by order', () => {
    expect(ids(publishedCourses(all))).toEqual([
      'chinese-weapons',
      'bajiquan',
      'sanshou',
      'kids-weapons',
      'kids-martial-arts',
      'kids-self-defense',
      'core-yoga',
      'bjj',
    ]);
  });

  it('breaks order ties by id and does not mutate the input', () => {
    const input = [course('b', 'adult', 'fist'), course('a', 'adult', 'weapon')];
    expect(ids(publishedCourses(input))).toEqual(['a', 'b']);
    expect(ids(input)).toEqual(['b', 'a']);
  });
});

describe('cardsFor', () => {
  it('returns weapon, fist, combat for adults', () => {
    expect(ids(cardsFor(all, 'adult'))).toEqual(['chinese-weapons', 'bajiquan', 'sanshou']);
  });

  it('returns weapon, fist, combat for kids, ignoring unpublished ones', () => {
    expect(ids(cardsFor(all, 'kid'))).toEqual(['kids-weapons', 'kids-martial-arts', 'kids-self-defense']);
  });

  it('orders by category even when `order` disagrees', () => {
    const shuffled = [
      course('c', 'adult', 'combat', { order: 1 }),
      course('w', 'adult', 'weapon', { order: 9 }),
      course('f', 'adult', 'fist', { order: 5 }),
    ];
    expect(ids(cardsFor(shuffled, 'adult'))).toEqual(['w', 'f', 'c']);
  });

  it('skips a category that has no course instead of inventing one', () => {
    const partial = [course('w', 'kid', 'weapon'), course('c', 'kid', 'combat')];
    expect(ids(cardsFor(partial, 'kid'))).toEqual(['w', 'c']);
    expect(cardsFor([], 'adult')).toEqual([]);
  });

  it('never includes "other" or all-audience courses', () => {
    expect(ids(cardsFor(all, 'adult'))).not.toContain('bjj');
  });

  // 業主 2026-11-21：小孩課程裡再放一個「幼兒武術」（分類是其他、只給小孩）。
  it('appends published "other" courses of that audience only, after the three main ones, by order', () => {
    const withToddler = [
      ...all,
      course('toddler', 'kid', 'other', { order: 23 }),
      course('teen', 'kid', 'other', { order: 22, published: false }),
    ];
    expect(ids(cardsFor(withToddler, 'kid'))).toEqual(['kids-weapons', 'kids-martial-arts', 'kids-self-defense', 'toddler']);
    expect(ids(cardsFor(withToddler, 'adult'))).toEqual(['chinese-weapons', 'bajiquan', 'sanshou']);
  });
});

describe('otherCourses', () => {
  it('lists published courses in the "other" category by order', () => {
    expect(ids(otherCourses(all))).toEqual(['core-yoga', 'bjj']);
  });

  it('leaves out single-audience "other" courses (they sit with that audience\'s cards)', () => {
    expect(ids(otherCourses([...all, course('toddler', 'kid', 'other', { order: 1 })]))).toEqual(['core-yoga', 'bjj']);
  });
});

describe('pairByCategory with an extra kid course', () => {
  it('ignores "other" courses (the homepage beats stay weapon, fist, combat)', () => {
    const pairs = pairByCategory([...all, course('toddler', 'kid', 'other', { order: 1 })]);
    expect(pairs.map((p) => p.kid?.id)).toEqual(['kids-weapons', 'kids-martial-arts', 'kids-self-defense']);
  });
});

describe('pairByCategory', () => {
  it('pairs the adult and kid course of each main category', () => {
    const pairs = pairByCategory(all);
    expect(pairs.map((p) => p.category)).toEqual(['weapon', 'fist', 'combat']);
    expect(pairs.map((p) => [p.adult?.id, p.kid?.id])).toEqual([
      ['chinese-weapons', 'kids-weapons'],
      ['bajiquan', 'kids-martial-arts'],
      ['sanshou', 'kids-self-defense'],
    ]);
  });

  it('leaves a side undefined when missing', () => {
    const pairs = pairByCategory([course('w', 'adult', 'weapon')]);
    expect(pairs[0]).toMatchObject({ category: 'weapon', kid: undefined });
    expect(pairs[0]?.adult?.id).toBe('w');
  });
});

describe('pagePhotos', () => {
  it('drops card-only photos (video stills used only by the course card) and keeps order', () => {
    const photos = [
      { src: 'a', cardOnly: false },
      { src: 'still', cardOnly: true },
      { src: 'b' },
    ];
    expect(pagePhotos(photos).map((p) => p.src)).toEqual(['a', 'b']);
  });

  it('returns an empty list when every photo is card-only, and does not mutate the input', () => {
    const photos = [{ src: 'still', cardOnly: true }];
    expect(pagePhotos(photos)).toEqual([]);
    expect(photos).toHaveLength(1);
    expect(pagePhotos([])).toEqual([]);
  });
});

describe('coursesOfCoach', () => {
  it('returns published courses taught by the coach', () => {
    expect(ids(coursesOfCoach(all, 'chan'))).toEqual(['chinese-weapons', 'bajiquan', 'sanshou']);
    expect(coursesOfCoach(all, 'nobody')).toEqual([]);
  });
});
