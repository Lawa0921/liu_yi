import { describe, expect, it } from 'vitest';
import { OPENING, OPENING_KEY, markOpeningSeen, openingFrame, openingMode } from '../../src/lib/impact/opening';
import { crackLength, generateCracks, revealCrack } from '../../src/lib/impact/cracks';
import { burstChips, spawnDustRing, stepParticles, type Particle } from '../../src/lib/impact/particles';
import { SINK_MAX, SINK_MS, shoveOffset, sinkOffset } from '../../src/lib/impact/shake';
import { CLEAVE, cleaveClips, cleaveFrame, cleavePath } from '../../src/lib/impact/cleave';
import { forgeFromSwitch, forgeThreshold } from '../../src/lib/arsenal/forge';
import { ENTER_MS, LEAVE_MS, advanceSwitch, createSwitch, requestSwitch } from '../../src/lib/arsenal/switcher';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('開場「一震開門」：每個工作階段只完整演一次', () => {
  it('第一次進站：演', () => {
    expect(openingMode({ storage: memoryStorage(), reducedMotion: false })).toBe('play');
  });

  it('這個工作階段演過了：直接終態', () => {
    const storage = memoryStorage();
    markOpeningSeen(storage);
    expect(storage.getItem(OPENING_KEY)).toBe('1');
    expect(openingMode({ storage, reducedMotion: false })).toBe('final');
  });

  it('減少動態：直接終態，不管演過沒', () => {
    expect(openingMode({ storage: memoryStorage(), reducedMotion: true })).toBe('final');
  });

  it('讀不到 sessionStorage（隱私模式丟例外或沒有）：照演，不報錯', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(openingMode({ storage: broken, reducedMotion: false })).toBe('play');
    expect(() => markOpeningSeen(broken)).not.toThrow();
    expect(openingMode({ storage: null, reducedMotion: false })).toBe('play');
  });
});

describe('開場的時間軸：蓄 → 擊 → 定格 → 餘韻', () => {
  it('落下之前什麼都還沒裂', () => {
    const frame = openingFrame(OPENING.strikeAt - 1);
    expect(frame.phase).toBe('charge');
    expect(frame.cracks).toBe(0);
    expect(frame.struck).toBe(false);
  });

  it('擊中的瞬間裂紋先炸開一段，然後定格兩三幀不動', () => {
    const hit = openingFrame(OPENING.strikeAt);
    expect(hit.phase).toBe('freeze');
    expect(hit.struck).toBe(true);
    expect(hit.cracks).toBeGreaterThan(0.2);
    const held = openingFrame(OPENING.strikeAt + OPENING.freezeMs - 1);
    expect(held.cracks).toBe(hit.cracks);
    expect(OPENING.freezeMs).toBeGreaterThanOrEqual(33);
    expect(OPENING.freezeMs).toBeLessThanOrEqual(90);
  });

  it('定格之後裂紋一路裂到底，最後收成終態', () => {
    const after = openingFrame(OPENING.strikeAt + OPENING.freezeMs + 60);
    expect(after.phase).toBe('release');
    expect(after.cracks).toBeGreaterThan(openingFrame(OPENING.strikeAt).cracks);
    const done = openingFrame(OPENING.totalMs);
    expect(done.phase).toBe('done');
    expect(done.cracks).toBe(1);
    expect(openingFrame(OPENING.totalMs * 50)).toEqual(done);
  });

  it('整段不拖：兩秒內演完', () => {
    expect(OPENING.totalMs).toBeLessThanOrEqual(2000);
  });

  it('時間是負的或 NaN 時當成還沒開始', () => {
    expect(openingFrame(-5).phase).toBe('charge');
    expect(openingFrame(Number.NaN).phase).toBe('charge');
  });
});

describe('裂紋：以落點為圓心向八方裂開', () => {
  const cracks = generateCracks({ seed: 7, radius: 400 });
  const mains = cracks.filter((crack) => crack.main);

  it('八條主裂線，各朝一個方位（每 45° 一條）', () => {
    expect(mains).toHaveLength(8);
    mains.forEach((crack, index) => {
      const end = crack.points.at(-1)!;
      const angle = (Math.atan2(end.y, end.x) + Math.PI * 2) % (Math.PI * 2);
      const expected = (index * Math.PI) / 4;
      const diff = Math.min(Math.abs(angle - expected), Math.PI * 2 - Math.abs(angle - expected));
      expect(diff).toBeLessThan(0.2);
    });
  });

  it('主裂線從圓心出發，一路往外、裂到接近半徑', () => {
    for (const crack of mains) {
      expect(crack.points[0]).toEqual({ x: 0, y: 0 });
      let last = -1;
      for (const point of crack.points) {
        const distance = Math.hypot(point.x, point.y);
        expect(distance).toBeGreaterThan(last);
        last = distance;
      }
      expect(last).toBeGreaterThan(400 * 0.8);
      expect(last).toBeLessThanOrEqual(400 * 1.05);
    }
  });

  it('是尺規刻出來的折線（幾段直線），不是曲線', () => {
    for (const crack of mains) {
      expect(crack.points.length).toBeGreaterThanOrEqual(4);
      expect(crack.points.length).toBeLessThanOrEqual(9);
    }
  });

  it('有幾條短的支裂，從主裂線上岔出去，比主裂線短', () => {
    const branches = cracks.filter((crack) => !crack.main);
    expect(branches.length).toBeGreaterThanOrEqual(4);
    for (const branch of branches) {
      expect(crackLength(branch)).toBeLessThan(400 * 0.5);
      const start = branch.points[0]!;
      expect(Math.hypot(start.x, start.y)).toBeGreaterThan(10);
    }
  });

  it('同一個種子每次都一樣，不同種子不一樣', () => {
    expect(generateCracks({ seed: 7, radius: 400 })).toEqual(cracks);
    expect(generateCracks({ seed: 8, radius: 400 })).not.toEqual(cracks);
  });

  it('revealCrack：依進度只露出前面那一段', () => {
    const crack = mains[0]!;
    expect(revealCrack(crack, 0)).toEqual([]);
    expect(revealCrack(crack, 1)).toEqual(crack.points);
    const half = revealCrack(crack, 0.5);
    const partial = { main: true, points: half };
    expect(crackLength(partial)).toBeCloseTo(crackLength(crack) / 2, 3);
    expect(revealCrack(crack, 9)).toEqual(crack.points);
  });
});

describe('顆粒：塵浪與漆片', () => {
  it('塵浪：一圈顆粒從落點往外推', () => {
    const ring = spawnDustRing({ count: 60, seed: 3, speed: 0.5 });
    expect(ring).toHaveLength(60);
    for (const particle of ring) {
      // 速度方向和位置方向一致（往外）。
      expect(particle.vx * particle.x + particle.vy * particle.y).toBeGreaterThanOrEqual(0);
      expect(particle.size).toBeGreaterThan(0);
      expect(particle.size).toBeLessThanOrEqual(3.5);
    }
  });

  it('漆片：朝撞擊的方向噴出去，會翻轉', () => {
    const chips = burstChips({ count: 30, seed: 5, direction: 0, speed: 0.6 });
    expect(chips).toHaveLength(30);
    expect(chips.filter((chip) => chip.vx > 0).length).toBeGreaterThan(24);
    expect(chips.some((chip) => chip.spin !== 0)).toBe(true);
  });

  it('步進：位置前進、壽命減少、有阻力所以越來越慢，死了就移除', () => {
    const start: Particle[] = [{ x: 0, y: 0, vx: 1, vy: 0, life: 300, maxLife: 300, size: 2, spin: 0, angle: 0, tone: 0 }];
    const once = stepParticles(start, 100, { drag: 0.004, gravity: 0 });
    expect(once[0]!.x).toBeGreaterThan(0);
    expect(once[0]!.life).toBe(200);
    expect(Math.abs(once[0]!.vx)).toBeLessThan(1);
    expect(stepParticles(once, 250, { drag: 0.004, gravity: 0 })).toEqual([]);
  });

  it('重力讓顆粒往下掉；一格很久也不會出現 NaN', () => {
    const start: Particle[] = [{ x: 0, y: 0, vx: 0, vy: 0, life: 9e6, maxLife: 9e6, size: 2, spin: 0.01, angle: 0, tone: 0 }];
    const after = stepParticles(start, 100, { drag: 0.001, gravity: 0.001 });
    expect(after[0]!.y).toBeGreaterThan(0);
    const far = stepParticles(start, 1e6, { drag: 0.001, gravity: 0.001 });
    expect(Number.isFinite(far[0]!.x) && Number.isFinite(far[0]!.y)).toBe(true);
  });
});

describe('視窗下沉與橫撞', () => {
  it('震腳：一開始和結束都在原位，中途先往下沉再回彈，幅度不超過 10px', () => {
    expect(sinkOffset(0)).toBe(0);
    expect(sinkOffset(SINK_MS)).toBe(0);
    expect(sinkOffset(SINK_MS * 3)).toBe(0);
    let deepest = 0;
    let highest = 0;
    for (let t = 0; t <= SINK_MS; t += 4) {
      deepest = Math.max(deepest, sinkOffset(t));
      highest = Math.min(highest, sinkOffset(t));
    }
    expect(deepest).toBeGreaterThanOrEqual(6);
    expect(deepest).toBeLessThanOrEqual(SINK_MAX);
    expect(SINK_MAX).toBeLessThanOrEqual(10);
    // 回彈：會稍微彈過頭往上。
    expect(highest).toBeLessThan(0);
    expect(highest).toBeGreaterThan(-deepest);
  });

  it('幅度可以縮小（手機），但怎麼給都不會超過上限', () => {
    expect(Math.abs(sinkOffset(60, 4))).toBeLessThanOrEqual(4);
    expect(Math.abs(sinkOffset(60, 500))).toBeLessThanOrEqual(SINK_MAX);
  });

  it('貼山靠：版面被橫向撞開再彈回原位', () => {
    expect(shoveOffset(0)).toBe(0);
    expect(shoveOffset(5000)).toBe(0);
    let far = 0;
    for (let t = 0; t <= 600; t += 4) far = Math.max(far, Math.abs(shoveOffset(t)));
    expect(far).toBeGreaterThan(14);
    expect(far).toBeLessThanOrEqual(40);
  });
});

describe('破幅轉場：落幅 → 劈 → 定格 → 滑開', () => {
  it('依序走完四段，然後收掉', () => {
    expect(cleaveFrame(0).phase).toBe('drop');
    expect(cleaveFrame(CLEAVE.dropMs + 1).phase).toBe('slash');
    expect(cleaveFrame(CLEAVE.dropMs + CLEAVE.slashMs + 1).phase).toBe('freeze');
    expect(cleaveFrame(CLEAVE.dropMs + CLEAVE.slashMs + CLEAVE.freezeMs + 1).phase).toBe('part');
    expect(cleaveFrame(CLEAVE.totalMs).phase).toBe('idle');
    expect(cleaveFrame(-1).phase).toBe('idle');
  });

  it('劈中後定格兩三幀（33–60ms）', () => {
    expect(CLEAVE.freezeMs).toBeGreaterThanOrEqual(33);
    expect(CLEAVE.freezeMs).toBeLessThanOrEqual(60);
  });

  it('刀路：由右上到左下的一道長弧', () => {
    const path = cleavePath(1000, 600);
    expect(path.length).toBeGreaterThanOrEqual(12);
    const first = path[0]!;
    const last = path.at(-1)!;
    expect(first.x).toBeGreaterThan(900);
    expect(first.y).toBeLessThan(120);
    expect(last.x).toBeLessThan(100);
    expect(last.y).toBeGreaterThan(480);
    // 是弧不是直線：中點偏離兩端的連線。
    const middle = path[Math.floor(path.length / 2)]!;
    const onLine = first.y + ((last.y - first.y) * (middle.x - first.x)) / (last.x - first.x);
    expect(Math.abs(middle.y - onLine)).toBeGreaterThan(20);
  });

  it('沿刀路把畫面分成兩半：一半含左上角，一半含右下角，兩半共用刀路', () => {
    const { upper, lower } = cleaveClips(1000, 600);
    const has = (polygon: { x: number; y: number }[], x: number, y: number) => polygon.some((p) => p.x === x && p.y === y);
    expect(has(upper, 0, 0)).toBe(true);
    expect(has(lower, 1000, 600)).toBe(true);
    expect(has(upper, 1000, 600)).toBe(false);
    expect(has(lower, 0, 0)).toBe(false);
    const path = cleavePath(1000, 600);
    for (const point of path) {
      expect(upper).toContainEqual(point);
      expect(lower).toContainEqual(point);
    }
  });
});

describe('淬火成形：切換狀態 → 溶解進度', () => {
  it('閒置：完全成形', () => {
    expect(forgeFromSwitch(createSwitch('jian'))).toMatchObject({ progress: 1, active: false });
  });

  it('舊兵器燃盡：進度由 1 降到 0，沿噪聲邊界（長軸的權重低）', () => {
    let state = requestSwitch(createSwitch('jian'), 'spear');
    const start = forgeFromSwitch(state);
    state = advanceSwitch(state, LEAVE_MS / 2);
    const mid = forgeFromSwitch(state);
    expect(start.progress).toBe(1);
    expect(mid.progress).toBeLessThan(1);
    expect(mid.progress).toBeGreaterThan(0);
    expect(mid.active).toBe(true);
    expect(mid.axisWeight).toBeLessThan(0.5);
  });

  it('新兵器從尖端往柄燒出：進度由 0 升到 1，沿長軸（權重高）', () => {
    let state = advanceSwitch(requestSwitch(createSwitch('jian'), 'spear'), LEAVE_MS);
    expect(forgeFromSwitch(state).progress).toBe(0);
    state = advanceSwitch(state, ENTER_MS / 2);
    const mid = forgeFromSwitch(state);
    expect(mid.progress).toBeGreaterThan(0);
    expect(mid.progress).toBeLessThan(1);
    expect(mid.axisWeight).toBeGreaterThan(0.6);
    expect(forgeFromSwitch(advanceSwitch(state, ENTER_MS)).progress).toBe(1);
  });

  it('門檻：進度 0 時什麼都不顯示，進度 1 時全部顯示；尖端比柄先出現', () => {
    for (const axis of [0, 0.5, 1]) {
      for (const noise of [0, 0.5, 1]) {
        for (const weight of [0.25, 0.85]) {
          const threshold = forgeThreshold(axis, noise, weight);
          expect(threshold).toBeGreaterThan(0);
          expect(threshold).toBeLessThan(1);
        }
      }
    }
    expect(forgeThreshold(0, 0.5, 0.85)).toBeLessThan(forgeThreshold(1, 0.5, 0.85));
  });
});
