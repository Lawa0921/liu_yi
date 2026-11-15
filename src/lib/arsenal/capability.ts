// 3D 兵器的能力偵測與降級決策（設計文件 §15.3）。純函式；實際偵測在 src/scripts/weapons3d.ts。

export interface DeviceFacts {
  /** 建得出 WebGL context。 */
  webgl: boolean;
  viewportWidth: number;
  devicePixelRatio: number;
  /** 系統要求「減少動態」。 */
  reducedMotion: boolean;
  /** 主要指標是手指（觸控裝置）。 */
  coarsePointer: boolean;
  /** 瀏覽器開了省流量模式。 */
  saveData?: boolean;
}

export interface RenderPlan {
  /** 3d：畫 3D；fallback：留著第一版的 SVG 線稿。 */
  mode: '3d' | 'fallback';
  pixelRatio: number;
  shadows: boolean;
  /** 自動的動態：自轉、捲動時的轉場入場、亮刃閃光。拖曳不受它管。 */
  autoMotion: boolean;
  /** 刀光（拖曳的軌跡與幕間的斜劈）。 */
  slash: boolean;
  /** 震腳。 */
  stomp: boolean;
}

/** 桌機外框的斷點（60rem），與 CSS 一致。 */
export const DESKTOP_MIN_WIDTH = 960;
const DESKTOP_MAX_PIXEL_RATIO = 2;
const MOBILE_MAX_PIXEL_RATIO = 1.5;

export function planRendering(facts: DeviceFacts): RenderPlan {
  const mobile = facts.coarsePointer || facts.viewportWidth < DESKTOP_MIN_WIDTH;
  const dpr = facts.devicePixelRatio >= 1 ? facts.devicePixelRatio : 1;
  const cap = facts.saveData ? 1 : mobile ? MOBILE_MAX_PIXEL_RATIO : DESKTOP_MAX_PIXEL_RATIO;
  const motion = !facts.reducedMotion;
  return {
    mode: facts.webgl ? '3d' : 'fallback',
    pixelRatio: Math.min(dpr, cap),
    shadows: !mobile,
    autoMotion: motion,
    slash: motion,
    stomp: motion,
  };
}

export interface LoadFacts {
  /** 3D 區塊目前露在視窗裡的比例（0–1）。 */
  visibleRatio: number;
  /** 區塊離視窗最近的距離（px）；在視窗內是 0。 */
  distance: number;
  viewportHeight: number;
  /** 使用者捲動過了。 */
  hasScrolled: boolean;
}

/**
 * 要不要現在下載 three。
 * 首頁的「兵器」那一幕緊接在首屏下面，載入時會在視窗下緣露出一條邊——那不算「接近」，
 * 所以還沒捲動時要露出四分之一以上才載；捲動過之後，一個視窗高度以內就先載好。
 */
export function shouldLoad3d(facts: LoadFacts): boolean {
  if (facts.visibleRatio >= 0.25) return true;
  return facts.hasScrolled && facts.distance <= facts.viewportHeight;
}

/**
 * 符合載入條件之後，還要在畫面上連續停留多久才真的建立 3D（毫秒）。
 * 建立 WebGL、編譯著色器會佔住主執行緒一下。兵器台與課程頁的單件是那一塊的主角，一接近就建；
 * 課程卡只是卡片上的點綴，而且常在首屏——等人停下來看了才建，不卡到一進頁面就在點東西的人。
 */
export function mountDelayMs(mode: string | undefined): number {
  return mode === 'card' ? 1200 : 0;
}
