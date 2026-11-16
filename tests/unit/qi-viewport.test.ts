import { describe, expect, it } from 'vitest';
import { isPortrait, viewportChanged } from '../../src/qi/engine/viewport';

/**
 * RF1：手機網址列伸縮、轉向。
 *
 * `viewportChanged(prev, next)` 回 true ＝ 這次 resize 要「重新取景」（重設 renderer／camera 尺寸與鏡頭擺位）。
 * 回 false ＝ 忽略：模擬、粒子位置與目前姿勢一律不動（引擎在任何情況下都不重建模擬，見設計 §8.3）。
 * 姿勢由捲動位置決定（`scrollState` → `poseFor`），輸入裡沒有視窗尺寸，所以重新取景本身不會改動姿勢。
 *
 * `prev` 必須是「上一次取景用的尺寸」，不是上一個 resize 事件的尺寸，否則一連串小變動會悄悄累積過門檻。
 */
describe('viewportChanged（RF1）', () => {
  it('網址列收合：390×844 → 390×760（−10%）不算', () => {
    expect(viewportChanged({ w: 390, h: 844 }, { w: 390, h: 760 })).toBe(false);
  });

  it('網址列展開（高度變大）同樣只看幅度：390×760 → 390×844（+11%）不算', () => {
    expect(viewportChanged({ w: 390, h: 760 }, { w: 390, h: 844 })).toBe(false);
  });

  it('高度差 > 18% 才算：390×844 → 390×640（−24%）重新取景', () => {
    expect(viewportChanged({ w: 390, h: 844 }, { w: 390, h: 640 })).toBe(true);
  });

  it('門檻是 18%：恰 18% 不算，多一點就算', () => {
    expect(viewportChanged({ w: 390, h: 1000 }, { w: 390, h: 820 })).toBe(false); // −18%
    expect(viewportChanged({ w: 390, h: 1000 }, { w: 390, h: 819 })).toBe(true); // −18.1%
    expect(viewportChanged({ w: 390, h: 1000 }, { w: 390, h: 1180 })).toBe(false); // +18%
    expect(viewportChanged({ w: 390, h: 1000 }, { w: 390, h: 1181 })).toBe(true);
  });

  it('寬度只要不同就算：桌機拉窗口、分割視窗', () => {
    expect(viewportChanged({ w: 1440, h: 900 }, { w: 1439, h: 900 })).toBe(true);
    expect(viewportChanged({ w: 390, h: 844 }, { w: 430, h: 844 })).toBe(true);
  });

  it('轉向（寬高對調）：390×844 → 844×390 重新取景', () => {
    expect(viewportChanged({ w: 390, h: 844 }, { w: 844, h: 390 })).toBe(true);
    expect(viewportChanged({ w: 844, h: 390 }, { w: 390, h: 844 })).toBe(true);
  });

  it('完全相同：不算', () => {
    expect(viewportChanged({ w: 390, h: 844 }, { w: 390, h: 844 })).toBe(false);
    expect(viewportChanged({ w: 1440, h: 900 }, { w: 1440, h: 900 })).toBe(false);
  });

  it('一連串網址列抖動：每次都和「上次取景的尺寸」比，全程不重新取景', () => {
    const fitted = { w: 390, h: 844 };
    // 捲動時 innerHeight 在 844 與 ~740（−12%）之間連續變化，沒有任何一次超過門檻
    for (const h of [830, 800, 770, 745, 740, 760, 800, 844, 810, 750]) {
      expect(viewportChanged(fitted, { w: 390, h }), `h=${h}`).toBe(false);
    }
  });

  it('逐步比較的陷阱：若拿「上一個事件」當 prev，連續小變動會累積過門檻；對照取景尺寸則不會', () => {
    const steps = [844, 780, 720, 665, 615]; // 每步 ≈ −7 ~ −8%，總共 −27%
    let prevEvent = { w: 390, h: steps[0]! };
    let anyStepTriggered = false;
    for (const h of steps.slice(1)) {
      if (viewportChanged(prevEvent, { w: 390, h })) anyStepTriggered = true;
      prevEvent = { w: 390, h };
    }
    expect(anyStepTriggered).toBe(false); // 每一步都沒過門檻
    // 但相對於當初取景的尺寸，最後確實已經差很多——呼叫端若用 prevEvent 就永遠不會重新取景
    expect(viewportChanged({ w: 390, h: 844 }, { w: 390, h: 615 })).toBe(true);
  });

  it('prev 高度為 0 或非法值時不崩潰：高度有變就重新取景', () => {
    expect(viewportChanged({ w: 390, h: 0 }, { w: 390, h: 844 })).toBe(true);
    expect(viewportChanged({ w: 390, h: 0 }, { w: 390, h: 0 })).toBe(false);
    expect(viewportChanged({ w: 390, h: Number.NaN }, { w: 390, h: 844 })).toBe(true);
  });
});

/**
 * Task 22b：版面（文字在左或在下）與引擎取景要依「同一個」寬高比切換。
 * 直向的門檻是 `PORTRAIT_RATIO`（4:5＝0.8）：窄於它是直向，其餘（含近方形 1000×1000、1024×1124）是橫向。
 * CSS 以 `@media (max-aspect-ratio: 4/5)` 表達同一條規則（home.css 與 Opening.astro 的 <source media>，單元測試守住兩邊一致）。
 */
describe('isPortrait（版面與取景的同一個切換點）', () => {
  it('手機直立：390×844、360×740、375×667 都是直向', () => {
    expect(isPortrait(390, 844)).toBe(true);
    expect(isPortrait(360, 740)).toBe(true);
    expect(isPortrait(375, 667)).toBe(true);
  });

  it('直式平板：1024×1366（0.75）是直向；橫放手機與桌機是橫向', () => {
    expect(isPortrait(1024, 1366)).toBe(true);
    expect(isPortrait(844, 390)).toBe(false);
    expect(isPortrait(1440, 900)).toBe(false);
    expect(isPortrait(900, 600)).toBe(false);
  });

  it('近方形（0.8–1.0）算橫向：1000×1000、1024×1124（0.91）、900×1000（0.9）', () => {
    expect(isPortrait(1000, 1000)).toBe(false);
    expect(isPortrait(1024, 1124)).toBe(false);
    expect(isPortrait(900, 1000)).toBe(false);
  });

  it('門檻恰在 4:5：800×1000 是直向（≤），801×1000 不是', () => {
    expect(isPortrait(800, 1000)).toBe(true);
    expect(isPortrait(801, 1000)).toBe(false);
  });

  it('高度為 0 或非法值不崩潰：當成橫向', () => {
    expect(isPortrait(390, 0)).toBe(false);
    expect(isPortrait(Number.NaN, 844)).toBe(false);
  });
});

describe('viewportChanged：跨過直／橫門檻一律重新取景（即使只差高度、幅度很小）', () => {
  it('沒有跨界的小幅度變動仍不算：同在橫向（1000×1100 → 1000×1120）、同在直向（1000×1300 → 1000×1320）', () => {
    expect(viewportChanged({ w: 1000, h: 1100 }, { w: 1000, h: 1120 })).toBe(false);
    expect(viewportChanged({ w: 1000, h: 1300 }, { w: 1000, h: 1320 })).toBe(false);
  });

  it('1000×1249（橫向）→ 1000×1251（直向）：高度只差 0.16% 也要重新取景', () => {
    expect(isPortrait(1000, 1249)).toBe(false);
    expect(isPortrait(1000, 1251)).toBe(true);
    expect(viewportChanged({ w: 1000, h: 1249 }, { w: 1000, h: 1251 })).toBe(true);
  });
});
