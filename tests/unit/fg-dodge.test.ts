import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { clipBox, dodgeDecision, FG_FADE_OUT_S, FG_LEAD_SLACK_S, FG_OPAQUE_BOX, FG_SETTLE_MS, inflateBox, leadBox, opaqueBox, overlapsAny, settleTrack, trackScroll } from '../../src/lib/scene/fg-dodge';

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

  it('往下捲（內容往上跑，文字從下方來）：只有下緣多出 速度 × (淡出時間＋餘裕＋一格)；左右與上緣不變', () => {
    const lead = 1200 * (FG_FADE_OUT_S + FG_LEAD_SLACK_S + 0.016);
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
    expect(leadBox(box, 1000, 1, 5).bottom).toBeCloseTo(200 + 1000 * (FG_FADE_OUT_S + FG_LEAD_SLACK_S + 0.1), 5);
  });

  it('桌機 2500 px/s、一格 16 ms：提前量約 415 px（文字在淡出的 0.1 s 裡會走 250 px，餘裕 0.05 s 125 px，再加一格 40 px）', () => {
    const out = leadBox(box, 2500, 1, 0.016);
    expect(out.bottom - 200).toBeGreaterThan(400);
    expect(out.bottom - 200).toBeLessThan(430);
  });

  it('餘裕約 1–4 格（負載高時轉場晚一兩格才開始；完整 e2e 下桌機窗櫺曾在文字進來時還剩一點不透明，蓋住 5–6%）', () => {
    expect(FG_LEAD_SLACK_S).toBeGreaterThanOrEqual(0.016);
    expect(FG_LEAD_SLACK_S).toBeLessThanOrEqual(0.067);
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

describe('settleTrack／FG_SETTLE_MS（停下之後的尾端重算：速度歸零）', () => {
  it('停下：位置留著、速度與方向歸零（最後一格的速度不能一直留著讓前景躲著）', () => {
    expect(settleTrack({ y: 4000, t: 900, speed: 2400, dir: 1 }, 4000, 1300)).toEqual({ y: 4000, t: 1300, speed: 0, dir: 0 });
  });

  it('其實還在動（頁面卡住一陣子、計時器先跑了，位置卻已經變了）：不歸零，照一般的速度追蹤', () => {
    const moving = { y: 4000, t: 1000, speed: 2400, dir: 1 as const };
    expect(settleTrack(moving, 4040, 1016)).toEqual(trackScroll(moving, 4040, 1016));
    expect(settleTrack(moving, 4040, 1016).speed).toBeGreaterThan(0);
  });

  it('尾端重算等的時間：不短於「視為停下」的 300 ms（滾輪刻度之間的空檔不算停），加上淡入 0.3 s 在 0.62 s 內完全回來（e2e 在 0.6 s 量 opacity ≥ 0.5）', () => {
    expect(FG_SETTLE_MS).toBeGreaterThanOrEqual(300);
    expect(FG_SETTLE_MS / 1000 + 0.3).toBeLessThanOrEqual(0.62 + 1e-9);
  });
});

describe('dodgeDecision（這一格前景要不要淡出）', () => {
  const area = { left: 0, top: 70, right: 1440, bottom: 900 };
  const eave = { left: 1100, top: 70, right: 1440, bottom: 300 };
  const base = { visible: eave, area, margin: 6, frameSeconds: 0.016 };

  it('沒有文字：不淡出', () => {
    expect(dodgeDecision({ ...base, moving: [], fixed: [], speed: 0, dir: 0 })).toEqual({ hide: false, cut: false });
  });

  it('會捲動的文字在提前量那一段裡（下方 200 px、往下捲 2500 px/s）：淡出，但還沒壓上來，不切掉', () => {
    const text = { left: 1200, top: 500, right: 1300, bottom: 520 };
    expect(dodgeDecision({ ...base, moving: [text], fixed: [], speed: 2500, dir: 1 })).toEqual({ hide: true, cut: false });
  });

  it('固定在畫面上的文字（段落導覽）在提前量那一段裡：不淡出——它不會隨捲動靠近（複審：桌機簷角被它白白藏起來）', () => {
    const rail = { left: 1200, top: 500, right: 1300, bottom: 520 };
    expect(dodgeDecision({ ...base, moving: [], fixed: [rail], speed: 2500, dir: 1 })).toEqual({ hide: false, cut: false });
  });

  it('固定的文字離前景 6 px 以內：照樣淡出；壓在上面就直接切掉', () => {
    expect(dodgeDecision({ ...base, moving: [], fixed: [{ left: 1200, top: 304, right: 1300, bottom: 320 }], speed: 0, dir: 0 })).toEqual({ hide: true, cut: false });
    expect(dodgeDecision({ ...base, moving: [], fixed: [{ left: 1200, top: 200, right: 1300, bottom: 220 }], speed: 2500, dir: 1 })).toEqual({ hide: true, cut: true });
  });

  it('看不到的文字（在景深層的矩形之外、被頁首蓋住）不算「現在」，但會捲動的仍算提前量（下一兩格就進來）', () => {
    const underHeader = { left: 1200, top: 20, right: 1300, bottom: 40 };
    expect(dodgeDecision({ ...base, moving: [underHeader], fixed: [], speed: 0, dir: 0 }).hide).toBe(false);
    expect(dodgeDecision({ ...base, moving: [], fixed: [underHeader], speed: 2500, dir: -1 }).hide).toBe(false);
    expect(dodgeDecision({ ...base, moving: [underHeader], fixed: [], speed: 2500, dir: -1 }).hide).toBe(true);
  });
});
