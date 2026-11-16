import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import wawoff2 from 'wawoff2';
import { buildSubset, cmapCodePoints } from '../../scripts/fonts/subset';

// 原檔約 37 MB、不進 git；由 `npm run fonts:subset`（ensureSourceFont）下載到 .cache/fonts/。
// 沒有快取時整組跳過，不是失敗；確認輸出 skipped 0 才算驗證過。
const TTF_URL = new URL('../../.cache/fonts/TW-Kai.ttf', import.meta.url);
const hasTtf = existsSync(TTF_URL);

const WANTED = '六藝武術・｜·A1';

/** 測試自帶的最小 sfnt 讀取器（刻意不用產品碼的解析器，才能獨立驗證產物）。 */
function readTables(sfnt: Uint8Array): Map<string, { offset: number; length: number }> {
  const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const count = dv.getUint16(4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(...sfnt.subarray(at, at + 4));
    tables.set(tag, { offset: dv.getUint32(at + 8), length: dv.getUint32(at + 12) });
  }
  return tables;
}

/** 所有 Unicode cmap 子表（格式 4、12）有對應字形（gid ≠ 0）的碼位聯集。 */
function cmapCodepoints(sfnt: Uint8Array): Set<number> {
  const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const cmap = readTables(sfnt).get('cmap');
  if (!cmap) throw new Error('沒有 cmap');
  const result = new Set<number>();
  const subtables = dv.getUint16(cmap.offset + 2);
  for (let i = 0; i < subtables; i++) {
    const platform = dv.getUint16(cmap.offset + 4 + i * 8);
    const encoding = dv.getUint16(cmap.offset + 6 + i * 8);
    const isUnicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!isUnicode) continue;
    const at = cmap.offset + dv.getUint32(cmap.offset + 8 + i * 8);
    const format = dv.getUint16(at);
    if (format === 4) {
      const segCount = dv.getUint16(at + 6) / 2;
      const endCodes = at + 14;
      const startCodes = endCodes + segCount * 2 + 2;
      const idDeltas = startCodes + segCount * 2;
      const idRangeOffsets = idDeltas + segCount * 2;
      for (let s = 0; s < segCount; s++) {
        const end = dv.getUint16(endCodes + s * 2);
        const start = dv.getUint16(startCodes + s * 2);
        const delta = dv.getUint16(idDeltas + s * 2);
        const rangeOffset = dv.getUint16(idRangeOffsets + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let gid: number;
          if (rangeOffset === 0) {
            gid = (c + delta) & 0xffff;
          } else {
            gid = dv.getUint16(idRangeOffsets + s * 2 + rangeOffset + (c - start) * 2);
            if (gid !== 0) gid = (gid + delta) & 0xffff;
          }
          if (gid !== 0) result.add(c);
        }
      }
    } else if (format === 12) {
      const groups = dv.getUint32(at + 12);
      for (let g = 0; g < groups; g++) {
        const start = dv.getUint32(at + 16 + g * 12);
        const end = dv.getUint32(at + 20 + g * 12);
        const startGid = dv.getUint32(at + 24 + g * 12);
        for (let c = start; c <= end; c++) if (startGid + (c - start) !== 0) result.add(c);
      }
    } else {
      throw new Error(`測試不支援的 cmap 格式 ${format}`);
    }
  }
  return result;
}

/** GSUB 的 FeatureList 內所有 feature tag。 */
function gsubFeatureTags(sfnt: Uint8Array): string[] {
  const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const gsub = readTables(sfnt).get('GSUB');
  if (!gsub) return [];
  const list = gsub.offset + dv.getUint16(gsub.offset + 6);
  const count = dv.getUint16(list);
  const tags: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = list + 2 + i * 6;
    tags.push(String.fromCharCode(...sfnt.subarray(at, at + 4)));
  }
  return tags;
}

/** wawoff2 回傳的是 wasm 記憶體上的視圖，下一次呼叫就可能被蓋掉或脫離，所以先複製。 */
async function inflate(woff2: Uint8Array): Promise<Uint8Array> {
  return Uint8Array.from(await wawoff2.decompress(woff2));
}

const codepoints = (text: string) => new Set([...text].map((ch) => ch.codePointAt(0)!));

describe.skipIf(!hasTtf)('buildSubset（以 .cache/fonts/TW-Kai.ttf 為來源）', () => {
  let ttf: Uint8Array;
  let result: Awaited<ReturnType<typeof buildSubset>>;
  let sfnt: Uint8Array;

  beforeAll(async () => {
    ttf = readFileSync(TTF_URL);
    result = await buildSubset(ttf, new Set([...WANTED]));
    sfnt = await inflate(result.woff2);
  }, 60_000);

  it('產出是 woff2，解壓後是 TrueType sfnt，且含直排需要的表', () => {
    expect(String.fromCharCode(...result.woff2.subarray(0, 4))).toBe('wOF2');
    expect(new DataView(sfnt.buffer, sfnt.byteOffset).getUint32(0)).toBe(0x00010000);
    const tables = readTables(sfnt);
    for (const tag of ['cmap', 'glyf', 'vhea', 'vmtx']) expect(tables.has(tag), tag).toBe(true);
  });

  it('保留直排字形替換 vert（不開 noLayoutClosure）：要求的字裡有直排會換字形的標點時，GSUB 仍帶 vert', async () => {
    // vert 只替換標點（「」、。，）…）；六藝武術・｜·A1 都沒有直排變體，子集裡 GSUB 會是空的，所以這裡另外要求標點。
    const withPunctuation = await buildSubset(ttf, new Set([...`${WANTED}「」、。，（）`]));
    const punctuationSfnt = await inflate(withPunctuation.woff2);
    expect(gsubFeatureTags(punctuationSfnt)).toContain('vert');
    expect(cmapCodepoints(punctuationSfnt)).toEqual(codepoints(`${WANTED}「」、。，（）`));
  });

  it('cmap 恰含請求的字，不多不少', () => {
    expect(cmapCodepoints(sfnt)).toEqual(codepoints(WANTED));
    // 產品碼的 cmap 讀取器（用來算 notInFont）與測試自己的實作對同一份產物讀出相同結果
    expect(cmapCodePoints(sfnt)).toEqual(codepoints(WANTED));
  });

  it('請求的字都在字型內時 notInFont 為空', () => {
    expect(result.notInFont).toEqual([]);
  });

  it('輸出 ≤ 40 KB', () => {
    expect(result.woff2.byteLength).toBeLessThanOrEqual(40 * 1024);
  });

  it('notInFont 回字型沒有的字，且不會出現在 cmap；其餘字照常收進子集', async () => {
    const mixed = await buildSubset(ttf, new Set(['六', '\u{1F600}']));
    expect(mixed.notInFont).toEqual(['\u{1F600}']);
    const mixedSfnt = await inflate(mixed.woff2);
    expect(cmapCodepoints(mixedSfnt)).toEqual(codepoints('六'));
  });

  it('notInFont 依碼位排序、與輸入順序無關', async () => {
    const out = await buildSubset(ttf, new Set(['\u{1F680}', 'A', '\u{1F600}']));
    expect(out.notInFont).toEqual(['\u{1F600}', '\u{1F680}']);
  });

  it('決定性：同輸入兩次輸出逐位元相同，與 Set 的插入順序無關', async () => {
    const again = await buildSubset(ttf, new Set([...WANTED]));
    const reversed = await buildSubset(ttf, new Set([...WANTED].reverse()));
    expect(Buffer.from(again.woff2).equals(Buffer.from(result.woff2))).toBe(true);
    expect(Buffer.from(reversed.woff2).equals(Buffer.from(result.woff2))).toBe(true);
  });

  it('不會改動傳入的 TTF 位元組', async () => {
    const copy = new Uint8Array(1024);
    copy.set(ttf.subarray(0, 1024));
    await buildSubset(ttf, new Set(['六']));
    expect(Buffer.from(ttf.subarray(0, 1024)).equals(Buffer.from(copy))).toBe(true);
  });
});
