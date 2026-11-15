import { describe, expect, it } from 'vitest';
import {
  SLASH_LIFE_MS,
  SLASH_MAX_POINTS,
  SLASH_MIN_SPEED,
  addSample,
  createTrail,
  diagonalCut,
  pointStrength,
  pruneTrail,
  trailRibbon,
} from '../../src/lib/arsenal/slash';

/** 以固定速度（px/ms）往右畫 n 個取樣，每 16ms 一個。 */
function stroke(speed: number, n: number, t0 = 0) {
  let trail = createTrail();
  for (let i = 0; i < n; i++) trail = addSample(trail, { x: i * speed * 16, y: 100, t: t0 + i * 16 });
  return trail;
}

describe('刀光軌跡：取樣', () => {
  it('夠快的拖曳才留下刀光', () => {
    expect(stroke(SLASH_MIN_SPEED * 3, 8).points.length).toBeGreaterThanOrEqual(6);
  });

  it('慢慢移動不留刀光', () => {
    expect(stroke(SLASH_MIN_SPEED * 0.3, 20).points).toHaveLength(0);
  });

  it('第一個取樣只記位置，不出點（沒有速度可算）', () => {
    expect(addSample(createTrail(), { x: 0, y: 0, t: 0 }).points).toHaveLength(0);
  });

  it('時間沒有前進的重複取樣不會算出無限大的速度', () => {
    let trail = addSample(createTrail(), { x: 0, y: 0, t: 5 });
    trail = addSample(trail, { x: 400, y: 0, t: 5 });
    expect(trail.points).toHaveLength(0);
  });

  it('太密的取樣會略過，點數有上限', () => {
    let trail = createTrail();
    for (let i = 0; i < 400; i++) trail = addSample(trail, { x: i * 40, y: 0, t: i * 4 });
    expect(trail.points.length).toBeLessThanOrEqual(SLASH_MAX_POINTS);
    // 最新的點留著，丟的是最舊的。
    expect(trail.points.at(-1)!.x).toBe(399 * 40);
  });

  it('停頓後再拖是新的一刀：不會把兩刀連成一線', () => {
    let trail = stroke(SLASH_MIN_SPEED * 3, 6);
    const last = trail.points.at(-1)!;
    trail = addSample(trail, { x: last.x + 900, y: 600, t: last.t + 16 + 400 });
    trail = addSample(trail, { x: last.x + 1000, y: 600, t: last.t + 16 + 416 });
    const [fresh, following] = trail.points.slice(-2);
    expect(fresh).toMatchObject({ x: last.x + 900, start: true });
    expect(following!.start).toBeUndefined();
  });
});

describe('刀光軌跡：衰減', () => {
  it('強度隨時間由 1 降到 0', () => {
    const point = { x: 0, y: 0, t: 1000 };
    expect(pointStrength(point, 1000)).toBe(1);
    const mid = pointStrength(point, 1000 + SLASH_LIFE_MS / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(pointStrength(point, 1000 + SLASH_LIFE_MS)).toBe(0);
    expect(pointStrength(point, 1000 + SLASH_LIFE_MS * 5)).toBe(0);
  });

  it('時鐘倒退（取樣時間比現在晚）也不會超過 1', () => {
    expect(pointStrength({ x: 0, y: 0, t: 2000 }, 1000)).toBe(1);
  });

  it('過期的點會被清掉，全部過期後軌跡是空的', () => {
    const trail = stroke(SLASH_MIN_SPEED * 3, 8);
    const lastT = trail.points.at(-1)!.t;
    expect(pruneTrail(trail, lastT + SLASH_LIFE_MS / 2).points.length).toBeGreaterThan(0);
    expect(pruneTrail(trail, lastT + SLASH_LIFE_MS + 1).points).toHaveLength(0);
  });
});

describe('刀光軌跡：帶狀外形', () => {
  it('少於兩點畫不出刀光', () => {
    expect(trailRibbon(createTrail(), 0, 20)).toEqual([]);
  });

  it('兩端收尖、中段最寬，寬度不超過上限', () => {
    const trail = stroke(SLASH_MIN_SPEED * 3, 12);
    const now = trail.points.at(-1)!.t;
    const [ribbon] = trailRibbon(trail, now, 20);
    expect(ribbon).toBeDefined();
    const widths = ribbon!.left.map((p, i) => Math.hypot(p.x - ribbon!.right[i]!.x, p.y - ribbon!.right[i]!.y));
    expect(widths[0]).toBeLessThan(1);
    expect(widths.at(-1)!).toBeLessThan(1);
    expect(Math.max(...widths)).toBeGreaterThan(4);
    expect(Math.max(...widths)).toBeLessThanOrEqual(20);
  });

  it('兩刀各自成帶', () => {
    let trail = stroke(SLASH_MIN_SPEED * 3, 6);
    const last = trail.points.at(-1)!;
    for (let i = 0; i < 6; i++) {
      trail = addSample(trail, { x: 50 + i * 60, y: 500, t: last.t + 300 + i * 16 });
    }
    expect(trailRibbon(trail, trail.points.at(-1)!.t, 20)).toHaveLength(2);
  });
});

describe('轉場的斜向刀光', () => {
  it('從畫面一角斜劈到對角，方向可左可右', () => {
    const right = diagonalCut({ width: 1000, height: 600, direction: 1, t: 0, durationMs: 200 });
    const left = diagonalCut({ width: 1000, height: 600, direction: -1, t: 0, durationMs: 200 });
    expect(right.length).toBeGreaterThan(8);
    expect(right[0]!.x).toBeLessThan(right.at(-1)!.x);
    expect(left[0]!.x).toBeGreaterThan(left.at(-1)!.x);
    // 橫跨整個寬度。
    expect(Math.abs(right.at(-1)!.x - right[0]!.x)).toBeGreaterThanOrEqual(1000);
    // 由上往下劈。
    expect(right.at(-1)!.y).toBeGreaterThan(right[0]!.y);
    expect(right[0]!.start).toBe(true);
    // 時間落在指定的長度內。
    expect(right.at(-1)!.t - right[0]!.t).toBeCloseTo(200, 5);
  });
});
