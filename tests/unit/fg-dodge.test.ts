import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { FG_OPAQUE_BOX, opaqueBox, overlapsAny } from '../../src/lib/scene/fg-dodge';

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
