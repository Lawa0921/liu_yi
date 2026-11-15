import { describe, expect, it } from 'vitest';
import { STAGE_KINDS, scrollProgress, stagePose, viewportProgress, type StagePose } from '../../src/lib/arsenal/pose';

const FIELDS: (keyof StagePose)[] = ['spin', 'tilt', 'lean', 'x', 'y', 'sheath', 'flare'];

describe('stagePose：捲動進度 → 兵器姿勢', () => {
  it('進度超出 0–1 時夾在兩端', () => {
    for (const kind of STAGE_KINDS) {
      expect(stagePose(kind, -3)).toEqual(stagePose(kind, 0));
      expect(stagePose(kind, 7)).toEqual(stagePose(kind, 1));
      expect(stagePose(kind, Number.NaN)).toEqual(stagePose(kind, 0));
    }
  });

  it('劍一開始在鞘裡，捲到四成已完全出鞘，過程只出不回', () => {
    expect(stagePose('jian', 0).sheath).toBe(0);
    expect(stagePose('jian', 0.4).sheath).toBe(1);
    let last = 0;
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const { sheath } = stagePose('jian', p);
      expect(sheath).toBeGreaterThanOrEqual(last);
      last = sheath;
    }
  });

  it('出鞘後轉身：中段繞自身長軸至少轉半圈', () => {
    const turned = Math.abs(stagePose('jian', 0.75).spin - stagePose('jian', 0.4).spin);
    expect(turned).toBeGreaterThanOrEqual(Math.PI * 0.95);
  });

  it('亮刃只在末段出現，結尾收掉', () => {
    for (const kind of STAGE_KINDS) {
      expect(stagePose(kind, 0.5).flare).toBe(0);
      expect(stagePose(kind, 0.86).flare).toBeGreaterThan(0.8);
      expect(stagePose(kind, 1).flare).toBeLessThan(0.2);
    }
  });

  it('苗刀與大槍沒有鞘：從頭到尾都是出鞘狀態', () => {
    for (const kind of ['miaodao', 'spear'] as const) {
      for (const p of [0, 0.3, 1]) expect(stagePose(kind, p).sheath).toBe(1);
    }
  });

  it('大槍由畫面外橫貫進來，最後停在畫面內', () => {
    expect(Math.abs(stagePose('spear', 0).x)).toBeGreaterThan(1);
    expect(Math.abs(stagePose('spear', 1).x)).toBeLessThan(0.4);
    // 幾乎水平：槍身與水平的夾角很小。
    expect(Math.abs(stagePose('spear', 0.6).lean)).toBeLessThan(0.35);
  });

  it('姿勢連續：相鄰進度之間沒有跳動', () => {
    for (const kind of STAGE_KINDS) {
      for (let p = 0; p < 1; p += 0.005) {
        const a = stagePose(kind, p);
        const b = stagePose(kind, p + 0.005);
        for (const field of FIELDS) {
          expect(Math.abs(b[field] - a[field]), `${kind} ${field} @ ${p.toFixed(3)}`).toBeLessThan(0.12);
        }
      }
    }
  });
});

describe('scrollProgress：不釘選時，幕一路捲進來就把戲演完', () => {
  it('幕剛露出來時還沒開始', () => {
    expect(scrollProgress(0)).toBe(0);
    expect(scrollProgress(0.1)).toBe(0);
  });

  it('幕捲到視窗正中央時已經演到亮刃之後，之後停在最後的姿勢', () => {
    expect(scrollProgress(0.5)).toBeGreaterThanOrEqual(0.88);
    expect(scrollProgress(0.6)).toBe(1);
    expect(scrollProgress(1)).toBe(1);
  });

  it('只增不減', () => {
    let last = 0;
    for (let v = 0; v <= 1; v += 0.01) {
      expect(scrollProgress(v)).toBeGreaterThanOrEqual(last);
      last = scrollProgress(v);
    }
  });
});

describe('viewportProgress：不釘選時由區塊在視窗中的位置換算進度', () => {
  it('區塊頂端剛到視窗底部是 0，區塊底端離開視窗頂端是 1', () => {
    expect(viewportProgress({ top: 800, height: 600, viewportHeight: 800 })).toBe(0);
    expect(viewportProgress({ top: -600, height: 600, viewportHeight: 800 })).toBe(1);
  });

  it('中途是線性的，超出範圍夾住', () => {
    expect(viewportProgress({ top: 100, height: 600, viewportHeight: 800 })).toBeCloseTo(0.5, 5);
    expect(viewportProgress({ top: 5000, height: 600, viewportHeight: 800 })).toBe(0);
    expect(viewportProgress({ top: -5000, height: 600, viewportHeight: 800 })).toBe(1);
  });

  it('高度為 0 也不會除以零', () => {
    expect(viewportProgress({ top: 0, height: 0, viewportHeight: 0 })).toBe(0);
  });
});
