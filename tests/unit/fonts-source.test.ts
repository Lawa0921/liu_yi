import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rename } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TWKAI_SOURCE, ensureSourceFont, extractEntry, sha256Hex } from '../../scripts/fonts/source';

// 預設照原樣轉給真的 rename；個別測試用 mockRejectedValueOnce 模擬 Windows 上 rename 的暫時性失敗。
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const errnoError = (code: string) => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });

const enc = new TextEncoder();
const ENTRY = 'TW-Kai.ttf';

// 假 TTF：夠大、含非 ASCII 位元組，確保不是靠文字比對蒙混過關
const fakeTtf = Uint8Array.from({ length: 4096 }, (_, i) => (i * 31 + 7) % 256);
const fakeSha = sha256Hex(fakeTtf);

function buildZip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}

function fakeFetchOf(zip: Uint8Array, init?: ResponseInit) {
  return vi.fn<typeof fetch>(async () => new Response(zip as BlobPart, init));
}

describe('TWKAI_SOURCE', () => {
  it('釘住簡報規定的版本、大小與雜湊', () => {
    expect(TWKAI_SOURCE.entry).toBe('TW-Kai.ttf');
    expect(TWKAI_SOURCE.version).toBe('11510.1');
    expect(TWKAI_SOURCE.bytes).toBe(36691296);
    expect(TWKAI_SOURCE.sha256).toBe('9b502e5197d52a946552bef100b9a3d601befcf896fb2b64f28f862314bea337');
    expect(TWKAI_SOURCE.zipUrl).toBe('https://data.cns11643.gov.tw/opendata/Fonts_Kai.zip');
  });
});

describe('sha256Hex', () => {
  it('abc 的 sha256 與標準測試向量相同', () => {
    expect(sha256Hex(enc.encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('空輸入也有確定的雜湊', () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('extractEntry', () => {
  it('從 zip 取出目標檔，內容逐位元相等', () => {
    const zip = buildZip({ [ENTRY]: fakeTtf, 'TW-Kai-Plus.ttf': enc.encode('other font') });
    const out = extractEntry(zip, ENTRY);
    expect(out.byteLength).toBe(fakeTtf.byteLength);
    expect(Buffer.from(out).equals(Buffer.from(fakeTtf))).toBe(true);
  });

  it('缺 entry 時丟出含 entry 名稱的錯誤', () => {
    const zip = buildZip({ 'TW-Kai-Plus.ttf': enc.encode('other font') });
    expect(() => extractEntry(zip, ENTRY)).toThrow(/TW-Kai\.ttf/);
  });

  it('只比對完整檔名，不會誤取同名後綴的檔', () => {
    const zip = buildZip({ 'sub/TW-Kai.ttf': fakeTtf });
    expect(() => extractEntry(zip, ENTRY)).toThrow(/TW-Kai\.ttf/);
  });
});

describe('ensureSourceFont', () => {
  let tmp: string;
  let cacheDir: string;
  const source = () => ({ zipUrl: 'https://example.invalid/fake.zip', entry: ENTRY, sha256: fakeSha }) as const;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'fonts-source-'));
    cacheDir = join(tmp, 'cache', 'fonts');
    vi.mocked(rename).mockReset(); // 清掉呼叫紀錄，並回到「轉給真的 rename」
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('第一次下載並寫入快取，回傳 TTF 路徑', async () => {
    const fetchFake = fakeFetchOf(buildZip({ [ENTRY]: fakeTtf, 'TW-Kai-Plus.ttf': enc.encode('x') }));
    const path = await ensureSourceFont({ cacheDir, fetch: fetchFake, source: source() });

    expect(path).toBe(join(cacheDir, ENTRY));
    expect(fetchFake).toHaveBeenCalledTimes(1);
    expect(fetchFake).toHaveBeenCalledWith('https://example.invalid/fake.zip');
    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(fakeTtf))).toBe(true);
    // 快取目錄裡只剩目標檔，沒有殘留暫存檔，也沒有另外三個字型
    expect(readdirSync(cacheDir)).toEqual([ENTRY]);
  });

  it('第二次呼叫直接用快取，不再下載', async () => {
    const fetchFake = fakeFetchOf(buildZip({ [ENTRY]: fakeTtf }));
    const first = await ensureSourceFont({ cacheDir, fetch: fetchFake, source: source() });
    const second = await ensureSourceFont({ cacheDir, fetch: fetchFake, source: source() });

    expect(second).toBe(first);
    expect(fetchFake).toHaveBeenCalledTimes(1);
  });

  it('快取檔被竄改後會刪掉重下', async () => {
    const fetchFake = fakeFetchOf(buildZip({ [ENTRY]: fakeTtf }));
    const path = await ensureSourceFont({ cacheDir, fetch: fetchFake, source: source() });
    writeFileSync(path, enc.encode('corrupted'));

    const again = await ensureSourceFont({ cacheDir, fetch: fetchFake, source: source() });

    expect(again).toBe(path);
    expect(fetchFake).toHaveBeenCalledTimes(2);
    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(fakeTtf))).toBe(true);
  });

  it('下載內容雜湊不符：丟出含 sha256 的錯誤，且快取目錄沒有留下該檔', async () => {
    const wrong = Uint8Array.from(fakeTtf, (b) => (b + 1) % 256);
    const fetchFake = fakeFetchOf(buildZip({ [ENTRY]: wrong }));

    await expect(ensureSourceFont({ cacheDir, fetch: fetchFake, source: source() })).rejects.toThrow(/sha256/);

    expect(existsSync(join(cacheDir, ENTRY))).toBe(false);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it('快取已壞、重新下載的內容也不符：兩邊都不留檔', async () => {
    const good = fakeFetchOf(buildZip({ [ENTRY]: fakeTtf }));
    const path = await ensureSourceFont({ cacheDir, fetch: good, source: source() });
    // 快取被弄壞（會被刪除），重下載又得到壞檔：不該留下任何檔
    writeFileSync(path, enc.encode('corrupted'));
    const bad = fakeFetchOf(buildZip({ [ENTRY]: enc.encode('also wrong') }));

    await expect(ensureSourceFont({ cacheDir, fetch: bad, source: source() })).rejects.toThrow(/sha256/);

    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it('HTTP 非 2xx 時丟出含狀態碼的錯誤，不寫任何檔', async () => {
    const fetchFake = fakeFetchOf(enc.encode('nope'), { status: 404, statusText: 'Not Found' });

    await expect(ensureSourceFont({ cacheDir, fetch: fetchFake, source: source() })).rejects.toThrow(/404/);

    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it('fetch 本身失敗（斷網、DNS）時，錯誤訊息帶上 zipUrl，並保留原始錯誤為 cause', async () => {
    const network = new TypeError('fetch failed');
    const fetchFake = vi.fn<typeof fetch>(async () => {
      throw network;
    });

    const error = await ensureSourceFont({ cacheDir, fetch: fetchFake, source: source() }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('https://example.invalid/fake.zip');
    expect((error as Error).message).toContain('fetch failed');
    expect((error as Error).cause).toBe(network);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it('同一個行程內兩個並行呼叫互不踩暫存檔：都成功，快取目錄只剩目標檔', async () => {
    // 每次呼叫都要拿到新的 Response（body 只能讀一次）
    const fetchEach = vi.fn<typeof fetch>(async () => new Response(buildZip({ [ENTRY]: fakeTtf }) as BlobPart));

    const [a, b] = await Promise.all([
      ensureSourceFont({ cacheDir, fetch: fetchEach, source: source() }),
      ensureSourceFont({ cacheDir, fetch: fetchEach, source: source() }),
    ]);

    expect(a).toBe(b);
    expect(readdirSync(cacheDir)).toEqual([ENTRY]);
    expect(Buffer.from(readFileSync(a)).equals(Buffer.from(fakeTtf))).toBe(true);
  });

  // 原因（2026-11-17 在 Windows 上實測重現）：兩個呼叫各自驗證完、同時 rename 到同一個目標時，晚到的那個會拿到 EPERM
  // （Windows 的 rename 蓋過正在被別人取代的檔會被拒）。實測約每 10 次並行有 1 次；單一呼叫 300 次 0 次。
  // 所以這不是測試的偶發雜訊，是 ensureSourceFont 在並行下真的會失敗。
  it('並行呼叫重複 30 回合：每一回合都成功（Windows 上 rename 同一目標會偶發 EPERM）', async () => {
    const fetchEach = vi.fn<typeof fetch>(async () => new Response(buildZip({ [ENTRY]: fakeTtf }) as BlobPart));

    for (let round = 0; round < 30; round++) {
      const dir = join(tmp, `race-${round}`);
      const [a, b] = await Promise.all([
        ensureSourceFont({ cacheDir: dir, fetch: fetchEach, source: source() }),
        ensureSourceFont({ cacheDir: dir, fetch: fetchEach, source: source() }),
      ]);
      expect(a).toBe(b);
      expect(readdirSync(dir)).toEqual([ENTRY]);
    }
  });

  it('rename 暫時被拒（EPERM）：稍後重試就成功，快取目錄只剩目標檔', async () => {
    vi.mocked(rename).mockRejectedValueOnce(errnoError('EPERM')).mockRejectedValueOnce(errnoError('EBUSY'));
    const fetchFake = fakeFetchOf(buildZip({ [ENTRY]: fakeTtf }));

    const path = await ensureSourceFont({ cacheDir, fetch: fetchFake, source: source() });

    expect(vi.mocked(rename)).toHaveBeenCalledTimes(3);
    expect(readdirSync(cacheDir)).toEqual([ENTRY]);
    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(fakeTtf))).toBe(true);
  });

  it('rename 被拒、但並行的另一個呼叫已把驗證過的目標放好：視為成功，不重試也不丟錯', async () => {
    const fetchFake = fakeFetchOf(buildZip({ [ENTRY]: fakeTtf }));
    vi.mocked(rename).mockImplementationOnce(async () => {
      // 這一刻另一個呼叫剛好把目標換好了
      writeFileSync(join(cacheDir, ENTRY), fakeTtf);
      throw errnoError('EPERM');
    });

    const path = await ensureSourceFont({ cacheDir, fetch: fetchFake, source: source() });

    expect(vi.mocked(rename)).toHaveBeenCalledTimes(1);
    expect(readdirSync(cacheDir)).toEqual([ENTRY]);
    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(fakeTtf))).toBe(true);
  });

  it('rename 一直被拒、目標也不存在：重試有上限，最後丟出原本的 EPERM，暫存檔不殘留', async () => {
    vi.mocked(rename).mockRejectedValue(errnoError('EPERM'));
    const fetchFake = fakeFetchOf(buildZip({ [ENTRY]: fakeTtf }));

    await expect(ensureSourceFont({ cacheDir, fetch: fetchFake, source: source() })).rejects.toMatchObject({ code: 'EPERM' });
    expect(vi.mocked(rename).mock.calls.length).toBeGreaterThan(1);
    expect(vi.mocked(rename).mock.calls.length).toBeLessThanOrEqual(8);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it('EPERM 以外的 rename 錯誤不重試，直接丟出', async () => {
    vi.mocked(rename).mockRejectedValueOnce(errnoError('ENOSPC'));
    const fetchFake = fakeFetchOf(buildZip({ [ENTRY]: fakeTtf }));

    await expect(ensureSourceFont({ cacheDir, fetch: fetchFake, source: source() })).rejects.toMatchObject({ code: 'ENOSPC' });

    expect(vi.mocked(rename)).toHaveBeenCalledTimes(1);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it('zip 內缺目標檔時丟出含 entry 名稱的錯誤', async () => {
    const fetchFake = fakeFetchOf(buildZip({ 'TW-Kai-Plus.ttf': enc.encode('x') }));

    await expect(ensureSourceFont({ cacheDir, fetch: fetchFake, source: source() })).rejects.toThrow(/TW-Kai\.ttf/);

    expect(readdirSync(cacheDir)).toEqual([]);
  });
});

describe('OFL-TW-Kai.txt', () => {
  const path = new URL('../../src/assets/fonts/OFL-TW-Kai.txt', import.meta.url);

  it('存在，且含 OFL 1.1 全文標題與著作權人', () => {
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(text).toContain('Ministry of Digital Affairs');
  });

  it('檔頭註明字型名稱、版本、來源與雙授權選擇', () => {
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('TW-Kai');
    expect(text).toContain('11510.1');
    expect(text).toContain('https://data.gov.tw/dataset/5961');
    expect(text).toContain('政府資料開放授權條款');
  });

  it('授權條文完整：含 PREAMBLE 到 DISCLAIMER 結尾', () => {
    const text = readFileSync(path, 'utf8');
    for (const marker of ['PREAMBLE', 'DEFINITIONS', 'PERMISSION & CONDITIONS', 'TERMINATION', 'DISCLAIMER']) {
      expect(text).toContain(marker);
    }
    expect(text.trimEnd().endsWith('OTHER DEALINGS IN THE FONT SOFTWARE.')).toBe(true);
  });
});
