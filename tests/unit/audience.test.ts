import { describe, expect, it, vi } from 'vitest';
import {
  AUDIENCE_STORAGE_KEY,
  DEFAULT_AUDIENCE,
  createAudienceState,
  parseAudience,
  readAudience,
  writeAudience,
} from '../../src/lib/audience';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

const brokenStorage = {
  getItem: (): string | null => {
    throw new Error('denied');
  },
  setItem: (): void => {
    throw new Error('denied');
  },
};

describe('parseAudience', () => {
  it('accepts the two audiences', () => {
    expect(parseAudience('adult')).toBe('adult');
    expect(parseAudience('kid')).toBe('kid');
  });

  it('falls back to adult for anything else', () => {
    expect(DEFAULT_AUDIENCE).toBe('adult');
    for (const raw of [null, undefined, '', 'all', 'KID', 42, {}]) {
      expect(parseAudience(raw)).toBe('adult');
    }
  });
});

describe('readAudience / writeAudience', () => {
  it('defaults to adult when nothing is stored', () => {
    expect(readAudience(memoryStorage())).toBe('adult');
    expect(readAudience(null)).toBe('adult');
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    writeAudience(storage, 'kid');
    expect(storage.map.get(AUDIENCE_STORAGE_KEY)).toBe('kid');
    expect(readAudience(storage)).toBe('kid');
  });

  it('ignores corrupted values and storage that throws', () => {
    expect(readAudience(memoryStorage({ [AUDIENCE_STORAGE_KEY]: 'grown-up' }))).toBe('adult');
    expect(readAudience(brokenStorage)).toBe('adult');
    expect(() => writeAudience(brokenStorage, 'kid')).not.toThrow();
  });
});

describe('createAudienceState', () => {
  it('starts from the stored value', () => {
    const state = createAudienceState({ storage: memoryStorage({ [AUDIENCE_STORAGE_KEY]: 'kid' }) });
    expect(state.get()).toBe('kid');
  });

  it('persists and notifies on change', () => {
    const storage = memoryStorage();
    const onChange = vi.fn();
    const state = createAudienceState({ storage, onChange });
    expect(state.get()).toBe('adult');
    state.set('kid');
    expect(state.get()).toBe('kid');
    expect(storage.map.get(AUDIENCE_STORAGE_KEY)).toBe('kid');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('kid');
  });

  it('does not notify when the value is unchanged, and sanitises bad input', () => {
    const onChange = vi.fn();
    const state = createAudienceState({ storage: memoryStorage(), onChange });
    state.set('adult');
    expect(onChange).not.toHaveBeenCalled();
    state.set('nonsense' as never);
    expect(state.get()).toBe('adult');
  });

  it('still works in memory when storage is unavailable', () => {
    const state = createAudienceState({ storage: brokenStorage });
    state.set('kid');
    expect(state.get()).toBe('kid');
  });
});
