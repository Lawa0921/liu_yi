// 首屏體積光（src/scripts/atmos.ts 的原生 WebGL2 著色器）的節流規則。純函式。

export const ATMOS = {
  /** 最多每秒畫幾格（全螢幕著色器很吃 GPU／CPU，不必跟螢幕更新率一樣快）。 */
  fps: 30,
  /** 畫布解析度相對於 CSS 像素的比例（光與霧本來就是糊的，低解析度看不出來）。 */
  scale: 0.42,
  /** 畫布寬度的上限（px）。 */
  maxWidth: 820,
  /** 呼吸最暗時剩多少（1 是最亮）：光柱永遠看得到。 */
  breatheFloor: 0.74,
  /** 光柱裡一層不隨噪聲消失的底光（0–1）。 */
  rayFloor: 0.3,
  /** 手機：光柱只當背景——強度與不透明度上限都壓低。 */
  mobileShaft: 0.42,
  mobileAlpha: 0.45,
  desktopAlpha: 0.88,
} as const;

/** 這一格要不要畫：畫面外不畫；減少動態只畫第一格（靜態的光）；其餘依 fps 節流。 */
export function atmosFrameDue(facts: { sinceLast: number; visible: boolean; reducedMotion: boolean; drawn: number }): boolean {
  if (facts.reducedMotion) return facts.drawn === 0;
  if (!facts.visible) return false;
  if (facts.drawn === 0) return true;
  return facts.sinceLast >= 1000 / ATMOS.fps - 1;
}
