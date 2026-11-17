// 靜態圖在頁面光點層裡的大小（建置時，在 Astro 的 frontmatter 裡用）：讀形體檔 `.bin` 的外框，換算 `config/still-fit.ts` 的倍率。
// 形體檔是建置產物（`integrations/qi-assets.ts` 在 `astro:config:setup` 產生），這時一定已經在了；找不到就在建置時直接失敗，不輸出大小不對的圖。
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

const bounds = new Map<string, Bounds>();

function boundsOf(id: string): Bounds {
  let found = bounds.get(id);
  if (!found) {
    const file = join(process.cwd(), 'src', 'assets', 'generated', 'qi', 'shapes', `${id}.bin`);
    const shape = decodeShape(new Uint8Array(readFileSync(file)));
    found = { x: shape.max[0] - shape.min[0], y: shape.max[1] - shape.min[1], centerY: (shape.max[1] + shape.min[1]) / 2 };
    bounds.set(id, found);
  }
  return found;
}

/** 這個形體的靜態圖「每世界單位占圖高的倍率」（`stillScale`）；`imageAspect` 是那張圖的寬 ÷ 高。 */
export function stillScaleOf(id: string, imageAspect: number): number {
  return stillScale(boundsOf(id), imageAspect);
}

/** 靜態圖要往下移多少世界單位才與引擎對齊：引擎把世界的 `cy` 放在槽中央，靜態圖把外框中心放在圖中央（落地人形兩者相同，蹲低的架勢外框中心比 `cy` 低）。 */
export function stillOffsetOf(id: string, cy: number): number {
  return cy - boundsOf(id).centerY;
}
