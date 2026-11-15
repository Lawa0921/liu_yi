import { describe, expect, it } from 'vitest';
import { nearestIndex } from '../../src/scripts/gallery';

describe('nearestIndex（照片區目前捲到第幾張）', () => {
  const offsets = [0, 600, 1200];

  it('剛好對齊時回傳那一張', () => {
    expect(nearestIndex(offsets, 0)).toBe(0);
    expect(nearestIndex(offsets, 600)).toBe(1);
    expect(nearestIndex(offsets, 1200)).toBe(2);
  });

  it('捲到一半時取最接近的那一張', () => {
    expect(nearestIndex(offsets, 290)).toBe(0);
    expect(nearestIndex(offsets, 310)).toBe(1);
    expect(nearestIndex(offsets, 1100)).toBe(2);
  });

  it('超出範圍或只有一張時不會出錯', () => {
    expect(nearestIndex(offsets, -50)).toBe(0);
    expect(nearestIndex(offsets, 5000)).toBe(2);
    expect(nearestIndex([0], 300)).toBe(0);
    expect(nearestIndex([], 0)).toBe(0);
  });
});
