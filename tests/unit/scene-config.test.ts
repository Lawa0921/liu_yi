import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_SCENES,
  COURSE_SCENES,
  FG_ANCHOR,
  fgCorner,
  HOME_DEPTH,
  HOME_FG_LEFT_BEATS,
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
  it('遠景一張、前景兩張（簷角在右上、另一張在左側，框住左右），素材都在', () => {
    expect(HOME_DEPTH.far.asset).toMatch(/^bg-far-/);
    expect(HOME_DEPTH.fg.length).toBe(2);
    expect(new Set(HOME_DEPTH.fg.map((fg) => FG_ANCHOR[fg.asset]!.h)).size, '兩張前景在左右兩側').toBe(2);
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

  it('左下角的窗櫺只在左下角沒有字的段落出現：都是真的 beat，不含開場（站名垂直排到畫面底）與整寬內容的收費、預約', () => {
    for (const beat of HOME_FG_LEFT_BEATS) expect(BEATS, beat).toContain(beat);
    expect(HOME_FG_LEFT_BEATS).not.toContain('opening');
    expect(HOME_FG_LEFT_BEATS).not.toContain('pricing');
    expect(HOME_FG_LEFT_BEATS).not.toContain('booking');
    expect(HOME_FG_LEFT_BEATS.length).toBeGreaterThanOrEqual(4);
  });

  it('格鬥兩段的中景是木人樁（石鎖看起來像「禁止」的符號，已拿掉）；沒有任何場景或中景用到 stonelock', () => {
    expect(MID_BY_BEAT['combat-a']).toBe('dummy');
    expect(MID_BY_BEAT['combat-b']).toBe('dummy');
    expect(HOME_DEPTH.mids.dummy.asset).toBe('mid-dummy');
    expect(Object.keys(HOME_DEPTH.mids).sort()).toEqual(['banner', 'drum', 'dummy', 'gate', 'rack']);
    const everything = [...Object.values(PAGE_SCENES), ...Object.values(COURSE_SCENES), ...Object.values(CATEGORY_SCENES).flatMap((byAudience) => Object.values(byAudience))].flatMap(sceneAssets);
    expect(everything.filter((asset) => /stonelock/.test(asset))).toEqual([]);
    expect(readdirSync(fileURLToPath(SILHOUETTES)).filter((file) => /stonelock/.test(file))).toEqual([]);
  });
});

// 前景的位置（Task 27 修正）：每種前景貼在場景的一個角落；同一個場景的兩張前景要在左右兩側（框住畫面），不能擠在同一個角落
describe('前景的錨點（FG_ANCHOR）', () => {
  const allScenes: [string, SceneSpec][] = [
    ...Object.entries(PAGE_SCENES),
    ...Object.entries(COURSE_SCENES),
    ...Object.entries(CATEGORY_SCENES).flatMap(([category, byAudience]) => Object.entries(byAudience).map(([audience, spec]) => [`${category}/${audience}`, spec] as [string, SceneSpec])),
  ];

  it('廊柱（fg-pillars）整件不用：頂端的平直橫梁呈 T 字，像日本鳥居的一角（設計 §4 反目標）；沒有場景引用、素材與錨點都不在', () => {
    const used = allScenes.flatMap(([, spec]) => spec.fg.map((layer) => layer.asset));
    expect(used.filter((asset) => /pillar/.test(asset))).toEqual([]);
    expect(Object.keys(FG_ANCHOR).filter((asset) => /pillar/.test(asset))).toEqual([]);
    expect(readdirSync(fileURLToPath(SILHOUETTES)).filter((file) => /pillar/.test(file))).toEqual([]);
  });

  it('每一種前景素材都有錨點；翻轉把左右對調', () => {
    const used = new Set(allScenes.flatMap(([, spec]) => spec.fg.map((layer) => layer.asset)));
    for (const asset of used) expect(FG_ANCHOR[asset], asset).toBeTruthy();
    expect(fgCorner({ asset: 'fg-eave' })).toBe('top-right');
    expect(fgCorner({ asset: 'fg-eave', flip: true })).toBe('top-left');
    expect(fgCorner({ asset: 'fg-steps' })).toBe('bottom-left');
    expect(fgCorner({ asset: 'fg-steps', flip: true })).toBe('bottom-right');
  });

  it('每個場景的前景：兩張時在左右兩側（不擠在同一側），最多兩張', () => {
    for (const [name, spec] of allScenes) {
      expect(spec.fg.length, name).toBeLessThanOrEqual(2);
      if (spec.fg.length < 2) continue;
      const sides = spec.fg.map((layer) => fgCorner(layer).split('-')[1]);
      expect(new Set(sides).size, `${name}：${spec.fg.map(fgCorner).join('、')} 擠在同一側`).toBe(2);
    }
  });

  it('具名場景對照（回歸）：兒童武術不再是兩張都在左下；教練頁、收費、兒童防身、核心瑜珈也都左右各一', () => {
    expect(COURSE_SCENES['kids-martial-arts']!.fg.map(fgCorner)).not.toEqual(['bottom-left', 'bottom-left']);
    for (const [name, spec] of [
      ['kids-martial-arts', COURSE_SCENES['kids-martial-arts']!],
      ['kids-self-defense', COURSE_SCENES['kids-self-defense']!],
      ['core-yoga', COURSE_SCENES['core-yoga']!],
      ['coach', PAGE_SCENES.coach],
      ['pricing', PAGE_SCENES.pricing],
    ] as const) {
      expect(new Set(spec.fg.map((layer) => fgCorner(layer).split('-')[1])).size, name).toBe(2);
    }
  });
});
