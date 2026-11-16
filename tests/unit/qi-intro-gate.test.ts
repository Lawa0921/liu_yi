import { describe, expect, it } from 'vitest';
import { INTRO_STORAGE_KEY, introSeen, markIntroSeen } from '../../src/scripts/home/intro-gate';

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
