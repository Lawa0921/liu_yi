import { describe, expect, it } from 'vitest';
import { FIGURE_WORLD, SLOT_FILL, slotFrame, windowKey } from '../../src/qi/engine/slot';

/**
 * 槽取景（Task 26）：非首頁的頁面把形體擺進指定的矩形（右側欄、頁首的一條、整張畫布）。
 * 世界點 (x, y) 在 z = 0 平面上的螢幕位置 = 畫布中心 + ((x − lookX), −(y − lookY)) × pxPerWorld。
 */
const screenOf = (canvas: { w: number; h: number }, f: NonNullable<ReturnType<typeof slotFrame>>, x: number, y: number) => ({
  x: canvas.w / 2 + (x - f.framing.lookX) * f.pxPerWorld,
  y: canvas.h / 2 - (y - f.framing.lookY) * f.pxPerWorld,
});

describe('slotFrame', () => {
  const canvas = { w: 1412, h: 772 };
  const rail = { x: 952, y: 0, w: 460, h: 772 }; // 1440×900 的右側欄

  it('世界的 (0, cy) 落在槽的正中央（右側欄、頁首、整張畫布都一樣）', () => {
    const cases = [
      { c: canvas, slot: rail },
      { c: { w: 390, h: 776 }, slot: { x: 20, y: 40, w: 350, h: 180 } },
      { c: canvas, slot: { x: 0, y: 0, w: canvas.w, h: canvas.h } },
    ];
    for (const { c, slot } of cases) {
      const f = slotFrame(c, slot, FIGURE_WORLD)!;
      const p = screenOf(c, f, 0, FIGURE_WORLD.cy);
      expect(p.x).toBeCloseTo(slot.x + slot.w / 2, 6);
      expect(p.y).toBeCloseTo(slot.y + slot.h / 2, 6);
    }
  });

  it('每世界單位的 px ＝ 槽的寬、高各自放得下世界大小中較小的那個，再乘 SLOT_FILL', () => {
    expect(SLOT_FILL).toBeLessThan(1);
    const f = slotFrame(canvas, rail, FIGURE_WORLD)!;
    // 右側欄窄而高：寬度決定
    expect(f.pxPerWorld).toBeCloseTo((460 * SLOT_FILL) / FIGURE_WORLD.w, 8);
    // 槽寬而矮（頁首的一條）：高度決定
    const band = slotFrame({ w: 1000, h: 800 }, { x: 0, y: 0, w: 900, h: 200 }, FIGURE_WORLD)!;
    expect(band.pxPerWorld).toBeCloseTo((200 * SLOT_FILL) / 2, 8);
  });

  it('可視高 ＝ 畫布高 ÷ pxPerWorld（相機看到的世界高度）', () => {
    const f = slotFrame(canvas, rail, FIGURE_WORLD)!;
    expect(f.framing.visibleH).toBeCloseTo(canvas.h / f.pxPerWorld, 8);
  });

  it('視窗（halfWidth／halfHeight）是槽在世界座標裡的半寬、半高（已乘 SLOT_FILL）：視窗的邊投影後落在槽的邊內', () => {
    const f = slotFrame(canvas, rail, FIGURE_WORLD)!;
    const right = screenOf(canvas, f, f.halfWidth, f.cy);
    const top = screenOf(canvas, f, 0, f.cy + f.halfHeight);
    expect(right.x).toBeLessThanOrEqual(rail.x + rail.w + 1e-6);
    expect(right.x).toBeCloseTo(rail.x + rail.w / 2 + (rail.w * SLOT_FILL) / 2, 6);
    expect(top.y).toBeGreaterThanOrEqual(rail.y - 1e-6);
  });

  it('槽或畫布沒有大小、座標不是有限值時回 null（呼叫端退回預設取景，不崩潰）', () => {
    expect(slotFrame(canvas, { x: 0, y: 0, w: 0, h: 100 }, FIGURE_WORLD)).toBeNull();
    expect(slotFrame(canvas, { x: 0, y: 0, w: 100, h: -1 }, FIGURE_WORLD)).toBeNull();
    expect(slotFrame({ w: 0, h: 0 }, rail, FIGURE_WORLD)).toBeNull();
    expect(slotFrame(canvas, { x: Number.NaN, y: 0, w: 100, h: 100 }, FIGURE_WORLD)).toBeNull();
    expect(slotFrame(canvas, rail, { w: 0, h: 2, cy: 1 })).toBeNull();
  });

  it('windowKey 只看視窗大小：槽上下移動（頁首的槽隨捲動）鍵不變，槽縮放鍵就變', () => {
    const a = slotFrame(canvas, { x: 952, y: 0, w: 460, h: 300 }, FIGURE_WORLD)!;
    const moved = slotFrame(canvas, { x: 952, y: -120, w: 460, h: 300 }, FIGURE_WORLD)!;
    const resized = slotFrame(canvas, { x: 952, y: 0, w: 460, h: 340 }, FIGURE_WORLD)!;
    expect(windowKey(moved)).toBe(windowKey(a));
    expect(windowKey(resized)).not.toBe(windowKey(a));
    expect(moved.framing.lookY).not.toBeCloseTo(a.framing.lookY, 3);
  });
});
