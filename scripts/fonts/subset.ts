import subsetFont from 'subset-font';
import { toCharsetText } from './charset';

/**
 * 讀 sfnt（TTF）的 cmap，回傳有對應字形（gid ≠ 0）的碼位集合。
 * 只認 Unicode 子表（platform 0；platform 3 的 encoding 1、10）的格式 4（BMP）與 12（含補充平面）。
 * 全字庫 TW-Kai 是 BMP 字面，用的是格式 4；格式 12 是為了來源字型日後換成含補充平面的版本。
 */
export function cmapCodePoints(sfnt: Uint8Array): Set<number> {
  const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const tableCount = dv.getUint16(4);
  let cmapOffset = -1;
  for (let i = 0; i < tableCount; i++) {
    const at = 12 + i * 16;
    if (String.fromCharCode(sfnt[at]!, sfnt[at + 1]!, sfnt[at + 2]!, sfnt[at + 3]!) === 'cmap') {
      cmapOffset = dv.getUint32(at + 8);
      break;
    }
  }
  if (cmapOffset < 0) throw new Error('字型沒有 cmap 表');

  const result = new Set<number>();
  let readable = 0;
  const subtableCount = dv.getUint16(cmapOffset + 2);
  for (let i = 0; i < subtableCount; i++) {
    const platform = dv.getUint16(cmapOffset + 4 + i * 8);
    const encoding = dv.getUint16(cmapOffset + 6 + i * 8);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const at = cmapOffset + dv.getUint32(cmapOffset + 8 + i * 8);
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
        for (let code = start; code <= end && code !== 0xffff; code++) {
          let glyph: number;
          if (rangeOffset === 0) {
            glyph = (code + delta) & 0xffff;
          } else {
            glyph = dv.getUint16(idRangeOffsets + s * 2 + rangeOffset + (code - start) * 2);
            if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph !== 0) result.add(code);
        }
      }
      readable++;
    } else if (format === 12) {
      const groupCount = dv.getUint32(at + 12);
      for (let g = 0; g < groupCount; g++) {
        const start = dv.getUint32(at + 16 + g * 12);
        const end = dv.getUint32(at + 20 + g * 12);
        const startGlyph = dv.getUint32(at + 24 + g * 12);
        for (let code = start; code <= end; code++) if (startGlyph + (code - start) !== 0) result.add(code);
      }
      readable++;
    }
  }
  if (readable === 0) throw new Error('字型的 cmap 沒有可讀的 Unicode 子表（格式 4 或 12）');
  return result;
}

/**
 * 把 `chars` 子集化成 woff2。
 * - 保留直排用的 `vhea`／`vmtx` 與 GSUB 的 `vert`：不開 `noLayoutClosure`，也不限制 `keepFeatures`。
 * - U+0020 固定進子集（掃描不收空白，所以呼叫端的字集不會有它）：英數之間的空白也要用 TW-Kai 渲染，不能退到後備字型。
 * - 輸入以碼位排序後再交給 harfbuzz，所以輸出與 Set 的插入順序無關、可重現。
 * - `notInFont`：要求了、但來源字型沒有字形的字（依碼位排序）；它們不會出現在子集裡。
 */
export async function buildSubset(
  sourceTtf: Uint8Array,
  chars: Set<string>,
): Promise<{ woff2: Uint8Array; notInFont: string[] }> {
  const available = cmapCodePoints(sourceTtf);
  const notInFont = [...chars].filter((ch) => !available.has(ch.codePointAt(0)!));
  notInFont.sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);

  const woff2 = await subsetFont(sourceTtf, toCharsetText(new Set([' ', ...chars])), { targetFormat: 'woff2' });
  return { woff2, notInFont };
}
