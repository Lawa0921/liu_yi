import { describe, expect, it } from 'vitest';
import { GATHER_SCROLL_VIEWPORTS, GATHER_SECONDS, GATHER_START_SCATTER, gatherByScroll, gatherByTime, gatherModeOf } from '../../src/qi/engine/gather';

/** 404 與場地的「慢慢聚成形體」（Task 26）：散開量隨時間或捲動位置降到 0。 */
describe('gatherByTime', () => {
  it('開始時是 GATHER_START_SCATTER（不從全散開 1 起算：彈簧太弱形體聚不起來），單調下降，GATHER_SECONDS 秒後是 0', () => {
    expect(GATHER_START_SCATTER).toBeLessThan(1);
    expect(gatherByTime(0)).toBeCloseTo(GATHER_START_SCATTER, 10);
    let last = gatherByTime(0);
    for (let t = 0.25; t <= GATHER_SECONDS; t += 0.25) {
      const now = gatherByTime(t);
      expect(now, `t=${t}`).toBeLessThanOrEqual(last + 1e-12);
      last = now;
    }
    expect(gatherByTime(GATHER_SECONDS)).toBe(0);
    expect(gatherByTime(GATHER_SECONDS * 3)).toBe(0);
  });

  it('負的時間（時鐘倒退）夾在起點，不會超過 1', () => {
    expect(gatherByTime(-5)).toBeCloseTo(GATHER_START_SCATTER, 10);
  });

  it('「慢慢」聚：一半的時間過去時還沒聚完（散開量 > 起點的四分之一）', () => {
    expect(gatherByTime(GATHER_SECONDS / 2)).toBeGreaterThan(GATHER_START_SCATTER / 4);
  });
});

describe('gatherByScroll', () => {
  it('頁首最散（GATHER_START_SCATTER）；捲過 GATHER_SCROLL_VIEWPORTS 個視窗高聚齊（0）；中間線性', () => {
    const vh = 900;
    const max = 4000;
    expect(gatherByScroll(0, vh, max)).toBeCloseTo(GATHER_START_SCATTER, 10);
    expect(gatherByScroll(GATHER_SCROLL_VIEWPORTS * vh, vh, max)).toBe(0);
    expect(gatherByScroll(GATHER_SCROLL_VIEWPORTS * vh * 0.5, vh, max)).toBeCloseTo(GATHER_START_SCATTER / 2, 10);
    expect(gatherByScroll(99_999, vh, max)).toBe(0);
    expect(gatherByScroll(-100, vh, max)).toBeCloseTo(GATHER_START_SCATTER, 10);
  });

  it('頁面只能捲一點點：捲到底（最大捲動量的九成處）就聚齊，不要求捲過 0.6 個視窗高', () => {
    expect(gatherByScroll(180, 900, 200)).toBe(0);
  });

  it('頁面捲不動（max ≤ 40）：直接聚好；視窗高無效也不崩潰', () => {
    expect(gatherByScroll(0, 900, 0)).toBe(0);
    expect(gatherByScroll(0, 900, 40)).toBe(0);
    expect(gatherByScroll(0, 0, 4000)).toBe(0);
  });

  it('捲動位置不是有限值：當作還在頁首（最散），不回 NaN', () => {
    expect(gatherByScroll(Number.NaN, 900, 4000)).toBeCloseTo(GATHER_START_SCATTER, 10);
  });
});

describe('gatherModeOf', () => {
  it('404 依時間；場地寬螢幕依捲動、窄螢幕依時間；其餘頁面一開始就是形體', () => {
    expect(gatherModeOf('lost', true)).toBe('time');
    expect(gatherModeOf('lost', false)).toBe('time');
    expect(gatherModeOf('facility', true)).toBe('scroll');
    expect(gatherModeOf('facility', false)).toBe('time');
    for (const kind of ['courses', 'course', 'coaches', 'coach', 'pricing', 'schedule'] as const) {
      expect(gatherModeOf(kind, true), kind).toBe('none');
      expect(gatherModeOf(kind, false), kind).toBe('none');
    }
  });
});
