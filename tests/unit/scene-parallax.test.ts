import { describe, expect, it } from 'vitest';
import {
  homeShift,
  layerTransform,
  LAYER_KINDS,
  SCROLL_SPEED,
  scrollOffset,
  TILT_MAX_PX,
  tiltOffset,
  type LayerKind,
} from '../../src/lib/scene/parallax';

// 剪影場景的視差計算（Task 27）：各層捲動速率不同、滑鼠微傾有上限、減少動態時全部歸零。純函式，不碰 DOM。

describe('SCROLL_SPEED（各層相對頁面捲動的速度）', () => {
  it('由遠到近嚴格遞增：遠景最慢、前景最快；人物與頁面同速（它是畫面的錨）', () => {
    const [far, mid, subject, fg] = LAYER_KINDS.map((kind) => SCROLL_SPEED[kind]);
    expect(far!).toBeLessThan(mid!);
    expect(mid!).toBeLessThan(subject!);
    expect(subject!).toBeLessThan(fg!);
    expect(subject).toBe(1);
  });
});

describe('scrollOffset', () => {
  it('沒捲動時每一層都在原位（位移 0）', () => {
    for (const kind of LAYER_KINDS) expect(scrollOffset(kind, 0, 500, false), kind).toBe(0);
  });

  it('捲動 300px 後四層位移互不相同，而且遠景往下、前景往上（遠 > 中 > 人物 0 > 前景）', () => {
    const offsets = LAYER_KINDS.map((kind) => scrollOffset(kind, 300, 500, false));
    expect(new Set(offsets).size).toBe(4);
    const [far, mid, subject, fg] = offsets;
    expect(far!).toBeGreaterThan(mid!);
    expect(mid!).toBeGreaterThan(subject!);
    expect(subject).toBe(0);
    expect(subject!).toBeGreaterThan(fg!);
  });

  it('位移 = 捲動量 ×（1 − 速度）', () => {
    for (const kind of LAYER_KINDS) expect(scrollOffset(kind, 200, 500, false)).toBeCloseTo(200 * (1 - SCROLL_SPEED[kind]), 6);
  });

  it('捲過場景高度之後不再增加（場景已離開視窗，不讓層漂得無限遠）', () => {
    for (const kind of LAYER_KINDS) {
      expect(scrollOffset(kind, 5000, 500, false), kind).toBeCloseTo(scrollOffset(kind, 500, 500, false), 6);
    }
  });

  it('負的捲動量（橡皮筋回彈）視為 0', () => {
    for (const kind of LAYER_KINDS) expect(scrollOffset(kind, -80, 500, false), kind).toBe(0);
  });

  it('減少動態：永遠是 0', () => {
    for (const kind of LAYER_KINDS) expect(scrollOffset(kind, 300, 500, true), kind).toBe(0);
  });

  it('場景高度不合理（0、NaN）時不丟錯、回 0', () => {
    for (const kind of LAYER_KINDS) {
      expect(scrollOffset(kind, 300, 0, false)).toBe(0);
      expect(scrollOffset(kind, 300, Number.NaN, false)).toBe(0);
    }
  });
});

describe('tiltOffset（滑鼠微傾）', () => {
  const corners = [
    { x: 1, y: 1 },
    { x: -1, y: -1 },
    { x: 9, y: -9 }, // 超出 −1…1 的輸入要夾住
    { x: -9, y: 9 },
  ];

  it('每一層在任何輸入下都不超過自己的上限，且最大的上限在「幾 px 到十幾 px」之間', () => {
    for (const kind of LAYER_KINDS) {
      for (const pointer of corners) {
        const { x, y } = tiltOffset(kind, pointer, false);
        expect(Math.abs(x), `${kind} x`).toBeLessThanOrEqual(TILT_MAX_PX[kind]);
        expect(Math.abs(y), `${kind} y`).toBeLessThanOrEqual(TILT_MAX_PX[kind]);
      }
    }
    const biggest = Math.max(...LAYER_KINDS.map((kind) => TILT_MAX_PX[kind]));
    expect(biggest).toBeGreaterThanOrEqual(8);
    expect(biggest).toBeLessThanOrEqual(16);
  });

  it('越近的層位移上限越大（遠景幾乎不動、前景動最多）', () => {
    const caps = LAYER_KINDS.map((kind) => TILT_MAX_PX[kind]);
    for (let i = 1; i < caps.length; i++) expect(caps[i]!, LAYER_KINDS[i]).toBeGreaterThan(caps[i - 1]!);
  });

  it('近景與遠景往相反方向位移（指標往右，前景往左、遠景往右；視差的方向）', () => {
    expect(tiltOffset('fg', { x: 1, y: 0 }, false).x).toBeLessThan(0);
    expect(tiltOffset('far', { x: 1, y: 0 }, false).x).toBeGreaterThan(0);
  });

  it('指標在中央 → 不位移；沒有指標（觸控、未移動）→ 不位移', () => {
    for (const kind of LAYER_KINDS) {
      expect(tiltOffset(kind, { x: 0, y: 0 }, false)).toEqual({ x: 0, y: 0 });
      expect(tiltOffset(kind, null, false)).toEqual({ x: 0, y: 0 });
    }
  });

  it('減少動態：永遠是 0（含負零也不得出現）', () => {
    for (const kind of LAYER_KINDS) {
      for (const pointer of corners) {
        const { x, y } = tiltOffset(kind, pointer, true);
        expect(Object.is(x, 0), `${kind} x`).toBe(true);
        expect(Object.is(y, 0), `${kind} y`).toBe(true);
      }
    }
  });

  it('NaN 的指標座標當作沒有', () => {
    expect(tiltOffset('fg', { x: Number.NaN, y: 0.5 }, false)).toEqual({ x: 0, y: 0 });
  });
});

describe('layerTransform', () => {
  it('捲動位移與滑鼠位移相加，輸出 translate3d，捨入到 0.1 px（不產生次像素抖動字串）', () => {
    expect(layerTransform('fg', { scrollY: 200, sceneHeight: 500, pointer: { x: 0.5, y: 0 }, reduced: false })).toMatch(/^translate3d\(-?\d+(\.\d)?px, -?\d+(\.\d)?px, 0\)$/);
  });

  it('減少動態或沒有任何位移：回 `translate3d(0px, 0px, 0)`（不是空字串，方便測試判斷「歸零」）', () => {
    for (const kind of LAYER_KINDS) {
      expect(layerTransform(kind, { scrollY: 300, sceneHeight: 500, pointer: { x: 1, y: 1 }, reduced: true })).toBe('translate3d(0px, 0px, 0)');
      expect(layerTransform(kind, { scrollY: 0, sceneHeight: 500, pointer: null, reduced: false })).toBe('translate3d(0px, 0px, 0)');
    }
  });

  it('四層在同一個輸入下的字串互不相同', () => {
    const input = { scrollY: 240, sceneHeight: 500, pointer: { x: 0.6, y: -0.4 }, reduced: false };
    const all = LAYER_KINDS.map((kind: LayerKind) => layerTransform(kind, input));
    expect(new Set(all).size).toBe(4);
  });
});

describe('homeShift（首頁固定景深層：依整頁捲動進度 0–1 位移）', () => {
  it('進度 0.5 在原位；0 與 1 對稱；遠景幅度最小、前景最大', () => {
    const vh = 900;
    for (const kind of ['far', 'mid', 'fg'] as const) {
      expect(homeShift(kind, 0.5, vh, false), kind).toBeCloseTo(0, 6);
      expect(homeShift(kind, 0, vh, false), kind).toBeCloseTo(-homeShift(kind, 1, vh, false), 6);
    }
    const amp = (kind: 'far' | 'mid' | 'fg') => Math.abs(homeShift(kind, 1, vh, false));
    expect(amp('far')).toBeLessThan(amp('mid'));
    expect(amp('mid')).toBeLessThan(amp('fg'));
  });

  it('捲動時前景位移的方向與遠景相反（近的比內容動得快、遠的比內容動得慢）', () => {
    expect(Math.sign(homeShift('far', 1, 900, false))).toBe(-Math.sign(homeShift('fg', 1, 900, false)));
  });

  it('進度超出 0–1 要夾住；視窗高度不合理回 0；減少動態回 0', () => {
    expect(homeShift('fg', 7, 900, false)).toBeCloseTo(homeShift('fg', 1, 900, false), 6);
    expect(homeShift('fg', -3, 900, false)).toBeCloseTo(homeShift('fg', 0, 900, false), 6);
    expect(homeShift('fg', 1, 0, false)).toBe(0);
    expect(Object.is(homeShift('fg', 1, 900, true), 0)).toBe(true);
  });
});
