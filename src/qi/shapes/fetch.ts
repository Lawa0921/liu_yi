/**
 * 形體載入器用的真實 `fetch`（瀏覽器端；`createShapeLoader` 的 `fetch` 選項就傳它）。
 *
 * 瀏覽器的 `fetch` 碰到 404／500 仍然 resolve，錯誤頁會被當成內容回來（之後才因魔數不符而 reject，訊息不直接），
 * 所以這裡非 2xx 一律 reject。再加一個逾時（預設 15 秒，涵蓋標頭與整個下載）：網路卡死時要讓載入器的重試與呼叫端的
 * 錯誤處理有機會跑，不能無限等下去。
 *
 * 逾時優先用 `AbortSignal.timeout`（不受測試的假時鐘 `page.clock` 影響，也不必清計時器）。沒有這個 API 的瀏覽器
 * （Safari 16 以前）退回 `AbortController` ＋ `setTimeout`，並在結束時清掉計時器。兩條路徑的行為一致。
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

interface Deadline {
  signal: AbortSignal;
  /** 結束時呼叫（清計時器）。 */
  cancel(): void;
  /** 中止的原因是逾時；是的話回原因，否則 undefined。 */
  timeoutReason(): unknown;
}

function deadline(ms: number): Deadline {
  if (typeof AbortSignal.timeout === 'function') {
    const signal = AbortSignal.timeout(ms);
    return {
      signal,
      cancel: () => {},
      timeoutReason: () => (signal.aborted && signal.reason instanceof Error && signal.reason.name === 'TimeoutError' ? signal.reason : undefined),
    };
  }
  const controller = new AbortController();
  let reason: unknown;
  const timer = setTimeout(() => {
    reason = new DOMException('The operation timed out.', 'TimeoutError');
    controller.abort(reason);
  }, ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer), timeoutReason: () => reason };
}

export async function fetchBytes(url: string, opts: FetchBytesOptions = {}): Promise<ArrayBuffer> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const limit = deadline(timeoutMs);
  const request = opts.fetch ?? ((u, init) => fetch(u, init));
  try {
    const response = await request(url, { signal: limit.signal });
    if (!response.ok) throw new Error(`Request for ${url} failed with HTTP ${response.status}`);
    return await response.arrayBuffer();
  } catch (error) {
    // 逾時：其他錯誤（網路、非 2xx）原樣往上丟
    const reason = limit.timeoutReason();
    if (reason !== undefined) throw new Error(`Request for ${url} timed out after ${timeoutMs} ms`, { cause: reason });
    throw error;
  } finally {
    limit.cancel();
  }
}
