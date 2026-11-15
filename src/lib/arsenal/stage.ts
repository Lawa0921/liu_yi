// 兵器台的構圖：兵器要完整裝進「舞台範圍」（畫布裡不壓到標題與課程牌的那一塊），純函式。
// 長度單位隨呼叫者（公尺），角度弧度。

export interface Reach {
  /** 兵器的全長。 */
  length: number;
  /** 長軸兩側各要留多少（護手、纓穗）。 */
  clearance: number;
  /** 長軸與水平的夾角。 */
  lean: number;
}

/** 斜放之後佔的寬與高。 */
export function rotatedExtent({ length, clearance, lean }: Reach): { width: number; height: number } {
  const cos = Math.abs(Math.cos(lean));
  const sin = Math.abs(Math.sin(lean));
  return { width: length * cos + 2 * clearance * sin, height: length * sin + 2 * clearance * cos };
}

/** 放大到剛好裝進範圍的倍率（寬高都不超過，且有一邊頂到）。 */
export function fitScale(options: Reach & { regionWidth: number; regionHeight: number }): number {
  const { width, height } = rotatedExtent(options);
  if (!(options.regionWidth > 0) || !(options.regionHeight > 0) || !(width > 0) || !(height > 0)) return 0;
  return Math.min(options.regionWidth / width, options.regionHeight / height);
}

const MIN_LEAN = 0.12;
const MAX_LEAN = 1.15;

/** 靜止時的斜度：沿著範圍的對角線（略平一點），夾在不躺平、不直立之間。 */
export function restingLean(regionWidth: number, regionHeight: number): number {
  if (!(regionWidth > 0) || !(regionHeight > 0)) return MIN_LEAN;
  const diagonal = Math.atan2(regionHeight, regionWidth) * 0.92;
  return Math.max(MIN_LEAN, Math.min(MAX_LEAN, diagonal));
}
