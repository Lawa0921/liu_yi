import { describe, expect, it } from 'vitest';
import { createGovernor, initialTier, TIER_ORDER, TIERS, type TierId } from '../../src/qi/engine/tiers';

describe('TIERS（D16）', () => {
  it('四級：256² / 192² / 144² / 112²，count 就是 side²', () => {
    expect(TIERS.high.side).toBe(256);
    expect(TIERS.mid.side).toBe(192);
    expect(TIERS.low.side).toBe(144);
    expect(TIERS.min.side).toBe(112);
    expect(TIERS.high.count).toBe(65536);
    expect(TIERS.mid.count).toBe(36864);
    expect(TIERS.low.count).toBe(20736);
    expect(TIERS.min.count).toBe(12544);
    for (const id of TIER_ORDER) expect(TIERS[id].count, id).toBe(TIERS[id].side ** 2);
  });

  it('光暈：high／mid 開，low／min 關（D15）', () => {
    expect(TIERS.high.glow).toBe(true);
    expect(TIERS.mid.glow).toBe(true);
    expect(TIERS.low.glow).toBe(false);
    expect(TIERS.min.glow).toBe(false);
  });

  it('TIER_ORDER 由高到低：high → mid → low → min', () => {
    expect(TIER_ORDER).toEqual(['high', 'mid', 'low', 'min']);
  });
});

describe('initialTier', () => {
  it('桌機（寬 ≥ 960 且非觸控）起於 high', () => {
    expect(initialTier({ touch: false, width: 1440 })).toBe('high');
    expect(initialTier({ touch: false, width: 960 })).toBe('high');
  });

  it('觸控裝置起於 low，即使寬度夠', () => {
    expect(initialTier({ touch: true, width: 1440 })).toBe('low');
  });

  it('窄視窗起於 low', () => {
    expect(initialTier({ touch: false, width: 800 })).toBe('low');
    expect(initialTier({ touch: false, width: 959 })).toBe('low');
    expect(initialTier({ touch: true, width: 390 })).toBe('low');
  });

  it('?qi-tier 覆寫：合法值優先於自動判斷', () => {
    expect(initialTier({ touch: false, width: 1440, override: 'mid' })).toBe('mid');
    expect(initialTier({ touch: true, width: 390, override: 'high' })).toBe('high');
    expect(initialTier({ touch: false, width: 1440, override: 'min' })).toBe('min');
  });

  it('非法覆寫值一律忽略，改走自動判斷', () => {
    expect(initialTier({ touch: false, width: 1440, override: 'bogus' })).toBe('high');
    expect(initialTier({ touch: true, width: 1440, override: 'bogus' })).toBe('low');
    expect(initialTier({ touch: false, width: 1440, override: '' })).toBe('high');
    expect(initialTier({ touch: false, width: 1440, override: null })).toBe('high');
    expect(initialTier({ touch: false, width: 1440, override: undefined })).toBe('high');
  });

  it('覆寫值要完全相符：大小寫不同或原型鏈上的名字都不算', () => {
    expect(initialTier({ touch: true, width: 390, override: 'HIGH' })).toBe('low');
    expect(initialTier({ touch: true, width: 390, override: 'constructor' })).toBe('low');
    expect(initialTier({ touch: true, width: 390, override: 'toString' })).toBe('low');
    expect(initialTier({ touch: true, width: 390, override: '__proto__' })).toBe('low');
  });
});

/** 以固定間隔餵 `frame()`，回傳每個非 null 回覆（時間 → 新 tier）。 */
function feed(gov: ReturnType<typeof createGovernor>, stepMs: number, fromMs: number, toMs: number) {
  const drops: { at: number; tier: TierId }[] = [];
  for (let t = fromMs; t <= toMs; t += stepMs) {
    const r = gov.frame(t);
    if (r !== null) drops.push({ at: t, tier: r });
  }
  return drops;
}

describe('createGovernor（D16）', () => {
  it('tier() 回目前的 tier，起始為 start', () => {
    expect(createGovernor({ start: 'high' }).tier()).toBe('high');
    expect(createGovernor({ start: 'low' }).tier()).toBe('low');
  });

  it('流暢（16.7 ms 間隔）餵 6 秒：一直回 null、tier 不變', () => {
    const gov = createGovernor({ start: 'high' });
    expect(feed(gov, 16.7, 0, 6000)).toEqual([]);
    expect(gov.tier()).toBe('high');
  });

  it('25 fps（40 ms）：暖機 2000 ms 後、第二個低 fps 視窗結束時降到 mid，不早也不晚', () => {
    const gov = createGovernor({ start: 'high' });
    // 視窗：[2000, 3000) 與 [3000, 4000)；第二個在 t = 4000 結束
    expect(feed(gov, 40, 0, 3960)).toEqual([]);
    expect(gov.frame(4000)).toBe('mid');
    expect(gov.tier()).toBe('mid');
  });

  it('暖機期間再慢也不降（前 2000 ms 不計）', () => {
    const gov = createGovernor({ start: 'high' });
    expect(feed(gov, 100, 0, 2900)).toEqual([]);
    expect(gov.tier()).toBe('high');
  });

  it('降級後 3000 ms 內不再降', () => {
    const gov = createGovernor({ start: 'high' });
    const drops = feed(gov, 40, 0, 6960);
    expect(drops).toEqual([{ at: 4000, tier: 'mid' }]);
    // 冷卻到 7000；之後才開始新的視窗，再兩個視窗（8000、9000）才降
    expect(feed(gov, 40, 7000, 8960)).toEqual([]);
    expect(gov.frame(9000)).toBe('low');
  });

  it('持續低 fps：依序降到 min 後永遠回 null', () => {
    const gov = createGovernor({ start: 'high' });
    const drops = feed(gov, 40, 0, 60_000);
    expect(drops.map((d) => d.tier)).toEqual(['mid', 'low', 'min']);
    expect(gov.tier()).toBe('min');
    expect(feed(gov, 40, 60_040, 120_000)).toEqual([]);
  });

  it('從 low 開始只能再降到 min', () => {
    const gov = createGovernor({ start: 'low' });
    const drops = feed(gov, 40, 0, 60_000);
    expect(drops.map((d) => d.tier)).toEqual(['min']);
  });

  it('start 就是 min：永遠回 null', () => {
    const gov = createGovernor({ start: 'min' });
    expect(feed(gov, 100, 0, 30_000)).toEqual([]);
    expect(gov.tier()).toBe('min');
  });

  it('只低一個視窗不降：夾在好視窗之間的卡頓不算「連續兩個」', () => {
    const gov = createGovernor({ start: 'high' });
    expect(feed(gov, 20, 0, 3000)).toEqual([]); // 暖機＋一個好視窗（50 fps，結束於 3000）
    expect(feed(gov, 40, 3040, 4000)).toEqual([]); // 一個差視窗（25 fps，結束於 4000）
    expect(feed(gov, 20, 4020, 5000)).toEqual([]); // 好視窗把「連續」打斷
    expect(feed(gov, 40, 5040, 6000)).toEqual([]); // 又一個差視窗，仍只算一次
    expect(gov.tier()).toBe('high');
  });

  it('門檻是 floorFps：恰 40 fps（25 ms）不算低', () => {
    const gov = createGovernor({ start: 'high' });
    expect(feed(gov, 25, 0, 20_000)).toEqual([]);
  });

  it('單格間隔 > 1000 ms（分頁被切走）重置視窗，不算一次低 fps，也打斷連續', () => {
    const gov = createGovernor({ start: 'high' });
    expect(feed(gov, 40, 0, 3000)).toEqual([]); // 第一個差視窗已記一次（結束於 3000）
    // 切走 1500 ms 後回來。若不重置，這一格會把 [3000, 4500) 當成第二個差視窗而立刻降級
    expect(gov.frame(4500)).toBeNull();
    // 重新開始：4500 起算，兩個差視窗在 5500、6500 結束
    expect(feed(gov, 40, 4540, 6460)).toEqual([]);
    expect(gov.frame(6500)).toBe('mid');
  });

  it('單格間隔恰 1000 ms 不算切走（只有 > 1000 才重置）', () => {
    const gov = createGovernor({ start: 'high' });
    feed(gov, 40, 0, 3000);
    // 3000 → 4000 單一格：視窗結束、fps = 1 < 40 → 第二次低 → 降
    expect(gov.frame(4000)).toBe('mid');
  });

  it('時間倒退（時脈異常）當作重置，不拋錯也不降級', () => {
    const gov = createGovernor({ start: 'high' });
    feed(gov, 40, 0, 3000);
    expect(gov.frame(2000)).toBeNull();
    expect(gov.tier()).toBe('high');
  });

  it('參數可覆寫：floorFps、windowMs、strikes、graceMs、cooldownMs', () => {
    // 一次差視窗就降（strikes 1）、無暖機、視窗 500 ms
    const gov = createGovernor({ start: 'high', strikes: 1, graceMs: 0, windowMs: 500, floorFps: 30, cooldownMs: 0 });
    // 20 fps（50 ms）< 30：視窗 [0, 500) 結束於 t = 500
    expect(feed(gov, 50, 0, 450)).toEqual([]);
    expect(gov.frame(500)).toBe('mid');
    // 冷卻 0：下一個 500 ms 視窗結束就能再降
    expect(feed(gov, 50, 550, 950)).toEqual([]);
    expect(gov.frame(1000)).toBe('low');
  });
});
