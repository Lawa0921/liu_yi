/**
 * 剪影場景的視差計算（Task 27）：純函式，不碰 DOM，單元測試直接驗；瀏覽器端的接線在 `scripts/scene.ts`。
 *
 * 場景由遠到近四層（遠景 far、中景 mid、人物 subject、前景 fg）。深度感來自兩種位移，全部只動 CSS transform：
 *   - 捲動視差（`scrollOffset`）：場景跟著頁面捲走，各層相對頁面的速度不同——遠景比頁面慢（`SCROLL_SPEED` < 1，往下補償）、
 *     前景比頁面快（> 1，往上多走一段），人物與頁面同速（它是畫面的錨）。位移 = 捲動量 ×（1 − 速度），捲過場景高度之後不再增加。
 *   - 滑鼠微傾（`tiltOffset`，桌機有指標才有）：指標在場景裡的位置（−1…1）帶動各層位移，越近的層位移上限越大（`TILT_MAX_PX`，最多 14 px），
 *     而且近景與遠景方向相反（遠景跟著指標、前景逆著指標），像從窗口往外看時頭動一下的視差。手機沒有指標、也不要陀螺儀權限，只做捲動視差。
 *   - 減少動態（`reduced`）：兩種位移一律歸零。
 *
 * 首頁（`homeShift`）的景深層是固定在視窗的（光點畫布也是），沒有「場景捲走」這回事，所以改依整頁捲動進度（0–1）位移：
 * 進度 0.5 在原位，往兩端各移 ±幅度；遠景幅度小、前景大，方向相反。
 */

export type LayerKind = 'far' | 'mid' | 'subject' | 'fg';

/** 由遠到近。 */
export const LAYER_KINDS: readonly LayerKind[] = ['far', 'mid', 'subject', 'fg'];

/** 各層相對頁面捲動的速度（1 = 與頁面同速）。 */
export const SCROLL_SPEED: Record<LayerKind, number> = { far: 0.78, mid: 0.9, subject: 1, fg: 1.32 };

/** 各層滑鼠微傾的位移上限（px，水平與垂直各自）：遠景幾乎不動，前景最多十四。 */
export const TILT_MAX_PX: Record<LayerKind, number> = { far: 2, mid: 5, subject: 8, fg: 14 };
/** 位移方向：遠景與中景跟著指標，前景逆著指標；人物是畫面的錨，只輕微逆著。 */
const TILT_SIGN: Record<LayerKind, number> = { far: 1, mid: 1, subject: -1, fg: -1 };

/** 首頁固定層的位移幅度（占視窗高的比例）：進度 0 與 1 各移這麼多（遠景往下、前景往上）。 */
const HOME_AMPLITUDE: Record<'far' | 'mid' | 'fg', number> = { far: 0.015, mid: 0.035, fg: -0.055 };

const finite = (value: number): boolean => Number.isFinite(value);
const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);
/** 把 −0 變成 0（比較與字串輸出都不出現 "-0"）。 */
const plain = (value: number): number => (value === 0 ? 0 : value);

/** 捲動視差：這一層相對「跟著頁面走」的位置要再位移多少 px（正＝往下）。 */
export function scrollOffset(kind: LayerKind, scrollY: number, sceneHeight: number, reduced: boolean): number {
  if (reduced || !finite(scrollY) || !finite(sceneHeight) || !(sceneHeight > 0)) return 0;
  const travelled = clamp(scrollY, 0, sceneHeight);
  return plain(travelled * (1 - SCROLL_SPEED[kind]));
}

export interface Pointer {
  /** 指標在場景裡的水平位置，−1（左緣）…1（右緣）；超出會夾住。 */
  x: number;
  y: number;
}

/** 滑鼠微傾：這一層的 (x, y) 位移（px）。沒有指標（觸控、還沒移動）或座標不是有限數就是 0。 */
export function tiltOffset(kind: LayerKind, pointer: Pointer | null, reduced: boolean): { x: number; y: number } {
  if (reduced || pointer === null || !finite(pointer.x) || !finite(pointer.y)) return { x: 0, y: 0 };
  const cap = TILT_MAX_PX[kind];
  const sign = TILT_SIGN[kind];
  return { x: plain(clamp(pointer.x, -1, 1) * cap * sign), y: plain(clamp(pointer.y, -1, 1) * cap * sign * 0.6) };
}

export interface TransformInput {
  scrollY: number;
  sceneHeight: number;
  pointer: Pointer | null;
  reduced: boolean;
}

const round1 = (value: number): number => plain(Math.round(value * 10) / 10);

/** 這一層的 CSS transform 字串（捲動與滑鼠位移相加，捨入到 0.1 px）。 */
export function layerTransform(kind: LayerKind, input: TransformInput): string {
  const tilt = tiltOffset(kind, input.pointer, input.reduced);
  const y = scrollOffset(kind, input.scrollY, input.sceneHeight, input.reduced) + tilt.y;
  return `translate3d(${round1(tilt.x)}px, ${round1(y)}px, 0)`;
}

/** 首頁固定層（遠景、中景、前景）的垂直位移（px）：`progress` 是整頁捲動進度 0–1（夾住）。 */
export function homeShift(kind: 'far' | 'mid' | 'fg', progress: number, viewportHeight: number, reduced: boolean): number {
  if (reduced || !finite(progress) || !finite(viewportHeight) || !(viewportHeight > 0)) return 0;
  return plain((clamp(progress, 0, 1) - 0.5) * 2 * HOME_AMPLITUDE[kind] * viewportHeight);
}
