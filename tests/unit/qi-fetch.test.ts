import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FETCH_TIMEOUT_MS, fetchBytes } from '../../src/qi/shapes/fetch';

const bytes = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

/** 假的 `fetch`：回一個只實作 `ok`／`status`／`arrayBuffer` 的回應。 */
const respond = (status: number, body: ArrayBuffer = bytes(1, 2, 3)) =>
  vi.fn(async (_url: string, _init?: { signal?: AbortSignal }) => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => body }));

/** 永遠不回應、只在被中止時 reject 的 `fetch`（真的 `fetch` 被 `AbortSignal` 中止時也是這樣）。 */
const hang = () =>
  vi.fn(
    (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      }),
  );

/**
 * 逾時有兩條路徑：有 `AbortSignal.timeout` 就用它；沒有（Safari 16 以前）退回 `AbortController` ＋ `setTimeout`。
 * 同一組行為測試兩條路徑都跑一遍，再各補一個只屬於該路徑的測試。
 */
const nativeTimeout = AbortSignal.timeout;

describe.each([
  ['AbortSignal.timeout', true],
  ['AbortController 退路（沒有 AbortSignal.timeout）', false],
] as const)('fetchBytes（形體載入器的真實 fetch：非 2xx 要 reject、要有逾時）— %s', (_name, native) => {
  beforeEach(() => {
    if (!native) Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true, writable: true });
  });
  afterEach(() => {
    Object.defineProperty(AbortSignal, 'timeout', { value: nativeTimeout, configurable: true, writable: true });
    vi.restoreAllMocks();
  });

    it('2xx：回傳位元組', async () => {
      const fetch = respond(200, bytes(9, 8, 7));
      const result = await fetchBytes('/shapes/land.bin', { fetch });
      expect([...new Uint8Array(result)]).toEqual([9, 8, 7]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]![0]).toBe('/shapes/land.bin');
    });

    it.each([404, 500, 503, 301, 199])('HTTP %i → reject，訊息帶網址與狀態碼，且不讀內容', async (status) => {
      const body = vi.fn(async () => bytes(1));
      const fetch = vi.fn(async () => ({ ok: false, status, arrayBuffer: body }));
      const error = (await fetchBytes('/shapes/land.bin', { fetch }).catch((e: unknown) => e)) as Error;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('/shapes/land.bin');
      expect(error.message).toContain(String(status));
      expect(body).not.toHaveBeenCalled();
    });

    it('把 AbortSignal 傳給 fetch（逾時靠它中止請求）', async () => {
      const fetch = respond(200);
      await fetchBytes('/x.bin', { fetch });
      expect(fetch.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
    });

    it('逾時 → reject，訊息帶網址與毫秒數，cause 是中止原因', async () => {
      const fetch = hang();
      const error = (await fetchBytes('/shapes/slow.bin', { fetch, timeoutMs: 20 }).catch((e: unknown) => e)) as Error;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('/shapes/slow.bin');
      expect(error.message).toContain('timed out');
      expect(error.message).toContain('20');
      expect(error.cause).toBeDefined();
    });

    it('標頭回來了、內容卻一直不來：同樣逾時（逾時涵蓋整個下載）', async () => {
      const fetch = vi.fn(
        async (_url: string, init?: { signal?: AbortSignal }) => ({
          ok: true,
          status: 200,
          arrayBuffer: () =>
            new Promise<ArrayBuffer>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
            }),
        }),
      );
      const error = (await fetchBytes('/shapes/slow.bin', { fetch, timeoutMs: 20 }).catch((e: unknown) => e)) as Error;
      expect(error.message).toContain('timed out');
    });

    it('網路本身失敗（fetch reject）：原樣往上丟，不誤報成逾時', async () => {
      const offline = new TypeError('Failed to fetch');
      const error = await fetchBytes('/x.bin', { fetch: async () => Promise.reject(offline) }).catch((e: unknown) => e);
      expect(error).toBe(offline);
    });

    it('預設逾時是 15 秒', () => {
      expect(FETCH_TIMEOUT_MS).toBe(15_000);
    });

  it(native ? '用的是 AbortSignal.timeout（帶毫秒數）' : '沒有 AbortSignal.timeout 時用 AbortController：不呼叫它、成功後清掉計時器、失敗後也清', async () => {
    if (native) {
      const spy = vi.spyOn(AbortSignal, 'timeout');
      await fetchBytes('/x.bin', { fetch: respond(200), timeoutMs: 1234 });
      expect(spy).toHaveBeenCalledWith(1234);
      return;
    }
    expect(AbortSignal.timeout).toBeUndefined();
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    await fetchBytes('/x.bin', { fetch: respond(200), timeoutMs: 5000 });
    expect(clear).toHaveBeenCalledTimes(1);
    await fetchBytes('/x.bin', { fetch: respond(404), timeoutMs: 5000 }).catch(() => {});
    expect(clear).toHaveBeenCalledTimes(2);
  });
});
