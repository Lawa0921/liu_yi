import { describe, expect, it } from 'vitest';
import { anchorScrollY } from '../../src/scripts/home/audience-anchor';
import type { BeatRect } from '../../src/qi/engine/scroll-model';

// 切換對象後的 beat 位置（切換已套用：只屬於原對象的段落高度變 0）。視窗高 900。
const VH = 900;
const afterSwitchToAdult: BeatRect[] = [
  { id: 'opening', top: 0, height: 900 },
  { id: 'fist', top: 900, height: 800 },
  { id: 'combat-a', top: 1700, height: 800 },
  { id: 'combat-b', top: 2500, height: 0 }, // 大人沒有這一段（display: none）
  { id: 'weapon-a', top: 2500, height: 800 },
];

describe('anchorScrollY：切換對象時正停在對方沒有的段落，移回往前最近、仍顯示的那一段的中央', () => {
  it('小孩停在格鬥第二段（combat-b）切到大人：回到格鬥第一段（護架）的中央', () => {
    expect(anchorScrollY(afterSwitchToAdult, 'combat-b', VH)).toBe(1700 + 400 - 450);
  });

  it('原本停的段落切換後仍顯示：不動（回 undefined）', () => {
    expect(anchorScrollY(afterSwitchToAdult, 'combat-a', VH)).toBeUndefined();
    expect(anchorScrollY(afterSwitchToAdult, 'weapon-a', VH)).toBeUndefined();
  });

  it('還不知道停在哪一段、或段落不在頁面上：不動', () => {
    expect(anchorScrollY(afterSwitchToAdult, undefined, VH)).toBeUndefined();
    expect(anchorScrollY(afterSwitchToAdult, 'booking', VH)).toBeUndefined();
  });

  it('前面沒有任何有高度的段落：不動；算出來是負的就夾到 0', () => {
    expect(anchorScrollY([{ id: 'combat-b', top: 0, height: 0 }], 'combat-b', VH)).toBeUndefined();
    expect(
      anchorScrollY(
        [
          { id: 'fist', top: 0, height: 600 },
          { id: 'combat-b', top: 600, height: 0 },
        ],
        'combat-b',
        VH,
      ),
    ).toBe(0);
  });
});
