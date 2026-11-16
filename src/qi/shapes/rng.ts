/**
 * 固定種子的亂數（mulberry32 的變體；搬自試作 `src/lab/qi/shapes.ts` 的 `rng`）。
 * 回傳 [0, 1) 的函式，同 seed 同序列。人形與兵器的取樣共用，每次載入都長一樣。
 */
export function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
