import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { checkSilhouette } from '../../scripts/qi/silhouette-qa';
import { SILHOUETTES_PLANNED, SILHOUETTES_READY } from '../../src/qi/config/silhouettes';

// 真實素材的機械品管閘門：已核可的每張剪影都要過 checkSilhouette，來源紀錄齊全，且資料夾裡沒有退件或暫存檔。
const DIR = new URL('../../src/assets/silhouettes/', import.meta.url);
const file = (name: string) => fileURLToPath(new URL(name, DIR));

interface ProvenanceEntry {
  model: string;
  promptSha256: string;
  rawSha256: string;
  requests: number;
  status: string;
  qa: Record<string, unknown>;
  date: string;
}
const provenance = JSON.parse(readFileSync(file('provenance.json'), 'utf8')) as Record<string, ProvenanceEntry>;

describe('剪影清單（src/qi/config/silhouettes.ts）', () => {
  it('已核可與待生成清單照決定表 D8 與簡報', () => {
    expect(SILHOUETTES_READY).toEqual(['fig-zhenjiao', 'fig-zhenjiao-land', 'fig-dingzhou', 'fig-chengchui', 'fig-kao']);
    expect(SILHOUETTES_PLANNED).toEqual(['fig-salute', 'fig-kid-wushu', 'fig-kid-defense-a', 'fig-kid-defense-b', 'fig-kid-weapon']);
  });

  it('兩份清單沒有重複名稱、也沒有彼此重疊', () => {
    const all = [...SILHOUETTES_READY, ...SILHOUETTES_PLANNED];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe.each(SILHOUETTES_READY)('已核可剪影 %s', (name) => {
  it('.png 與 .webp 都存在，.webp ≤ 120 000 B 且帶 alpha', async () => {
    expect(existsSync(file(`${name}.png`)), `${name}.png`).toBe(true);
    expect(existsSync(file(`${name}.webp`)), `${name}.webp`).toBe(true);
    expect(statSync(file(`${name}.webp`)).size).toBeLessThanOrEqual(120_000);
    const meta = await sharp(file(`${name}.webp`)).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.hasAlpha).toBe(true);
  });

  it('解成 RGBA 後通過機械品管（size／edge／stray／haze／area）', async () => {
    const { data, info } = await sharp(file(`${name}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    const result = checkSilhouette(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('provenance.json 有來源紀錄：請求數 ≤ 3、狀態為 approved 或 legacy', () => {
    const entry = provenance[name];
    expect(entry, `provenance.json 缺 ${name}`).toBeDefined();
    expect(Number.isInteger(entry!.requests)).toBe(true);
    expect(entry!.requests).toBeGreaterThanOrEqual(1);
    expect(entry!.requests).toBeLessThanOrEqual(3);
    expect(['approved', 'legacy']).toContain(entry!.status);
    expect(entry!.model).toMatch(/^gpt-image-/);
    expect(entry!.promptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry!.rawSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof entry!.qa).toBe('object');
  });
});

describe('src/assets/silhouettes/ 資料夾', () => {
  it('沒有檔名含 rejected／tmp／-v1 的退件或暫存檔', () => {
    const bad = readdirSync(file('.')).filter((f) => /rejected|tmp|-v1/i.test(f));
    expect(bad).toEqual([]);
  });
});
