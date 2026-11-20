import { describe, expect, it, vi } from 'vitest';
import { BEATS, POSE_BY_BEAT, type Audience } from '../../src/qi/config/poses';
import { SHAPES } from '../../src/qi/config/shapes';
import { encodeShape, type Shape } from '../../src/qi/shapes/format';
import { createShapeLoader, prefetchPlan } from '../../src/qi/shapes/loader';
import { shapeUrlResolver } from '../../src/qi/shapes/urls';

/** 一個小而合法的 `.bin`（回傳獨立的 ArrayBuffer，和 `fetch().arrayBuffer()` 一樣）。 */
function binBuffer(count = 64, fill = 0): ArrayBuffer {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = ((i * 7 + fill) % 100) / 50 - 1;
  const shape: Shape = { count, positions, kinds: new Uint8Array(count).fill(50), min: [-1, -1, -1], max: [1, 1, 1] };
  const bytes = encodeShape(shape);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const resolveUrl = (id: string): string => `/shapes/${id}.bin`;

describe('createShapeLoader', () => {
  it('載入並解碼形體；has 只在載入完成後為 true', async () => {
    const fetch = vi.fn(async () => binBuffer(64));
    const loader = createShapeLoader({ fetch, resolveUrl });
    expect(loader.has('land')).toBe(false);
    const shape = await loader.load('land');
    expect(shape.count).toBe(64);
    expect(shape.kinds[0]).toBe(50);
    expect(fetch).toHaveBeenCalledWith('/shapes/land.bin');
    expect(loader.has('land')).toBe(true);
    expect(loader.has('lift')).toBe(false);
  });

  it('同時 load("land") 兩次：fetch 只呼叫一次，兩邊拿到同一個 Shape', async () => {
    const fetch = vi.fn<(url: string) => Promise<ArrayBuffer>>(async () => binBuffer());
    const loader = createShapeLoader({ fetch, resolveUrl });
    const [a, b] = await Promise.all([loader.load('land'), loader.load('land')]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('載入完成後再 load：走快取，不再 fetch', async () => {
    const fetch = vi.fn<(url: string) => Promise<ArrayBuffer>>(async () => binBuffer());
    const loader = createShapeLoader({ fetch, resolveUrl });
    const first = await loader.load('land');
    const second = await loader.load('land');
    expect(second).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('不同 id 各自請求自己的網址', async () => {
    const fetch = vi.fn<(url: string) => Promise<ArrayBuffer>>(async () => binBuffer());
    const loader = createShapeLoader({ fetch, resolveUrl });
    await Promise.all([loader.load('land'), loader.load('lift')]);
    expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual(['/shapes/land.bin', '/shapes/lift.bin']);
  });

  it('回傳資料魔數壞掉 → load reject，不快取；下次 load 重新請求並可成功', async () => {
    const bad = binBuffer();
    new Uint8Array(bad)[0] = 0x58; // 'QSH1' → 'XSH1'
    const fetch = vi.fn<(url: string) => Promise<ArrayBuffer>>().mockResolvedValueOnce(bad).mockResolvedValue(binBuffer());
    const loader = createShapeLoader({ fetch, resolveUrl });

    await expect(loader.load('land')).rejects.toThrow(/magic/i);
    expect(fetch).toHaveBeenCalledTimes(1); // 內容壞了不是網路失敗，不在同一次 load 內重試
    expect(loader.has('land')).toBe(false);

    const shape = await loader.load('land');
    expect(shape.count).toBe(64);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(loader.has('land')).toBe(true);
  });

  it('長度被截斷的檔也 reject 且不快取', async () => {
    const truncated = binBuffer().slice(0, 100);
    const fetch = vi.fn<(url: string) => Promise<ArrayBuffer>>().mockResolvedValueOnce(truncated).mockResolvedValue(binBuffer());
    const loader = createShapeLoader({ fetch, resolveUrl });
    await expect(loader.load('land')).rejects.toThrow(/length/i);
    expect(loader.has('land')).toBe(false);
    await expect(loader.load('land')).resolves.toMatchObject({ count: 64 });
  });

  it('網路失敗：重試 1 次，第二次成功就回傳資料', async () => {
    const fetch = vi.fn<(url: string) => Promise<ArrayBuffer>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(binBuffer());
    const loader = createShapeLoader({ fetch, resolveUrl });
    await expect(loader.load('land')).resolves.toMatchObject({ count: 64 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(loader.has('land')).toBe(true);
  });

  it('網路失敗：重試 1 次後仍失敗就 reject（共 2 次請求），不快取；之後再 load 重新來過', async () => {
    const fetch = vi.fn<(url: string) => Promise<ArrayBuffer>>().mockRejectedValue(new Error('offline'));
    const loader = createShapeLoader({ fetch, resolveUrl });
    await expect(loader.load('land')).rejects.toThrow('offline');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(loader.has('land')).toBe(false);

    fetch.mockResolvedValue(binBuffer());
    await expect(loader.load('land')).resolves.toMatchObject({ count: 64 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('網路失敗（重試後仍失敗）：錯誤帶形體 id 與網址，原始錯誤放在 cause', async () => {
    const original = new Error('offline');
    const fetch = vi.fn<(url: string) => Promise<ArrayBuffer>>().mockRejectedValue(original);
    const loader = createShapeLoader({ fetch, resolveUrl });
    const error = await loader.load('land').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('land');
    expect((error as Error).message).toContain('/shapes/land.bin');
    expect((error as Error).message).toContain('offline');
    expect((error as Error).cause).toBe(original);
  });

  it('網路失敗的 cause 是第二次（最後一次）的錯誤；非 Error 的 reject 值也包得起來', async () => {
    const last = new Error('second');
    const fetch = vi.fn<(url: string) => Promise<ArrayBuffer>>().mockRejectedValueOnce(new Error('first')).mockRejectedValueOnce(last);
    const loader = createShapeLoader({ fetch, resolveUrl });
    expect(((await loader.load('lift').catch((e: unknown) => e)) as Error).cause).toBe(last);

    const odd = createShapeLoader({ fetch: () => Promise.reject('plain string'), resolveUrl });
    const error = (await odd.load('kao').catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('kao');
    expect(error.message).toContain('plain string');
    expect(error.cause).toBe('plain string');
  });

  it('失敗時同時等待的呼叫端都收到 reject，且失敗不留在進行中表裡', async () => {
    const fetch = vi.fn<(url: string) => Promise<ArrayBuffer>>().mockRejectedValue(new Error('offline'));
    const loader = createShapeLoader({ fetch, resolveUrl });
    const results = await Promise.allSettled([loader.load('land'), loader.load('land')]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(fetch).toHaveBeenCalledTimes(2); // 兩個呼叫端共用同一次（含重試）的請求

    fetch.mockResolvedValue(binBuffer());
    await expect(loader.load('land')).resolves.toMatchObject({ count: 64 });
  });

  it('resolveUrl 丟錯（未知的形體 id）→ load reject 而非同步丟出，且不 fetch', async () => {
    const fetch = vi.fn<(url: string) => Promise<ArrayBuffer>>(async () => binBuffer());
    const loader = createShapeLoader({
      fetch,
      resolveUrl: () => {
        throw new Error('沒有這個形體');
      },
    });
    const promise = loader.load('nope');
    await expect(promise).rejects.toThrow('沒有這個形體');
    expect(fetch).not.toHaveBeenCalled();
    expect(loader.has('nope')).toBe(false);
  });

  it('prefetch：只對未載入且未在途的 id 請求；之後 load 共用在途請求', async () => {
    const fetch = vi.fn<(url: string) => Promise<ArrayBuffer>>(async () => binBuffer());
    const loader = createShapeLoader({ fetch, resolveUrl });
    await loader.load('land');
    fetch.mockClear();

    loader.prefetch(['land', 'lift', 'lift', 'kao']);
    expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual(['/shapes/kao.bin', '/shapes/lift.bin']);

    const lift = await loader.load('lift'); // 與預取共用同一次請求
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(lift.count).toBe(64);
    await Promise.resolve();
    expect(loader.has('kao')).toBe(true);
  });

  it('prefetch 失敗不丟 unhandled rejection，也不快取；之後 load 仍會重試', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const fetch = vi.fn<(url: string) => Promise<ArrayBuffer>>().mockRejectedValue(new Error('offline'));
      const loader = createShapeLoader({ fetch, resolveUrl });
      loader.prefetch(['land']);
      await new Promise((r) => setTimeout(r, 10));
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(loader.has('land')).toBe(false);
      expect(unhandled).not.toHaveBeenCalled();

      fetch.mockResolvedValue(binBuffer());
      await expect(loader.load('land')).resolves.toMatchObject({ count: 64 });
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('原型鏈名稱當 id 不會被當成已載入', () => {
    const loader = createShapeLoader({ fetch: async () => binBuffer(), resolveUrl });
    expect(loader.has('constructor')).toBe(false);
    expect(loader.has('__proto__')).toBe(false);
    expect(loader.has('toString')).toBe(false);
  });
});

describe('prefetchPlan（目前＋前後各 2 個 beat）', () => {
  it('開場還沒演完：只預取 land、lift（不管 beat 與對象）', () => {
    expect(prefetchPlan(0, 'adult', true)).toEqual(['land', 'lift']);
    expect(prefetchPlan(5, 'kid', true)).toEqual(['land', 'lift']);
  });

  it('beat 0（視窗 beat 0–2）：恰為 land、dingzhou、guard', () => {
    expect([...prefetchPlan(0, 'adult', false)].sort()).toEqual(['dingzhou', 'guard', 'land']);
  });

  it('beat 9、小孩（視窗 beat 7–10）：含 others、salute、scroll、crest，不含 flow（flow 只給入館閘門，沒有形體檔）', () => {
    const plan = prefetchPlan(9, 'kid', false);
    expect([...plan].sort()).toEqual(['crest', 'others', 'salute', 'scroll']);
    expect(plan).not.toContain('flow');
  });

  it('beat 1、小孩（視窗 beat 0–3）：含 land、kid-wushu、kid-defense-a、kid-defense-b', () => {
    expect([...prefetchPlan(1, 'kid', false)].sort()).toEqual(['kid-defense-a', 'kid-defense-b', 'kid-wushu', 'land']);
  });

  it('中段（beat 5、大人）：視窗 beat 3–7，去重（大人沒有 combat-b，那一格延續護架）', () => {
    expect([...prefetchPlan(5, 'adult', false)].sort()).toEqual(['guard', 'jian', 'miaodao', 'others', 'spear']);
  });

  it('目前這一格排最前面（先載最近的）', () => {
    expect(prefetchPlan(1, 'adult', false)[0]).toBe('dingzhou');
    expect(prefetchPlan(9, 'adult', false)[0]).toBe('scroll'); // beat 9（課表）是竹簡
  });

  it('beatIndex 超出範圍時夾到 0..最後一個 beat（不丟錯）', () => {
    expect(prefetchPlan(-3, 'adult', false)).toEqual(prefetchPlan(0, 'adult', false));
    expect(prefetchPlan(99, 'kid', false)).toEqual(prefetchPlan(BEATS.length - 1, 'kid', false));
    expect(prefetchPlan(Number.NaN, 'adult', false)).toEqual(prefetchPlan(0, 'adult', false));
  });

  it('所有 beat × 對象：id 不重複、不含 flow、都是真實存在的形體', () => {
    for (const audience of ['adult', 'kid'] as Audience[]) {
      for (let i = 0; i < BEATS.length; i++) {
        const plan = prefetchPlan(i, audience, false);
        expect(new Set(plan).size).toBe(plan.length);
        expect(plan).not.toContain('flow');
        for (const id of plan) expect(Object.hasOwn(SHAPES, id), `${audience}@${i}: ${id}`).toBe(true);
        // 目前這個 beat 的姿勢（不是 flow 時）一定在裡面
        const current = POSE_BY_BEAT[audience][BEATS[i]!];
        if (current !== 'flow') expect(plan).toContain(current);
      }
    }
  });

  it('回傳值可直接餵 loader.prefetch', async () => {
    const fetch = vi.fn<(url: string) => Promise<ArrayBuffer>>(async () => binBuffer());
    const loader = createShapeLoader({ fetch, resolveUrl });
    loader.prefetch(prefetchPlan(2, 'adult', false));
    expect(fetch).toHaveBeenCalledTimes(prefetchPlan(2, 'adult', false).length);
  });
});

describe('shapeUrlResolver（urls.ts 的查表邏輯；import.meta.glob 的結果由它包裝）', () => {
  const resolve = shapeUrlResolver({
    '../../assets/generated/qi/shapes/land.bin': '/liu_yi/_astro/land.AAAA.bin',
    '../../assets/generated/qi/shapes/kid-weapon.bin': '/liu_yi/_astro/kid-weapon.BBBB.bin',
    '../../assets/generated/qi/shapes/weapon.bin': '/liu_yi/_astro/weapon.CCCC.bin',
  });

  it('依檔名（不含 .bin）查網址，不會被結尾相同的檔名誤中', () => {
    expect(resolve('land')).toBe('/liu_yi/_astro/land.AAAA.bin');
    expect(resolve('weapon')).toBe('/liu_yi/_astro/weapon.CCCC.bin');
    expect(resolve('kid-weapon')).toBe('/liu_yi/_astro/kid-weapon.BBBB.bin');
  });

  it('沒有這個形體（含原型鏈名稱、路徑穿越）→ 丟錯，訊息帶 id', () => {
    for (const id of ['spear', 'constructor', '__proto__', '../land', 'land.bin', '']) {
      expect(() => resolve(id), id).toThrow(/No shape file/);
    }
  });
});
