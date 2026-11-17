import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPageKind, PAGE_KINDS, PAGES, poseForCourse, QI_RAIL_QUERY } from '../../src/qi/config/pages';
import { BURSTS } from '../../src/qi/config/poses';
import { SHAPES } from '../../src/qi/config/shapes';

/** 頁面光點層（Task 26）的設定：每種頁面放什麼形體、放在哪裡，與課程對應的姿勢。 */
const css = readFileSync(new URL('../../src/styles/qi-page.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('PAGES', () => {
  it('八種頁面：課程總覽、課程內頁、師資總覽、教練、場地、收費、課表、404', () => {
    expect([...PAGE_KINDS].sort()).toEqual(['coach', 'coaches', 'course', 'courses', 'facility', 'lost', 'pricing', 'schedule']);
  });

  it('每個預設姿勢都有衝量表；除了氣流（flow）都有形體配方', () => {
    for (const kind of PAGE_KINDS) {
      const { pose } = PAGES[kind];
      expect(BURSTS[pose], kind).toBeDefined();
      if (pose !== 'flow') expect(SHAPES[pose], `${kind} → ${pose}`).toBeDefined();
    }
  });

  it('需求的對應：師資與教練抱拳（salute）、場地院門（gate）、收費與課表竹簡（scroll）、404 落地人形（land）、課程總覽氣流（flow）', () => {
    expect(PAGES.coaches.pose).toBe('salute');
    expect(PAGES.coach.pose).toBe('salute');
    expect(PAGES.facility.pose).toBe('gate');
    expect(PAGES.pricing.pose).toBe('scroll');
    expect(PAGES.schedule.pose).toBe('scroll');
    expect(PAGES.lost.pose).toBe('land');
    expect(PAGES.courses.pose).toBe('flow');
  });

  it('竹簡是整張畫布的低亮度背景（field）；其餘是右側欄／頁首的一條（rail）；課程總覽是整張畫布的氣流，形體另在右側欄聚成', () => {
    expect(PAGES.pricing.canvas).toBe('field');
    expect(PAGES.schedule.canvas).toBe('field');
    expect(PAGES.courses.canvas).toBe('field');
    expect(PAGES.courses.slot).toBe('rail');
    for (const kind of ['course', 'coaches', 'coach', 'facility', 'lost'] as const) {
      expect(PAGES[kind].canvas, kind).toBe('rail');
      expect(PAGES[kind].slot, kind).toBe('canvas');
    }
  });

  it('槽要放得下的世界大小都是正數', () => {
    for (const kind of PAGE_KINDS) {
      const { world } = PAGES[kind];
      expect(world.w, kind).toBeGreaterThan(0);
      expect(world.h, kind).toBeGreaterThan(0);
      expect(Number.isFinite(world.cy), kind).toBe(true);
    }
  });

  it('isPageKind：認得八種，其餘（含原型鏈名稱、undefined）不認', () => {
    for (const kind of PAGE_KINDS) expect(isPageKind(kind)).toBe(true);
    for (const bad of ['home', 'constructor', '__proto__', '', undefined]) expect(isPageKind(bad as string | undefined)).toBe(false);
  });
});

describe('poseForCourse（課程頁與課程卡對應的姿勢）', () => {
  it.each([
    ['fist', 'adult', 'dingzhou'],
    ['combat', 'adult', 'chengchui'],
    ['weapon', 'adult', 'jian'],
    ['fist', 'kid', 'kid-wushu'],
    ['combat', 'kid', 'kid-defense-a'],
    ['weapon', 'kid', 'kid-weapon'],
    ['other', 'all', 'others'],
    ['other', 'adult', 'others'],
    ['other', 'kid', 'others'],
    ['fist', 'all', 'dingzhou'],
  ] as const)('%s × %s → %s', (category, audience, pose) => {
    expect(poseForCourse({ category, audience })).toBe(pose);
    expect(SHAPES[pose]).toBeDefined();
  });
});

describe('右側欄的條件：腳本（matchMedia）與樣式（qi-page.css）是同一條', () => {
  it('QI_RAIL_QUERY 逐字出現在 qi-page.css 的 @media 裡', () => {
    expect(css).toContain(`@media ${QI_RAIL_QUERY}`);
  });

  it('寬螢幕（≥ 80rem）且不是近方形（寬高比 ≥ 4:3）才有右側欄', () => {
    expect(QI_RAIL_QUERY).toBe('(min-width: 80rem) and (min-aspect-ratio: 4/3)');
  });
});

describe('qi-page.css 的守則', () => {
  it('光點層在內容底下（z-index: -1）、不接收指標事件', () => {
    const rule = /\.qi-backdrop\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/z-index\s*:\s*-1/);
    expect(rule).toMatch(/pointer-events\s*:\s*none/);
  });

  it('高度用 lvh／svh，不用 100vh；沒有強制 scroll-snap', () => {
    expect(css).not.toMatch(/100vh/);
    expect(css).not.toMatch(/scroll-snap-type/);
    expect(css).toMatch(/100lvh/);
    expect(css).toMatch(/svh/);
  });

  it('引擎在跑時靜態圖淡出（data-qi-ready），退回靜態圖（qi-static）或沒有 JS 時畫布不佔位', () => {
    expect(css).toMatch(/html\[data-qi-ready\]\s+\.qi-still\s*\{[^}]*opacity\s*:\s*0/);
    expect(css).toMatch(/html\.qi-static\s+\.qi-canvas/);
    expect(css).toMatch(/html:not\(\.js\)\s+\.qi-canvas/);
  });
});
