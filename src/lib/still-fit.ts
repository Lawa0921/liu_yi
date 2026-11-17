// 靜態圖在頁面光點層裡的大小（建置時，在 Astro 的 frontmatter 裡用）：讀形體檔 `.bin` 的外框，換算 `config/still-fit.ts` 的倍率。
// 形體檔是建置產物（`integrations/qi-assets.ts` 在 `astro:config:setup` 產生），這時一定已經在了；找不到就在建置時直接失敗，不輸出大小不對的圖。
// 形體檔所在的目錄可以注入（預設是專案的建置產物目錄）：單元測試在暫存目錄寫假形體檔，不依賴被 gitignore 的建置產物（全新 clone 上也能跑）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stillScale } from '../qi/config/still-fit';
import { decodeShape } from '../qi/shapes/format';

interface Bounds {
  x: number;
  y: number;
  /** 外框中心的世界 y（靜態圖把外框置中；引擎是把世界的 `cy` 置中，兩者的差要補）。 */
  centerY: number;
}

/** 預設的形體檔目錄：建置在專案根目錄跑（Astro 的 cwd），`integrations/qi-assets.ts` 把形體檔產生在這裡。 */
const defaultDir = (): string => join(process.cwd(), 'src', 'assets', 'generated', 'qi', 'shapes');

/** 以「目錄＋形體 id」為鍵：同名的檔在不同目錄是不同的形體。 */
const bounds = new Map<string, Bounds>();

function boundsOf(id: string, dir: string): Bounds {
  const key = join(dir, id);
  let found = bounds.get(key);
  if (!found) {
    const shape = decodeShape(new Uint8Array(readFileSync(join(dir, `${id}.bin`))));
    found = { x: shape.max[0] - shape.min[0], y: shape.max[1] - shape.min[1], centerY: (shape.max[1] + shape.min[1]) / 2 };
    bounds.set(key, found);
  }
  return found;
}

/** 這個形體的靜態圖「每世界單位占圖高的倍率」（`stillScale`）；`imageAspect` 是那張圖的寬 ÷ 高；`dir` 是形體檔目錄（預設是專案的建置產物）。 */
export function stillScaleOf(id: string, imageAspect: number, dir: string = defaultDir()): number {
  return stillScale(boundsOf(id, dir), imageAspect);
}

/** 靜態圖要往下移多少世界單位才與引擎對齊：引擎把世界的 `cy` 放在槽中央，靜態圖把外框中心放在圖中央（落地人形兩者相同，蹲低的架勢外框中心比 `cy` 低）。 */
export function stillOffsetOf(id: string, cy: number, dir: string = defaultDir()): number {
  return cy - boundsOf(id, dir).centerY;
}
