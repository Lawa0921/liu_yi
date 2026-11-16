/**
 * 形體載入器與預取計畫（D10）。
 *
 * `createShapeLoader` 把「形體 id → 網址 → 位元組 → `Shape`」串起來，帶快取、在途請求去重與一次重試：
 *   - 同一個 id 同時被 `load` 兩次只會 `fetch` 一次，兩邊拿到同一個 `Shape`；載入完成後走快取。
 *   - 網路失敗（`fetch` reject）重試 1 次，還是失敗就 reject。內容壞了（魔數、長度、版本不符）不重試：
 *     位元組已經回來了，再抓一次通常還是同樣的內容（例如伺服器回了 404 頁面）。
 *   - 失敗一律不快取，下次 `load` 從頭再來。
 *   - `prefetch` 是 fire-and-forget：失敗被吞掉（真的要用時 `load` 會重試並回報錯誤）。
 *
 * `fetch` 由呼叫端提供（瀏覽器用 `fetch(url).then(r => r.arrayBuffer())`，測試給假的）；呼叫端的 `fetch` 要在非 2xx 時 reject，
 * 否則錯誤頁會當成內容回來（最後仍會因魔數不符而 reject，只是訊息比較不直接）。
 * `resolveUrl` 丟錯（未知的形體 id）會讓 `load` reject，不會同步丟出。
 */

import { BEATS, POSE_BY_BEAT, type Audience } from '../config/poses';
import { decodeShape, type Shape } from './format';

export interface ShapeLoader {
  load(id: string): Promise<Shape>;
  /** 背景預取：不等結果、不丟錯；已載入或在途的 id 會略過。 */
  prefetch(ids: readonly string[]): void;
  /** 已載入完成（可同步取用）。 */
  has(id: string): boolean;
}

export interface ShapeLoaderOptions {
  fetch: (url: string) => Promise<ArrayBuffer>;
  resolveUrl: (id: string) => string;
}

export function createShapeLoader(opts: ShapeLoaderOptions): ShapeLoader {
  const cache = new Map<string, Shape>();
  const inflight = new Map<string, Promise<Shape>>();

  async function fetchShape(id: string): Promise<Shape> {
    const url = opts.resolveUrl(id);
    let bytes: ArrayBuffer;
    try {
      bytes = await opts.fetch(url);
    } catch {
      bytes = await opts.fetch(url); // 網路失敗重試一次；第二次的錯誤原樣丟出
    }
    try {
      return decodeShape(new Uint8Array(bytes));
    } catch (error) {
      throw new Error(`Shape ${id} could not be decoded (${url}): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  const loader: ShapeLoader = {
    load(id) {
      const hit = cache.get(id);
      if (hit) return Promise.resolve(hit);
      const pending = inflight.get(id);
      if (pending) return pending;
      const promise = fetchShape(id).then(
        (shape) => {
          cache.set(id, shape);
          inflight.delete(id);
          return shape;
        },
        (error: unknown) => {
          inflight.delete(id);
          throw error;
        },
      );
      inflight.set(id, promise);
      return promise;
    },
    prefetch(ids) {
      for (const id of ids) {
        if (cache.has(id) || inflight.has(id)) continue;
        loader.load(id).catch(() => {});
      }
    },
    has: (id) => cache.has(id),
  };
  return loader;
}

/** 預取視窗：目前的 beat 往前、往後各幾個。 */
const PREFETCH_REACH = 2;
/** 開場還沒演完時只需要這兩個：吸氣聚成的 `lift` 與落地的 `land`（D18）。 */
const INTRO_SHAPES: readonly string[] = ['land', 'lift'];

/**
 * 該預取哪些形體：目前＋前後各 2 個 beat 的姿勢（去重、不含程序化的 `flow`）。
 * 依距離排序：目前這個最前面，其次是下一個、上一個、下下個、上上個，網路慢時先到的是最可能先用到的。
 * `beatIndex` 指 `BEATS` 的位置，超出範圍時夾回頭尾。開場還沒演完（`introPending`）只預取 `land`、`lift`。
 */
export function prefetchPlan(beatIndex: number, audience: Audience, introPending: boolean): string[] {
  if (introPending) return [...INTRO_SHAPES];
  const last = BEATS.length - 1;
  const at = Number.isNaN(beatIndex) ? 0 : Math.min(last, Math.max(0, Math.trunc(beatIndex)));
  const ids: string[] = [];
  for (let distance = 0; distance <= PREFETCH_REACH; distance++) {
    const candidates = distance === 0 ? [at] : [at + distance, at - distance];
    for (const index of candidates) {
      if (index < 0 || index > last) continue;
      const pose = POSE_BY_BEAT[audience][BEATS[index]!];
      if (pose !== 'flow' && !ids.includes(pose)) ids.push(pose);
    }
  }
  return ids;
}
