/**
 * 頭高量測（D12 的「頭部大小對齊」用）。
 *
 * 由上而下讀剪影每一列的不透明像素數（列寬），平滑後：
 *   1. 頭＝第一個列寬局部最大 P（先上升到頭的最寬處，再下降 ≥ DIP 才算數）；
 *   2. 肩＝P 之後第一個列寬 ≥ STEP × P 的列（肩膀比頭寬得多）；
 *   3. 頸＝從肩往上走、肩與頭之間「最後一個」列寬谷（遇到比谷底高出 TOL × P 的列就停）。
 *      取最後一個谷而不是第一個：頭髮、耳朵、下巴會在頭內造成小起伏，真正的頸谷緊貼在肩的上方。
 * 回傳頸以上的高度（px，自主體最上列起算）。
 *
 * 限制：頸谷要真的存在才準。前傾、縮肩或手臂貼著頭的架勢（頂肘、撐捶、貼山靠、提膝）在列寬輪廓裡沒有頸谷，
 * 量到的值不可靠，那幾張的 headPx 由 `config/figures.ts` 手填。
 */

/** 不透明門檻：alpha ≥ 128（與 silhouette-qa 的「alpha > 127」一致）。 */
const OPAQUE = 128;
/** 平滑半徑：主體高度的 1%（至少 1 列）。 */
const SMOOTH = 0.01;
/** 頭峰之後下降超過 3% 才確認這是頭峰。 */
const DIP = 0.03;
/** 列寬達頭峰的 1.25 倍就是肩。 */
const STEP = 1.25;
/** 往上找頸谷時，列寬比谷底高出頭峰的 3% 就算爬出谷了。 */
const TOL = 0.03;

export function measureHeadHeight(alpha: Uint8Array, w: number, h: number): number {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || alpha.length !== w * h) {
    throw new RangeError(`遮罩尺寸不符：alpha.length = ${alpha.length}，寬高 ${w}×${h}`);
  }

  // 每列不透明像素數
  const counts = new Int32Array(h);
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    let c = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) if (alpha[row + x]! >= OPAQUE) c++;
    counts[y] = c;
    if (c > 0) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  if (top < 0) throw new RangeError('遮罩全透明，量不到頭');
  const rows = bottom - top + 1;

  // 平滑（整數前綴和，平台區的相等值才會逐位元相等）
  const radius = Math.max(1, Math.round(rows * SMOOTH));
  const prefix = new Float64Array(rows + 1);
  for (let i = 0; i < rows; i++) prefix[i + 1] = prefix[i]! + counts[top + i]!;
  const s = new Float64Array(rows);
  for (let i = 0; i < rows; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(rows - 1, i + radius);
    s[i] = (prefix[hi + 1]! - prefix[lo]!) / (hi - lo + 1);
  }

  // 頭峰與肩線
  let peak = 0;
  let peakAt = 0;
  let confirmed = false;
  let shoulder = rows - 1;
  for (let i = 0; i < rows; i++) {
    if (!confirmed) {
      if (s[i]! > peak) {
        peak = s[i]!;
        peakAt = i;
        continue;
      }
      if (s[i]! <= peak * (1 - DIP)) {
        confirmed = true;
      } else if (s[i]! >= peak * STEP) {
        // 還沒下降就直接進肩：頭縮在肩裡
        shoulder = i;
        break;
      } else {
        continue;
      }
    }
    if (s[i]! >= peak * STEP) {
      shoulder = i;
      break;
    }
  }

  // 從肩往上找最後一個谷（等值時取最上面那列：平台狀的頸取頭的那一端）
  let neck = shoulder;
  let valley = s[shoulder]!;
  for (let i = shoulder; i >= peakAt; i--) {
    if (s[i]! <= valley) {
      valley = s[i]!;
      neck = i;
    } else if (s[i]! > valley + TOL * peak) {
      break;
    }
  }
  return Math.max(1, neck);
}
