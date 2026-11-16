import { describe, expect, it } from 'vitest';
import { INTRO_MAX_SCROLL, introState, shouldPlayIntro, type IntroPhase } from '../../src/qi/engine/intro';

const phase = (t: number): IntroPhase => introState(t).phase;

describe('introState：階段（D18）', () => {
  it('取樣點：0.3 handoff、0.8 exhale、1.5 inhale、2.3 hold、2.9 land、3.5 done', () => {
    expect(phase(0.3)).toBe('handoff');
    expect(phase(0.8)).toBe('exhale');
    expect(phase(1.5)).toBe('inhale');
    expect(phase(2.3)).toBe('hold');
    expect(phase(2.9)).toBe('land');
    expect(phase(3.5)).toBe('done');
  });

  it('邊界：每段含起點、不含終點（0／0.6／1.0／2.0／2.7／3.4）', () => {
    expect(phase(0)).toBe('handoff');
    expect(phase(0.5999)).toBe('handoff');
    expect(phase(0.6)).toBe('exhale');
    expect(phase(0.9999)).toBe('exhale');
    expect(phase(1.0)).toBe('inhale');
    expect(phase(1.9999)).toBe('inhale');
    expect(phase(2.0)).toBe('hold');
    expect(phase(2.6999)).toBe('hold');
    expect(phase(2.7)).toBe('land');
    expect(phase(3.3999)).toBe('land');
    expect(phase(3.4)).toBe('done');
    expect(phase(1000)).toBe('done');
  });

  it('負時間視為開頭（handoff）', () => {
    expect(introState(-1)).toEqual(introState(0));
  });
});

describe('introState：springScale', () => {
  it('handoff 為 1（接續靜態圖的聚合態）', () => {
    expect(introState(0).springScale).toBe(1);
    expect(introState(0.3).springScale).toBe(1);
  });

  it('exhale 為 0.1（彈簧鬆開、光點散出去）', () => {
    expect(introState(0.6).springScale).toBe(0.1);
    expect(introState(0.8).springScale).toBeLessThan(0.2);
    expect(introState(0.8).springScale).toBe(0.1);
  });

  it('inhale：0.1 + 0.9·smoothstep(1, 2, t)，起點 0.1、中點 0.55、終點趨近 1', () => {
    expect(introState(1.0).springScale).toBeCloseTo(0.1, 10);
    expect(introState(1.5).springScale).toBeCloseTo(0.1 + 0.9 * 0.5, 10);
    expect(introState(1.9999).springScale).toBeCloseTo(1, 3);
    const u = 0.25;
    const s = u * u * (3 - 2 * u);
    expect(introState(1.25).springScale).toBeCloseTo(0.1 + 0.9 * s, 10);
  });

  it('inhale 期間單調上升，與 exhale 的 0.1 與之後的 1 銜接不跳', () => {
    let prev = introState(1.0).springScale;
    expect(prev).toBeCloseTo(introState(0.9999).springScale, 10);
    for (let t = 1.01; t < 2.0; t += 0.01) {
      const v = introState(t).springScale;
      expect(v, `t=${t}`).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(introState(1.9999).springScale).toBeCloseTo(introState(2.0).springScale, 3);
  });

  it('hold、land、done 都是 1', () => {
    for (const t of [2.0, 2.3, 2.7, 2.9, 3.4, 3.5, 100]) expect(introState(t).springScale, `t=${t}`).toBe(1);
  });
});

describe('introState：target、groundLevel、inhale', () => {
  it('target：1.0 ≤ t < 2.7 為 lift，其餘為 land', () => {
    expect(introState(0.3).target).toBe('land');
    expect(introState(0.8).target).toBe('land');
    expect(introState(0.9999).target).toBe('land');
    expect(introState(1.0).target).toBe('lift');
    expect(introState(1.5).target).toBe('lift');
    expect(introState(2.3).target).toBe('lift'); // hold 仍維持抬腳
    expect(introState(2.6999).target).toBe('lift');
    expect(introState(2.7).target).toBe('land'); // 落地在 2.7 觸發
    expect(introState(2.9).target).toBe('land');
    expect(introState(3.5).target).toBe('land');
  });

  it('groundLevel 恆為 1（接續靜態圖的終態）', () => {
    for (let t = 0; t <= 4; t += 0.1) expect(introState(t).groundLevel, `t=${t}`).toBe(1);
  });

  it('inhale 只在 inhale 階段由 0 升到 1，其餘為 0', () => {
    expect(introState(0.3).inhale).toBe(0);
    expect(introState(0.8).inhale).toBe(0);
    expect(introState(1.0).inhale).toBe(0);
    expect(introState(1.5).inhale).toBeGreaterThan(0);
    expect(introState(1.5).inhale).toBeLessThan(1);
    expect(introState(1.9999).inhale).toBeGreaterThan(0.99);
    expect(introState(1.9999).inhale).toBeLessThanOrEqual(1);
    expect(introState(2.0).inhale).toBe(0);
    expect(introState(2.3).inhale).toBe(0);
    expect(introState(2.9).inhale).toBe(0);
    expect(introState(3.5).inhale).toBe(0);
  });

  it('inhale 在階段內單調上升', () => {
    let prev = 0;
    for (let t = 1.0; t < 2.0; t += 0.01) {
      const v = introState(t).inhale;
      expect(v, `t=${t}`).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('掃過整段時間軸，所有輸出都是有限值、springScale 在 [0.1, 1]', () => {
    for (let t = -0.5; t < 5; t += 0.013) {
      const s = introState(t);
      expect(Number.isFinite(s.springScale) && Number.isFinite(s.inhale) && Number.isFinite(s.groundLevel)).toBe(true);
      expect(s.springScale).toBeGreaterThanOrEqual(0.1);
      expect(s.springScale).toBeLessThanOrEqual(1);
    }
  });
});

describe('shouldPlayIntro', () => {
  const base = { reducedMotion: false, seen: false, scrollY: 0, viewportH: 900 };

  it('首次進站、動態正常、停在頁首：演', () => {
    expect(shouldPlayIntro(base)).toBe(true);
  });

  it('本工作階段看過（seen）：不演', () => {
    expect(shouldPlayIntro({ ...base, seen: true })).toBe(false);
  });

  it('偏好減少動態：不演', () => {
    expect(shouldPlayIntro({ ...base, reducedMotion: true })).toBe(false);
  });

  it('已捲離頁首超過 0.25 個視窗高（例如帶 #hash 進站或重新整理後還原捲動）：不演', () => {
    expect(shouldPlayIntro({ ...base, scrollY: 0.25 * 900 + 1 })).toBe(false);
    expect(shouldPlayIntro({ ...base, scrollY: 5000 })).toBe(false);
  });

  it('捲動剛好 0.25 個視窗高仍演（> 才算離開）；一點點捲動也演', () => {
    expect(shouldPlayIntro({ ...base, scrollY: 0.25 * 900 })).toBe(true);
    expect(shouldPlayIntro({ ...base, scrollY: 10 })).toBe(true);
  });

  it('橡皮筋上拉（scrollY 為負）仍演', () => {
    expect(shouldPlayIntro({ ...base, scrollY: -40 })).toBe(true);
  });

  it('「還停在頁首」的尺是匯出的 INTRO_MAX_SCROLL（0.25 個視窗高）：首頁腳本捲過它就收尾開場，與這裡同一把', () => {
    expect(INTRO_MAX_SCROLL).toBe(0.25);
    expect(shouldPlayIntro({ ...base, scrollY: INTRO_MAX_SCROLL * 900 })).toBe(true);
    expect(shouldPlayIntro({ ...base, scrollY: INTRO_MAX_SCROLL * 900 + 1 })).toBe(false);
  });

  it('條件互不遮蔽：任何一條不成立就不演', () => {
    expect(shouldPlayIntro({ reducedMotion: true, seen: true, scrollY: 9999, viewportH: 900 })).toBe(false);
  });
});
