/**
 * 形體載入器用的真實 `fetch`（瀏覽器端；`createShapeLoader` 的 `fetch` 選項就傳它）。
 *
 * 瀏覽器的 `fetch` 碰到 404／500 仍然 resolve，錯誤頁會被當成內容回來（之後才因魔數不符而 reject，訊息不直接），
 * 所以這裡非 2xx 一律 reject。再加一個逾時（預設 15 秒，涵蓋標頭與整個下載）：網路卡死時要讓載入器的重試與呼叫端的
 * 錯誤處理有機會跑，不能無限等下去。
 *
 * 逾時用 `AbortSignal.timeout`，不用 `setTimeout`：它不受測試的假時鐘（`page.clock`）影響，也不必記得清計時器。
 * 注意：會被打進引擎 chunk，所以錯誤訊息只用英文。
 */

export const FETCH_TIMEOUT_MS = 15_000;

/** 只要求 `fetch` 回應的這三個成員，測試可以給假的。 */
type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface FetchBytesOptions {
  /** 逾時（ms）。預設 `FETCH_TIMEOUT_MS`。 */
  timeoutMs?: number;
  /** 預設用全域 `fetch`。 */
  fetch?: FetchLike;
}

export async function fetchBytes(url: string, opts: FetchBytesOptions = {}): Promise<ArrayBuffer> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  const request = opts.fetch ?? ((u, init) => fetch(u, init));
  try {
    const response = await request(url, { signal });
    if (!response.ok) throw new Error(`Request for ${url} failed with HTTP ${response.status}`);
    return await response.arrayBuffer();
  } catch (error) {
    // 逾時：`AbortSignal.timeout` 的原因是 TimeoutError。其他錯誤（網路、非 2xx）原樣往上丟。
    if (signal.aborted && signal.reason instanceof Error && signal.reason.name === 'TimeoutError') {
      throw new Error(`Request for ${url} timed out after ${timeoutMs} ms`, { cause: signal.reason });
    }
    throw error;
  }
}
