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
  /** 只有 REQUEST_CAP_EXCEPTIONS 裡的素材可以有：放寬的生圖上限與核准理由。 */
  requestCapException?: { cap: number; reason: string };
  /** 預覽佔位（status = placeholder）為什麼先上線、之後怎麼處理。 */
  placeholderReason?: string;
}
const provenance = JSON.parse(readFileSync(file('provenance.json'), 'utf8')) as Record<string, ProvenanceEntry>;

// 升格流程（Task 6–7）會把名稱從 PLANNED 移到 READY，所以這裡只釘不變量，不釘清單的確切內容。
const BASELINE_READY = ['fig-zhenjiao', 'fig-zhenjiao-land', 'fig-dingzhou', 'fig-chengchui', 'fig-kao'];

/**
 * 生圖上限的例外（其餘素材一律 ≤ 3 次）：散手兩式 Codex 視覺評審兩輪未過，使用者 2026-11-20 核准放寬到 5 次。
 * provenance 的 `requestCapException` 要寫明同樣的上限與理由；不在這張表的素材不可以有這個欄位。
 */
const REQUEST_CAP_EXCEPTIONS: Record<string, number> = { 'fig-guard': 5, 'fig-jab': 5 };

/** 預覽佔位：可以先接進首頁讓使用者看，但狀態必須是 placeholder（待重生），不能冒充 approved。 */
const PLACEHOLDERS = ['fig-jab'];

describe('剪影清單（src/qi/config/silhouettes.ts）', () => {
  it('已核可清單不為空，且包含最初的五張', () => {
    expect(SILHOUETTES_READY.length).toBeGreaterThan(0);
    expect(SILHOUETTES_READY).toEqual(expect.arrayContaining(BASELINE_READY));
  });

  it('兩份清單各自沒有重複名稱，也沒有彼此重疊', () => {
    expect(new Set(SILHOUETTES_READY).size).toBe(SILHOUETTES_READY.length);
    expect(new Set(SILHOUETTES_PLANNED).size).toBe(SILHOUETTES_PLANNED.length);
    expect(SILHOUETTES_READY.filter((name) => SILHOUETTES_PLANNED.includes(name))).toEqual([]);
  });

  it('已核可的每個名稱都有 provenance 紀錄', () => {
    expect(SILHOUETTES_READY.filter((name) => provenance[name] === undefined)).toEqual([]);
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

  it.each(['png', 'webp'])('.%s 解成 RGBA 後通過機械品管（size／edge／stray／haze／area）', async (ext) => {
    // 出貨的兩種格式都要過閘門：首頁實際載入的是 .webp，不能只驗 .png
    const { data, info } = await sharp(file(`${name}.${ext}`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    const result = checkSilhouette(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('邊緣有半透明的柔邊（8 < alpha < 247 的像素 ≥ 1 000 個，不是只有 0／255 兩個值），與同批剪影一致', async () => {
    const { data } = await sharp(file(`${name}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let soft = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 8 && data[i]! < 247) soft++;
    expect(soft, `${name} 的柔邊像素數`).toBeGreaterThanOrEqual(1000);
  });

  it('provenance.json 有來源紀錄：請求數 ≤ 3（核准過的例外 ≤ 其上限）、狀態為 approved 或 legacy（預覽佔位為 placeholder）', () => {
    const entry = provenance[name];
    expect(entry, `provenance.json 缺 ${name}`).toBeDefined();
    expect(Number.isInteger(entry!.requests)).toBe(true);
    expect(entry!.requests).toBeGreaterThanOrEqual(1);
    const cap = REQUEST_CAP_EXCEPTIONS[name];
    if (cap === undefined) {
      expect(entry!.requestCapException, `${name} 不在上限例外名單`).toBeUndefined();
      expect(entry!.requests).toBeLessThanOrEqual(3);
    } else {
      expect(entry!.requestCapException?.cap).toBe(cap);
      expect(entry!.requests).toBeLessThanOrEqual(cap);
      expect(entry!.requests).toBeLessThanOrEqual(cap);
    }
    expect(PLACEHOLDERS.includes(name) ? ['placeholder'] : ['approved', 'legacy']).toContain(entry!.status);
    if (entry!.status === 'placeholder') expect(entry!.placeholderReason, `${name} 是佔位就要寫明理由`).toMatch(/使用者.*(核准|決定)/);
    expect(entry!.model).toMatch(/^gpt-image-/);
    expect(entry!.promptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry!.rawSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof entry!.qa).toBe('object');
  });
});

describe('生圖上限的例外', () => {
  const withException = Object.entries(provenance).filter(([, entry]) => entry.requestCapException !== undefined);

  it('provenance 裡帶 requestCapException 的條目恰為例外名單（不限 SILHOUETTES_READY）', () => {
    expect(withException.map(([name]) => name).sort()).toEqual(Object.keys(REQUEST_CAP_EXCEPTIONS).sort());
  });

  it.each(withException)('%s：上限與名單一致、≤ 5，理由寫明日期、「使用者」與「核准」或「決定」', (name, entry) => {
    expect(entry.requestCapException!.cap).toBe(REQUEST_CAP_EXCEPTIONS[name]);
    expect(entry.requestCapException!.cap).toBeLessThanOrEqual(5);
    expect(entry.requests).toBeLessThanOrEqual(entry.requestCapException!.cap);
    const reason = entry.requestCapException!.reason;
    expect(reason).toMatch(/2026-11-20/);
    expect(reason).toMatch(/使用者/);
    expect(reason).toMatch(/核准|決定/);
  });

  it('生圖腳本的 prompts.json：只有例外名單裡的素材可以帶 request_cap（≤ 5，且有 request_cap_reason）', () => {
    const table = JSON.parse(readFileSync(fileURLToPath(new URL('../../tools/silhouettes/prompts.json', import.meta.url)), 'utf8')) as {
      assets: Record<string, { request_cap?: unknown; request_cap_reason?: unknown }>;
    };
    const capped = Object.entries(table.assets).filter(([, a]) => a.request_cap !== undefined);
    expect(capped.map(([name]) => name).sort()).toEqual(Object.keys(REQUEST_CAP_EXCEPTIONS).sort());
    for (const [name, a] of capped) {
      expect(a.request_cap, name).toBe(REQUEST_CAP_EXCEPTIONS[name]);
      expect(String(a.request_cap_reason ?? '').trim(), name).not.toBe('');
    }
  });
});

describe('src/assets/silhouettes/ 資料夾', () => {
  it('沒有檔名含 rejected／tmp／-v1 的退件或暫存檔', () => {
    const bad = readdirSync(file('.')).filter((f) => /rejected|tmp|-v1/i.test(f));
    expect(bad).toEqual([]);
  });
});
