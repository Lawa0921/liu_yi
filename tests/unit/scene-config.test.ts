import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_SCENES,
  COURSE_SCENES,
  HOME_DEPTH,
  MID_BY_BEAT,
  PAGE_SCENES,
  sceneAssets,
  sceneForCourse,
  sceneSignature,
  type PageSceneKind,
  type SceneSpec,
} from '../../src/lib/scene/config';
import { BEATS } from '../../src/qi/config/poses';

// 頁面與場景的配對表（Task 27）：每頁都有場景、四層齊全、素材都在、組合不重複。

const SILHOUETTES = new URL('../../src/assets/silhouettes/', import.meta.url);
const COURSES = new URL('../../src/content/courses/', import.meta.url);

interface CourseRow {
  id: string;
  audience: 'adult' | 'kid' | 'all';
  category: 'weapon' | 'fist' | 'combat' | 'other';
  published: boolean;
}

/** 讀內容集合的 frontmatter（不經 Astro，單元測試直接掃檔）。 */
function readCourses(): CourseRow[] {
  return readdirSync(COURSES)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const text = readFileSync(fileURLToPath(new URL(name, COURSES)), 'utf8');
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
      const field = (key: string) => new RegExp(`^${key}:\\s*(\\S+)`, 'm').exec(front)?.[1];
      return {
        id: name.replace(/\.md$/, ''),
        audience: field('audience') as CourseRow['audience'],
        category: field('category') as CourseRow['category'],
        published: field('published') === 'true',
      };
    });
}

const PAGE_KINDS: PageSceneKind[] = ['courses', 'coaches', 'coach', 'facility', 'pricing', 'schedule', 'lost'];
const published = readCourses().filter((course) => course.published);

describe('場景配對表', () => {
  it('每種頁面都有場景，而且沒有多餘的鍵', () => {
    expect(Object.keys(PAGE_SCENES).sort()).toEqual([...PAGE_KINDS].sort());
  });

  it('每個場景四層都在：遠景、中景、人物（或場地的主體）、前景 1–2 張', () => {
    const all: [string, SceneSpec][] = [
      ...Object.entries(PAGE_SCENES),
      ...Object.entries(COURSE_SCENES),
      ...Object.entries(CATEGORY_SCENES).flatMap(([key, group]) => Object.entries(group).map(([kind, spec]) => [`${key}/${kind}`, spec] as [string, SceneSpec])),
    ];
    expect(all.length).toBeGreaterThan(10);
    for (const [name, spec] of all) {
      expect(spec.far.asset, `${name} far`).toMatch(/^bg-far-/);
      expect(spec.mid.asset, `${name} mid`).toMatch(/^(bg-mid|mid)-/);
      expect(spec.subject.asset, `${name} subject`).toBeTruthy();
      expect(spec.fg.length, `${name} fg`).toBeGreaterThanOrEqual(1);
      expect(spec.fg.length, `${name} fg`).toBeLessThanOrEqual(2);
      for (const fg of spec.fg) expect(fg.asset, `${name} fg`).toMatch(/^fg-/);
    }
  });

  it('引用的每張素材都真的存在（webp）', () => {
    const names = new Set<string>();
    for (const spec of [...Object.values(PAGE_SCENES), ...Object.values(COURSE_SCENES), ...Object.values(CATEGORY_SCENES).flatMap((group) => Object.values(group))]) {
      for (const asset of sceneAssets(spec)) names.add(asset);
    }
    for (const asset of names) expect(existsSync(fileURLToPath(new URL(`${asset}.webp`, SILHOUETTES))), asset).toBe(true);
  });

  it('組合不重複：所有頁面種類與每一門已發布課程的場景簽章互不相同', () => {
    const signatures = new Map<string, string>();
    const add = (label: string, spec: SceneSpec) => {
      const signature = sceneSignature(spec);
      expect(signatures.get(signature), `「${label}」與「${signatures.get(signature)}」撞組合：${signature}`).toBeUndefined();
      signatures.set(signature, label);
    };
    for (const kind of PAGE_KINDS) add(`頁面 ${kind}`, PAGE_SCENES[kind]);
    for (const course of published) add(`課程 ${course.id}`, sceneForCourse(course));
    expect(signatures.size).toBe(PAGE_KINDS.length + published.length);
  });

  it('每一門已發布課程的人物都是專屬的：不與其他課程共用同一張人物剪影', () => {
    const subjects = published.map((course) => sceneForCourse(course).subject.asset);
    expect(new Set(subjects).size, subjects.join('、')).toBe(subjects.length);
  });

  it('課程內頁：拳、格鬥、兵器與兒童版各用對應的剪影', () => {
    const byId = Object.fromEntries(published.map((course) => [course.id, sceneForCourse(course)]));
    expect(byId['bajiquan']!.subject.asset).toBe('fig-dingzhou');
    expect(byId['sanshou']!.subject.asset).toBe('fig-chengchui');
    expect(byId['chinese-weapons']!.subject.asset).toBe('fig-jian');
    expect(byId['kids-martial-arts']!.subject.asset).toBe('fig-kid-wushu');
    expect(byId['kids-self-defense']!.subject.asset).toBe('fig-kid-defense-a');
    expect(byId['kids-weapons']!.subject.asset).toBe('fig-kid-weapon');
  });

  it('師資與教練頁用抱拳（salute）；場地沒有人物（空場，主體是場上的器具）；404 是單一人物收勢（salute）', () => {
    expect(PAGE_SCENES.coaches.subject.asset).toBe('fig-salute');
    expect(PAGE_SCENES.coach.subject.asset).toBe('fig-salute');
    expect(PAGE_SCENES.lost.subject.asset).toBe('fig-salute');
    expect(PAGE_SCENES.facility.subject.asset).not.toMatch(/^fig-/);
  });

  it('新增的課程（表裡沒有）依分類與對象退回預設場景，不會缺層', () => {
    for (const category of ['weapon', 'fist', 'combat', 'other'] as const) {
      for (const audience of ['adult', 'kid', 'all'] as const) {
        const spec = sceneForCourse({ id: 'brand-new-course', category, audience });
        expect(spec.far.asset).toBeTruthy();
        expect(spec.mid.asset).toBeTruthy();
        expect(spec.subject.asset).toBeTruthy();
        expect(spec.fg.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('首頁景深（HOME_DEPTH、MID_BY_BEAT）', () => {
  it('遠景一張、前景 1–2 張，素材都在', () => {
    expect(HOME_DEPTH.far.asset).toMatch(/^bg-far-/);
    expect(HOME_DEPTH.fg.length).toBeGreaterThanOrEqual(1);
    expect(HOME_DEPTH.fg.length).toBeLessThanOrEqual(2);
    for (const asset of [HOME_DEPTH.far.asset, ...HOME_DEPTH.fg.map((fg) => fg.asset), ...Object.values(HOME_DEPTH.mids).map((mid) => mid.asset)]) {
      expect(existsSync(fileURLToPath(new URL(`${asset}.webp`, SILHOUETTES))), asset).toBe(true);
    }
  });

  it('每個 beat 都有中景，且都是 HOME_DEPTH.mids 裡的一種；兵器三段是兵器架，開場是院門', () => {
    for (const beat of BEATS) expect(Object.keys(HOME_DEPTH.mids), beat).toContain(MID_BY_BEAT[beat]);
    expect(MID_BY_BEAT['opening']).toBe('gate');
    for (const beat of ['weapon-a', 'weapon-b', 'weapon-c'] as const) expect(MID_BY_BEAT[beat]).toBe('rack');
    expect(new Set(Object.values(MID_BY_BEAT)).size).toBeGreaterThanOrEqual(3);
  });
});
