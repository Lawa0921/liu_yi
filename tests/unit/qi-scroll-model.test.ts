import { describe, expect, it } from 'vitest';
import { BEATS, poseFor, type BeatId } from '../../src/qi/config/poses';
import { BAND, scrollState, type BeatRect } from '../../src/qi/engine/scroll-model';

/** 三個等高 beat：top 0／1000／2000，高 1000。 */
const THREE: BeatRect[] = [
  { id: 'opening', top: 0, height: 1000 },
  { id: 'fist', top: 1000, height: 1000 },
  { id: 'combat-a', top: 2000, height: 1000 },
];
const VH = 1000;
/** 焦點 = scrollY + viewportH/2；帶半寬 = BAND·viewportH/2 = 225。 */
const at = (scrollY: number, beats: readonly BeatRect[] = THREE, vh = VH) => scrollState(beats, scrollY, vh);

describe('BAND', () => {
  it('轉場帶佔 0.45 個視窗高（聚合停留 ≥ 0.55）', () => {
    expect(BAND).toBe(0.45);
  });
});

describe('scrollState：三個等高 beat（D17）', () => {
  it('scrollY=0（焦點 500，在第一個 beat 中央）：聚合、已定', () => {
    expect(at(0)).toEqual({ index: 0, from: 0, to: 0, mix: 0, scatter: 0, settled: true });
  });

  it('scrollY=500（焦點 1000，正好在邊界）：mix 0.5、散開最大、目標已切到下一個', () => {
    const s = at(500);
    expect(s.mix).toBeCloseTo(0.5, 10);
    expect(s.scatter).toBeCloseTo(1, 10);
    expect(s.index).toBe(1);
    expect(s.from).toBe(0);
    expect(s.to).toBe(1);
    expect(s.settled).toBe(false);
  });

  it('scrollY=300（焦點 800，進帶 5.56%）：from 0 → to 1、scatter ≈ sin(π·0.0556) ≈ 0.174、目標還沒切', () => {
    const s = at(300);
    expect(s.from).toBe(0);
    expect(s.to).toBe(1);
    expect(s.index).toBe(0);
    expect(s.mix).toBeCloseTo(25 / 450, 6);
    expect(s.scatter).toBeCloseTo(Math.sin(Math.PI * (25 / 450)), 6);
    expect(s.scatter).toBeCloseTo(0.174, 3);
    expect(s.settled).toBe(false);
  });

  it('scrollY=270（焦點 770，在帶外 5 px）：已定、不散', () => {
    const s = at(270);
    expect(s.settled).toBe(true);
    expect(s.scatter).toBe(0);
    expect(s.index).toBe(0);
    expect(s.from).toBe(0);
    expect(s.to).toBe(0);
  });

  it('帶是對稱的：離邊界越過後同距離，scatter 對稱、index 換到下一個', () => {
    const before = at(500 - 100); // 焦點 900
    const after = at(500 + 100); // 焦點 1100
    expect(after.scatter).toBeCloseTo(before.scatter, 10);
    expect(after.mix).toBeCloseTo(1 - before.mix, 10);
    expect(before.index).toBe(0);
    expect(after.index).toBe(1);
  });

  it('帶的兩端：離邊界恰 225 為 scatter 0，且視為已定', () => {
    expect(at(275).settled).toBe(true); // 焦點 775，帶的下緣
    expect(at(275).scatter).toBe(0);
    expect(at(725).settled).toBe(true); // 焦點 1225，帶的上緣
    expect(at(725).index).toBe(1);
    expect(at(274).settled).toBe(true);
    expect(at(276).settled).toBe(false);
  });

  it('beat 中央停留：焦點在 beat 中央時 index 正確、已定', () => {
    expect(at(1000)).toMatchObject({ index: 1, from: 1, to: 1, scatter: 0, settled: true }); // 焦點 1500
    expect(at(2000)).toMatchObject({ index: 2, from: 2, to: 2, scatter: 0, settled: true }); // 焦點 2500
  });

  it('第二道邊界（2000）同樣有帶：from 1 → to 2', () => {
    const s = at(1500); // 焦點 2000
    expect(s.from).toBe(1);
    expect(s.to).toBe(2);
    expect(s.index).toBe(2);
    expect(s.scatter).toBeCloseTo(1, 10);
  });

  it('捲過頭或上拉過頭（橡皮筋）：停在最後或最前一個 beat，已定', () => {
    expect(at(2500)).toMatchObject({ index: 2, from: 2, to: 2, scatter: 0, settled: true });
    expect(at(-200)).toMatchObject({ index: 0, from: 0, to: 0, scatter: 0, settled: true });
    expect(at(1e9).index).toBe(2);
    expect(at(-1e9).index).toBe(0);
  });

  it('scatter 一律在 [0, 1]，掃整段捲動沒有 NaN', () => {
    for (let y = -500; y <= 3500; y += 7) {
      const s = at(y);
      expect(Number.isFinite(s.scatter) && Number.isFinite(s.mix), `y=${y}`).toBe(true);
      expect(s.scatter).toBeGreaterThanOrEqual(0);
      expect(s.scatter).toBeLessThanOrEqual(1);
      expect(s.mix).toBeGreaterThanOrEqual(0);
      expect(s.mix).toBeLessThanOrEqual(1);
    }
  });

  it('index 隨捲動只增不減（沒有來回跳）', () => {
    let prev = 0;
    for (let y = -300; y <= 2800; y += 3) {
      const { index } = at(y);
      expect(index, `y=${y}`).toBeGreaterThanOrEqual(prev);
      prev = index;
    }
    expect(prev).toBe(2);
  });
});

describe('scrollState：視窗高度', () => {
  it('帶寬度跟著視窗高走（viewportH 600 → 半寬 135）', () => {
    // 焦點 = scrollY + 300；邊界 1000 → scrollY 700 正好在邊界
    const s = at(700, THREE, 600);
    expect(s.mix).toBeCloseTo(0.5, 10);
    expect(at(700 - 134, THREE, 600).settled).toBe(false); // 焦點 866，離邊界 134 < 135
    expect(at(700 - 136, THREE, 600).settled).toBe(true);
  });

  it('viewportH ≤ 0 或非有限值不崩潰：回已定、不散', () => {
    for (const vh of [0, -10, Number.NaN]) {
      const s = scrollState(THREE, 500, vh);
      expect(s.settled, `vh=${vh}`).toBe(true);
      expect(s.scatter).toBe(0);
      expect(Number.isFinite(s.index)).toBe(true);
    }
  });

  it('scrollY 非有限值視為 0', () => {
    expect(at(Number.NaN)).toEqual(at(0));
  });
});

describe('scrollState：高度不等（1000／1500／1000）', () => {
  const UNEVEN: BeatRect[] = [
    { id: 'opening', top: 0, height: 1000 },
    { id: 'fist', top: 1000, height: 1500 },
    { id: 'combat-a', top: 2500, height: 1000 },
  ];

  it('轉場帶位置跟著邊界走（邊界在 1000 與 2500）', () => {
    // 焦點 = scrollY + 500
    expect(at(500, UNEVEN)).toMatchObject({ from: 0, to: 1, index: 1, settled: false }); // 焦點 1000
    expect(at(2000, UNEVEN)).toMatchObject({ from: 1, to: 2, index: 2, settled: false }); // 焦點 2500
    expect(at(2000, UNEVEN).scatter).toBeCloseTo(1, 10);
  });

  it('第二個 beat 比較高：中間停留得更久（焦點 1500–2200 都已定在 index 1）', () => {
    for (const y of [1000, 1300, 1700]) {
      expect(at(y, UNEVEN), `y=${y}`).toMatchObject({ index: 1, settled: true, scatter: 0 });
    }
    // 若誤用等高（邊界 2000），scrollY 1500（焦點 2000）會落在帶中央；這裡不該散開
    expect(at(1500, UNEVEN).settled).toBe(true);
  });

  it('beat 之間有間距（margin）時，邊界取兩者的中點', () => {
    const GAPPED: BeatRect[] = [
      { id: 'opening', top: 0, height: 900 },
      { id: 'fist', top: 1100, height: 900 },
    ];
    // 邊界 = (900 + 1100) / 2 = 1000
    const s = scrollState(GAPPED, 500, 1000); // 焦點 1000
    expect(s.mix).toBeCloseTo(0.5, 10);
    expect(s.index).toBe(1);
  });

  it('比轉場帶還短的 beat（高 200）：不崩潰、index 單調、scatter 合法', () => {
    const TINY: BeatRect[] = [
      { id: 'opening', top: 0, height: 1000 },
      { id: 'fist', top: 1000, height: 200 },
      { id: 'combat-a', top: 1200, height: 1000 },
    ];
    let prev = 0;
    for (let y = -200; y <= 2000; y += 5) {
      const s = scrollState(TINY, y, 1000);
      expect(Number.isFinite(s.scatter), `y=${y}`).toBe(true);
      expect(s.scatter).toBeGreaterThanOrEqual(0);
      expect(s.scatter).toBeLessThanOrEqual(1);
      expect(s.index, `y=${y}`).toBeGreaterThanOrEqual(prev);
      prev = s.index;
    }
    expect(prev).toBe(2);
  });
});

describe('scrollState：內容缺口（RF4）', () => {
  it('沒有任何 beat：回安全預設，不崩潰', () => {
    expect(scrollState([], 0, 1000)).toEqual({ index: 0, from: 0, to: 0, mix: 0, scatter: 0, settled: true });
    expect(scrollState([], 5000, 1000)).toMatchObject({ index: 0, settled: true, scatter: 0 });
    expect(scrollState([], -300, 0)).toMatchObject({ index: 0, settled: true, scatter: 0 });
  });

  it('只有一個 beat：永遠已定', () => {
    const one: BeatRect[] = [{ id: 'opening', top: 0, height: 1000 }];
    for (const y of [-100, 0, 400, 500, 900, 5000]) {
      expect(scrollState(one, y, 1000), `y=${y}`).toMatchObject({ index: 0, from: 0, to: 0, scatter: 0, settled: true });
    }
  });

  it('高度 0 的 beat 被略過：索引仍指向（原陣列中）有高度的 beat', () => {
    const withHole: BeatRect[] = [
      { id: 'opening', top: 0, height: 1000 },
      { id: 'weapon-a', top: 1000, height: 0 }, // 例如整段在 hidden 的對象面板內
      { id: 'weapon-b', top: 1000, height: 1000 },
    ];
    const settledOnLast = scrollState(withHole, 1000, 1000); // 焦點 1500
    expect(settledOnLast).toMatchObject({ index: 2, settled: true });
    expect(withHole[settledOnLast.index]!.id).toBe('weapon-b');

    const mid = scrollState(withHole, 500, 1000); // 焦點 1000：邊界在 opening 與 weapon-b 之間
    expect(mid.from).toBe(0);
    expect(mid.to).toBe(2);
    expect(mid.scatter).toBeCloseTo(1, 10);
    expect(withHole[mid.index]!.id).toBe('weapon-b');
    expect(withHole[mid.from]!.id).toBe('opening');
  });

  it('負高度與 NaN 高度也視為缺席', () => {
    const odd: BeatRect[] = [
      { id: 'opening', top: 0, height: 1000 },
      { id: 'fist', top: 1000, height: -5 },
      { id: 'combat-a', top: 1000, height: Number.NaN },
      { id: 'combat-b', top: 1000, height: 1000 },
    ];
    const s = scrollState(odd, 1000, 1000);
    expect(s.index).toBe(3);
    expect(s.settled).toBe(true);
    expect(scrollState(odd, 500, 1000)).toMatchObject({ from: 0, to: 3 });
  });

  it('開頭的 beat 高度為 0：index 不指向它', () => {
    const lead: BeatRect[] = [
      { id: 'opening', top: 0, height: 0 },
      { id: 'fist', top: 0, height: 1000 },
      { id: 'combat-a', top: 1000, height: 1000 },
    ];
    expect(scrollState(lead, 0, 1000)).toMatchObject({ index: 1, from: 1, to: 1, settled: true });
    expect(scrollState(lead, 2000, 1000).index).toBe(2);
  });

  it('全部高度都是 0：回安全預設，不崩潰', () => {
    const none: BeatRect[] = BEATS.map((id) => ({ id, top: 0, height: 0 }));
    expect(scrollState(none, 300, 1000)).toEqual({ index: 0, from: 0, to: 0, mix: 0, scatter: 0, settled: true });
  });

  it('不留空殼：某對象缺幾個分類時，每個捲動位置都落在有高度的 beat、且查得到姿勢', () => {
    // 大人：沒有「其他課程」、「師資」；其餘都在。小孩面板的 beat 在大人模式高度為 0 但仍在 DOM。
    const missing: BeatId[] = ['others', 'coaches'];
    let top = 0;
    const beats: BeatRect[] = BEATS.map((id) => {
      const height = missing.includes(id) ? 0 : 900;
      const rect = { id, top, height };
      top += height;
      return rect;
    });
    for (const audience of ['adult', 'kid'] as const) {
      for (let y = -400; y <= top + 400; y += 11) {
        const s = scrollState(beats, y, 800);
        for (const i of [s.index, s.from, s.to]) {
          const beat = beats[i];
          expect(beat, `y=${y}`).toBeDefined();
          expect(beat!.height, `y=${y} 落在空殼 ${beat!.id}`).toBeGreaterThan(0);
          expect(poseFor(beat!.id, audience), `${audience} ${beat!.id}`).toBeTruthy();
        }
      }
    }
  });
});
