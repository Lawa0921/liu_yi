import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { commitStaged, HASH_FILE, hashMatches, sizeOf } from '../../scripts/qi/staged-output';

/**
 * 「暫存再換入」的共通紀律（形體 `.bin` 與靜態圖 `.webp` 共用）：故障注入情境都集中在這裡，用小型假檔驗。
 * 兩條產線各自只留一條整合等級的故障測試（qi-build-shapes、qi-stills），證明真的有接上。
 *
 * 讓測試能注入「清掉 .staging 失敗」（Windows 上檔案被別的程式鎖住時 rmSync 會丟 EBUSY／EPERM）。預設全部透傳。
 */
const inject = vi.hoisted(() => ({ stagingRmFails: false }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    rmSync: (path: Parameters<typeof actual.rmSync>[0], options?: Parameters<typeof actual.rmSync>[1]) => {
      if (inject.stagingRmFails && String(path).endsWith('.staging')) throw new Error('EBUSY: injected');
      return actual.rmSync(path, options);
    },
  };
});

const tmpDirs: string[] = [];
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'qi-staged-'));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

const FILES = ['a.bin', 'b.bin', 'c.bin'];
const MANIFEST = 'list.json';

/** 把一組「世代」的內容寫進暫存目錄：每個檔的內容是 `<檔名>@<世代>`，清單是世代標記。 */
const writeGeneration =
  (generation: string, files: readonly string[] = FILES) =>
  async (staging: string): Promise<void> => {
    for (const f of files) writeFileSync(join(staging, f), `${f}@${generation}`);
    writeFileSync(join(staging, MANIFEST), `manifest@${generation}`);
  };

const commit = (outDir: string, generation: string, extra: Partial<Parameters<typeof commitStaged>[0]> = {}) =>
  commitStaged({ outDir, files: FILES, manifest: MANIFEST, hash: `hash-${generation}`, ext: '.bin', build: writeGeneration(generation), warn: () => {}, ...extra });

const read = (dir: string, name: string): string => readFileSync(join(dir, name), 'utf8');
/** 目錄內容的快照（檔名 → 內容），不含 .inputs-hash。 */
const snapshot = (dir: string): Record<string, string> =>
  Object.fromEntries(readdirSync(dir).filter((f) => f !== HASH_FILE).map((f) => [f, read(dir, f)]));

describe('commitStaged：成功', () => {
  it('檔案、清單與輸入雜湊都換入 outDir，最後才寫雜湊；不留 .staging；outDir 不存在會建立', async () => {
    const outDir = join(tmp(), 'nested', 'out');

    await commit(outDir, 'g1');

    expect(snapshot(outDir)).toEqual({ 'a.bin': 'a.bin@g1', 'b.bin': 'b.bin@g1', 'c.bin': 'c.bin@g1', [MANIFEST]: 'manifest@g1' });
    expect(read(outDir, HASH_FILE).trim()).toBe('hash-g1');
    expect(existsSync(join(outDir, '.staging'))).toBe(false);
  });

  it('再換一代：全部被新世代取代', async () => {
    const outDir = tmp();
    await commit(outDir, 'g1');
    await commit(outDir, 'g2');

    expect(snapshot(outDir)).toEqual({ 'a.bin': 'a.bin@g2', 'b.bin': 'b.bin@g2', 'c.bin': 'c.bin@g2', [MANIFEST]: 'manifest@g2' });
    expect(read(outDir, HASH_FILE).trim()).toBe('hash-g2');
  });

  it('build 收到的是 outDir/.staging，換入前它已是乾淨的（上一次殘留的暫存檔不會混進來）', async () => {
    const outDir = tmp();
    mkdirSync(join(outDir, '.staging'));
    writeFileSync(join(outDir, '.staging', 'leftover.bin'), 'old');
    let seen: string[] = [];

    await commit(outDir, 'g1', {
      build: async (staging) => {
        expect(staging).toBe(join(outDir, '.staging'));
        seen = readdirSync(staging);
        await writeGeneration('g1')(staging);
      },
    });

    expect(seen).toEqual([]);
    expect(existsSync(join(outDir, 'leftover.bin'))).toBe(false);
  });
});

describe('commitStaged：殘檔', () => {
  it('outDir 裡不在 files 清單的同副檔名檔案會被清掉；其他副檔名與子資料夾不動', async () => {
    const outDir = tmp();
    await commit(outDir, 'g1');
    writeFileSync(join(outDir, 'renamed-away.bin'), 'stale');
    writeFileSync(join(outDir, 'keep.txt'), 'other kind');
    mkdirSync(join(outDir, 'sub'));

    await commit(outDir, 'g2');

    expect(readdirSync(outDir).sort()).toEqual([HASH_FILE, 'a.bin', 'b.bin', 'c.bin', 'keep.txt', MANIFEST, 'sub'].sort());
  });

  it('files 變少（形體被移除）：舊檔清掉，雜湊與清單是新的', async () => {
    const outDir = tmp();
    await commit(outDir, 'g1');

    await commit(outDir, 'g2', { files: ['a.bin'], build: writeGeneration('g2', ['a.bin']) });

    expect(snapshot(outDir)).toEqual({ 'a.bin': 'a.bin@g2', [MANIFEST]: 'manifest@g2' });
  });
});

describe('commitStaged：建置失敗（換入之前）', () => {
  it('build 丟錯：原錯誤原樣丟出；舊產物（檔案與清單）原封不動；舊雜湊已被拿掉（下一次必重建）；不留 .staging', async () => {
    const outDir = tmp();
    await commit(outDir, 'g1');
    const before = snapshot(outDir);
    const boom = new Error('boom');

    const error = await commit(outDir, 'g2', {
      build: async (staging) => {
        writeFileSync(join(staging, 'a.bin'), 'a.bin@g2'); // 前半建好、後半失敗
        throw boom;
      },
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBe(boom);
    expect(snapshot(outDir)).toEqual(before);
    expect(existsSync(join(outDir, HASH_FILE))).toBe(false);
    expect(existsSync(join(outDir, '.staging'))).toBe(false);

    await commit(outDir, 'g3');
    expect(read(outDir, 'a.bin')).toBe('a.bin@g3');
    expect(read(outDir, HASH_FILE).trim()).toBe('hash-g3');
  });

  it('build 沒把 files 或清單寫齊：換入前就丟錯（訊息帶缺的檔名），outDir 一個檔都沒動', async () => {
    const outDir = tmp();
    await commit(outDir, 'g1');
    const before = snapshot(outDir);

    await expect(commit(outDir, 'g2', { build: writeGeneration('g2', ['a.bin', 'b.bin']) })).rejects.toThrow(/c\.bin/);
    expect(snapshot(outDir)).toEqual(before);

    await expect(commit(outDir, 'g2', { build: async (staging) => writeFileSync(join(staging, 'a.bin'), 'x') })).rejects.toThrow(/b\.bin|list\.json/);
    expect(snapshot(outDir)).toEqual(before);
    expect(existsSync(join(outDir, HASH_FILE))).toBe(false);
  });
});

describe('commitStaged：換入途中失敗', () => {
  it('c.bin 的位置被資料夾佔住（rename 在任何平台都會失敗）：丟錯並帶檔名；清單與雜湊都不在，不可能被誤當完整產物；移走障礙後重建恢復', async () => {
    const outDir = tmp();
    await commit(outDir, 'g1');
    rmSync(join(outDir, 'c.bin'));
    mkdirSync(join(outDir, 'c.bin'));

    // a.bin、b.bin 會先換成新的，接著 c.bin 失敗：新舊混雜的狀態
    await expect(commit(outDir, 'g2')).rejects.toThrow(/c\.bin/);

    expect(read(outDir, 'a.bin')).toBe('a.bin@g2'); // 確實是混雜狀態
    expect(existsSync(join(outDir, MANIFEST))).toBe(false);
    expect(existsSync(join(outDir, HASH_FILE))).toBe(false);
    expect(existsSync(join(outDir, '.staging'))).toBe(false);
    // 障礙還在時再叫一次：還是不會把半套當完整
    await expect(commit(outDir, 'g2')).rejects.toThrow(/c\.bin/);
    expect(existsSync(join(outDir, MANIFEST))).toBe(false);

    rmSync(join(outDir, 'c.bin'), { recursive: true });
    await commit(outDir, 'g2');
    expect(snapshot(outDir)).toEqual({ 'a.bin': 'a.bin@g2', 'b.bin': 'b.bin@g2', 'c.bin': 'c.bin@g2', [MANIFEST]: 'manifest@g2' });
    expect(read(outDir, HASH_FILE).trim()).toBe('hash-g2');
  });
});

describe('commitStaged：清不掉 .staging（被鎖住）', () => {
  it('成功的建置照樣成功，只發警告；下一次建置會把殘留清掉', async () => {
    const outDir = tmp();
    const warn = vi.fn();
    inject.stagingRmFails = true;
    try {
      await commit(outDir, 'g1', { warn });
      expect(read(outDir, HASH_FILE).trim()).toBe('hash-g1');
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0]![0])).toContain('.staging');
    } finally {
      inject.stagingRmFails = false;
    }

    await commit(outDir, 'g2');
    expect(existsSync(join(outDir, '.staging'))).toBe(false);
  });

  it('失敗的建置丟出原本的錯誤，不被清理的錯誤蓋掉，同樣只發警告', async () => {
    const outDir = tmp();
    const warn = vi.fn();
    inject.stagingRmFails = true;
    try {
      const error = await commit(outDir, 'g1', { warn, build: async () => Promise.reject(new Error('原本的錯')) }).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect((error as Error).message).toBe('原本的錯'); // 不是 EBUSY
      expect(warn).toHaveBeenCalled();
    } finally {
      inject.stagingRmFails = false;
    }
  });
});

describe('hashMatches、sizeOf', () => {
  it('hashMatches：雜湊檔存在且（去掉結尾換行後）相符才是 true；沒有雜湊檔或不相符都是 false', async () => {
    const outDir = tmp();
    expect(hashMatches(outDir, 'x')).toBe(false); // 目錄存在、沒有雜湊檔
    expect(hashMatches(join(outDir, 'missing'), 'x')).toBe(false); // 目錄不存在
    await commit(outDir, 'g1');
    expect(hashMatches(outDir, 'hash-g1')).toBe(true);
    expect(hashMatches(outDir, 'hash-g2')).toBe(false);
  });

  it('sizeOf：檔案大小；不存在回 undefined', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'x'), '12345');
    expect(sizeOf(join(dir, 'x'))).toBe(5);
    expect(sizeOf(join(dir, 'nope'))).toBeUndefined();
  });
});
