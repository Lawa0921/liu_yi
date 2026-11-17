import { describe, expect, it } from 'vitest';
import { INTRO_STORAGE_KEY, introSeen, markIntroSeen, shouldShowGate, type GateEnv } from '../../src/scripts/home/intro-gate';

/** 隱私模式／被封鎖的 storage：任何讀寫都丟例外。 */
const blocked = {
  getItem(): never {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem(): never {
    throw new DOMException('blocked', 'SecurityError');
  },
};

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('開場閘門（工作階段內只演一次）', () => {
  it('鍵是 liuyi:qi-intro', () => {
    expect(INTRO_STORAGE_KEY).toBe('liuyi:qi-intro');
  });

  it('沒記錄過：introSeen 為假；markIntroSeen 之後為真，且寫的是 "1"', () => {
    const storage = memory();
    expect(introSeen(storage)).toBe(false);
    markIntroSeen(storage);
    expect(storage.data.get('liuyi:qi-intro')).toBe('1');
    expect(introSeen(storage)).toBe(true);
  });

  it('只認 "1"：其他值（舊資料、被竄改）算沒看過', () => {
    const storage = memory();
    storage.data.set(INTRO_STORAGE_KEY, 'true');
    expect(introSeen(storage)).toBe(false);
  });

  it('storage 是 null（取不到 sessionStorage）：不丟例外；introSeen 為假、markIntroSeen 什麼都不做', () => {
    expect(() => markIntroSeen(null)).not.toThrow();
    expect(introSeen(null)).toBe(false);
  });

  it('storage 讀寫都會丟例外：全部吞掉（introSeen 為假）', () => {
    expect(() => markIntroSeen(blocked)).not.toThrow();
    expect(introSeen(blocked)).toBe(false);
  });
});

// ── 入館閘門要不要顯示（Task 25）──────────────────────────────────────
/** 一般的首次訪客：有動態、有 WebGL、沒進過館、沒帶錨點、不是從站內其他頁來。 */
const FIRST_VISIT: GateEnv = { reducedMotion: false, noWebgl: false, visited: false, hasHash: false, fromSite: false };

describe('shouldShowGate：只有首次進站、可以演開場的訪客才擋', () => {
  it('首次進站（有動態、有 WebGL、沒進過、沒錨點、不是站內來）：顯示', () => {
    expect(shouldShowGate(FIRST_VISIT)).toBe(true);
  });

  it.each<[string, Partial<GateEnv>]>([
    ['偏好減少動態', { reducedMotion: true }],
    ['沒有 WebGL（含引擎掛不上的退回）', { noWebgl: true }],
    ['這個工作階段進過館（再訪、按上一頁回來）', { visited: true }],
    ['網址帶 #錨點（例如 #booking）直接前往', { hasHash: true }],
    ['從站內其他頁進來', { fromSite: true }],
  ])('%s：不擋', (_label, change) => {
    expect(shouldShowGate({ ...FIRST_VISIT, ...change })).toBe(false);
  });

  it('五個條件的 32 種組合：恰有一種顯示（全部為假）', () => {
    const keys: (keyof GateEnv)[] = ['reducedMotion', 'noWebgl', 'visited', 'hasHash', 'fromSite'];
    let shown = 0;
    for (let bits = 0; bits < 32; bits++) {
      const env = Object.fromEntries(keys.map((key, i) => [key, (bits & (1 << i)) !== 0])) as unknown as GateEnv;
      if (shouldShowGate(env)) {
        shown++;
        expect(bits).toBe(0);
      }
    }
    expect(shown).toBe(1);
  });
});
