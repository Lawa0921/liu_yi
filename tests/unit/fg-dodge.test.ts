import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { clipBox, FG_FADE_OUT_S, FG_OPAQUE_BOX, inflateBox, leadBox, opaqueBox, overlapsAny, trackScroll } from '../../src/lib/scene/fg-dodge';

// 首頁前景在文字經過時淡出（複審 Critical：前景在文字之上，捲動途中會壓住文字）：「前景不透明部分的外框」與「文字矩形有沒有相交」是純函式，
// 這裡驗；腳本（scripts/home/depth.ts）只負責量 DOM 並套用結果，e2e（home-depth.spec 的連續捲動）驗整體。

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height });

describe('opaqueBox（前景整張圖的矩形 → 不透明部分的外框）', () => {
  it('簷角：原圖左側 38% 是空的，外框只取右側 62%；翻轉（scaleX(-1)）後換到左側', () => {
    const image = rect(100, 0, 1536, 672);
    const plain = opaqueBox(image, 'fg-eave', false);
    expect(plain.left).toBeCloseTo(100 + 582, 0);
    expect(plain.right).toBeCloseTo(100 + 1536, 0);
    expect([plain.top, plain.bottom]).toEqual([0, 672]);
    const flipped = opaqueBox(image, 'fg-eave', true);
    expect(flipped.left).toBeCloseTo(100, 0);
    expect(flipped.right).toBeCloseTo(100 + 1536 - 582, 0);
  });

  it('窗櫺是整張不透明（外框就是整張圖的矩形）', () => {
    expect(opaqueBox(rect(10, 20, 300, 200), 'fg-lattice', false)).toEqual(rect(10, 20, 300, 200));
  });

  it('沒有登記的素材：保守地用整張圖的矩形', () => {
    expect(opaqueBox(rect(0, 0, 50, 50), 'fg-unknown', false)).toEqual(rect(0, 0, 50, 50));
  });

  it('登記的比例與原圖 alpha > 40 的像素範圍一致（誤差 ≤ 1%）：素材換了、比例沒跟著改就會紅', async () => {
    for (const [asset, box] of Object.entries(FG_OPAQUE_BOX)) {
      const file = fileURLToPath(new URL(`../../src/assets/silhouettes/${asset}.png`, import.meta.url));
      const { data, info } = await sharp(readFileSync(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let x0 = info.width;
      let x1 = -1;
      let y0 = info.height;
      let y1 = -1;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          if (data[(y * info.width + x) * 4 + 3]! <= 40) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      expect(Math.abs(box.x0 - x0 / info.width), `${asset} x0`).toBeLessThanOrEqual(0.01);
      expect(Math.abs(box.x1 - (x1 + 1) / info.width), `${asset} x1`).toBeLessThanOrEqual(0.01);
      expect(Math.abs(box.y0 - y0 / info.height), `${asset} y0`).toBeLessThanOrEqual(0.01);
      expect(Math.abs(box.y1 - (y1 + 1) / info.height), `${asset} y1`).toBeLessThanOrEqual(0.01);
    }
  });
});

describe('overlapsAny（前景外框與任一文字矩形相交，含邊距）', () => {
  const fg = rect(100, 100, 100, 100);

  it('沒有文字、或文字離得夠遠：不相交', () => {
    expect(overlapsAny(fg, [], 6)).toBe(false);
    expect(overlapsAny(fg, [rect(400, 400, 50, 20)], 6)).toBe(false);
  });

  it('文字壓到前景（哪怕只擦到一角）：相交', () => {
    expect(overlapsAny(fg, [rect(190, 190, 50, 20)], 0)).toBe(true);
  });

  it('邊距：文字在前景外 4 px，邊距 6 算相交、邊距 0 不算', () => {
    const near = rect(204, 120, 50, 20);
    expect(overlapsAny(fg, [near], 6)).toBe(true);
    expect(overlapsAny(fg, [near], 0)).toBe(false);
  });

  it('剛好相切不算相交（面積為 0）', () => {
    expect(overlapsAny(fg, [rect(200, 120, 50, 20)], 0)).toBe(false);
  });

  it('多個文字矩形：只要有一個相交就是', () => {
    expect(overlapsAny(fg, [rect(500, 500, 10, 10), rect(150, 150, 5, 5)], 0)).toBe(true);
  });
});

describe('trackScroll（捲動速度與方向：淡出要提前多少，看速度）', () => {
  it('第一格、或隔了很久才又有一格（停下來之後再捲）：速度 0、方向 0', () => {
    expect(trackScroll(undefined, 100, 1000)).toEqual({ y: 100, t: 1000, speed: 0, dir: 0 });
    expect(trackScroll({ y: 100, t: 1000, speed: 900, dir: 1 }, 5000, 2000)).toEqual({ y: 5000, t: 2000, speed: 0, dir: 0 });
  });

  it('固定速度往下捲：速度＝位移 ÷ 時間（px/s），方向 +1；往上捲方向 −1', () => {
    let state = trackScroll(undefined, 0, 0);
    for (let i = 1; i <= 10; i++) state = trackScroll(state, i * 20, i * (1000 / 60) * 1);
    expect(state.speed).toBeGreaterThan(1100);
    expect(state.speed).toBeLessThan(1300); // 20 px / 16.7 ms ≈ 1200 px/s
    expect(state.dir).toBe(1);
    let up = trackScroll(undefined, 1000, 0);
    up = trackScroll(up, 980, 16.7);
    expect(up.dir).toBe(-1);
    expect(up.speed).toBeGreaterThan(1000);
  });

  it('減速：速度不會一格就掉到 0（衰減 0.8 倍，淡出才來得及），位移為 0 時方向沿用', () => {
    const fast = { y: 1000, t: 100, speed: 2000, dir: 1 as const };
    const slower = trackScroll(fast, 1010, 116.7);
    expect(slower.speed).toBeGreaterThanOrEqual(2000 * 0.8 - 1);
    expect(slower.dir).toBe(1);
    const still = trackScroll(slower, 1010, 133.4);
    expect(still.dir).toBe(1);
    expect(still.speed).toBeCloseTo(slower.speed * 0.8, 0);
  });

  it('速度有上限（程式叫頁面一口氣跳很遠時，不要讓整個前景整段消失太久）', () => {
    const jumped = trackScroll({ y: 0, t: 0, speed: 0, dir: 0 }, 20000, 16);
    expect(jumped.speed).toBeLessThanOrEqual(6000);
  });
});

describe('inflateBox（基本邊距）', () => {
  it('四邊各加 margin', () => {
    expect(inflateBox({ left: 100, top: 100, right: 200, bottom: 200 }, 6)).toEqual({ left: 94, top: 94, right: 206, bottom: 206 });
  });
});

describe('leadBox（提前量：前景外框只往文字來的那一側加大，提前淡出）', () => {
  const box = { left: 100, top: 100, right: 200, bottom: 200 };

  it('速度 0：不加', () => {
    expect(leadBox(box, 0, 0, 0.016)).toEqual(box);
  });

  it('往下捲（內容往上跑，文字從下方來）：只有下緣多出 速度 × (淡出時間＋一格)；左右與上緣不變', () => {
    const lead = 1200 * (FG_FADE_OUT_S + 0.016);
    const out = leadBox(box, 1200, 1, 0.016);
    expect(out.bottom).toBeCloseTo(200 + lead, 5);
    expect([out.top, out.left, out.right]).toEqual([100, 100, 200]);
  });

  it('往上捲：只有上緣多出', () => {
    const out = leadBox(box, 1200, -1, 0.016);
    expect(out.top).toBeLessThan(100 - 100);
    expect([out.bottom, out.left, out.right]).toEqual([200, 100, 200]);
  });

  it('方向不明但有速度：上下都加', () => {
    const out = leadBox(box, 1000, 0, 0.016);
    expect(out.top).toBeLessThan(100);
    expect(out.bottom).toBeGreaterThan(200);
  });

  it('提前量隨速度增加；一格的時間有上限（卡頓時不要加到整個畫面）', () => {
    expect(leadBox(box, 2500, 1, 0.016).bottom).toBeGreaterThan(leadBox(box, 500, 1, 0.016).bottom);
    expect(leadBox(box, 1000, 1, 5).bottom).toBeCloseTo(200 + 1000 * (FG_FADE_OUT_S + 0.1), 5);
  });

  it('桌機 2500 px/s、一格 16 ms：提前量約 290 px（文字在淡出的 0.1 s 裡會走 250 px，再加一格 40 px）', () => {
    const out = leadBox(box, 2500, 1, 0.016);
    expect(out.bottom - 200).toBeGreaterThan(280);
    expect(out.bottom - 200).toBeLessThan(300);
  });

  it('淡出約 0.1 秒（要與 depth.css 的 data-fg-hide 轉場一致）', () => {
    expect(FG_FADE_OUT_S).toBeCloseTo(0.1, 5);
  });
});

describe('clipBox（文字矩形夾進看得見的區域：被頁首蓋住或在外框之外的不算）', () => {
  const area = { left: 14, top: 70, right: 1426, bottom: 845 };

  it('完全在區域內：原樣', () => {
    const text = { left: 100, top: 300, right: 200, bottom: 320 };
    expect(clipBox(text, area)).toEqual(text);
  });

  it('跨在頁首底下：只留看得見的那一段', () => {
    expect(clipBox({ left: 100, top: 60, right: 200, bottom: 80 }, area)).toEqual({ left: 100, top: 70, right: 200, bottom: 80 });
  });

  it('完全在頁首底下、或在外框下緣之外：沒有看得見的部分（回傳 undefined）', () => {
    expect(clipBox({ left: 100, top: 20, right: 200, bottom: 40 }, area)).toBeUndefined();
    expect(clipBox({ left: 100, top: 850, right: 200, bottom: 870 }, area)).toBeUndefined();
  });
});
