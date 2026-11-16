// 首屏「一震開門」的一次性狀態與時間軸（純函式）。繪製與 DOM 在 src/scripts/opening.ts。
// 節奏：蓄（全黑，只有一條地平線）→ 擊（震腳落下，裂紋炸開一段）→ 定格（兩三幀不動）→ 餘韻（裂到底、塵浪、獅子被震出來）。

export const OPENING_KEY = 'liuyi:opening';

export const OPENING = {
  /** 震腳落下的時刻。 */
  strikeAt: 620,
  /** 擊中後定格多久：60fps 的兩三幀。 */
  freezeMs: 45,
  /** 定格後裂紋裂到底要多久。 */
  crackMs: 260,
  /** 擊中瞬間裂紋先炸開的比例。 */
  firstCrack: 0.3,
  /** 整段演完（之後是終態）：刻字之後還有最後一拍的蓋印。 */
  totalMs: 2000,
} as const;

export type OpeningPhase = 'charge' | 'freeze' | 'release' | 'done';

export interface OpeningFrame {
  phase: OpeningPhase;
  /** 已經落下了（獅子與站名可以出來了）。 */
  struck: boolean;
  /** 裂紋露出的比例（0–1）。 */
  cracks: number;
}

interface SeenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 這次進站要完整演（play）還是直接顯示終態（final）。 */
export function openingMode(options: { storage: SeenStorage | null; reducedMotion: boolean }): 'play' | 'final' {
  if (options.reducedMotion) return 'final';
  try {
    return options.storage?.getItem(OPENING_KEY) === '1' ? 'final' : 'play';
  } catch {
    return 'play';
  }
}

export function markOpeningSeen(storage: SeenStorage | null): void {
  try {
    storage?.setItem(OPENING_KEY, '1');
  } catch {
    // 存不進去就算了：下次再演一次而已。
  }
}

export function openingFrame(elapsedMs: number): OpeningFrame {
  const { strikeAt, freezeMs, crackMs, firstCrack, totalMs } = OPENING;
  if (!(elapsedMs >= strikeAt)) return { phase: 'charge', struck: false, cracks: 0 };
  if (elapsedMs >= totalMs) return { phase: 'done', struck: true, cracks: 1 };
  const since = elapsedMs - strikeAt;
  if (since < freezeMs) return { phase: 'freeze', struck: true, cracks: firstCrack };
  const t = Math.min(1, (since - freezeMs) / crackMs);
  // 先快後慢地裂到底。
  const eased = 1 - Math.pow(1 - t, 3);
  return { phase: 'release', struck: true, cracks: firstCrack + (1 - firstCrack) * eased };
}
