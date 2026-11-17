import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CREST_OUTPUT, CREST_SOURCE, CREST_WIDTH, renderCrest } from '../../scripts/crest/render-crest';

// 燙金獅子館徽（Task 24）：由 logo_large.jpg（黑底米白線條）建出「透明底、金色」的 PNG，首頁開場用 <Image> 輸出 webp。
// 這裡守兩件事：轉換程式的行為（用合成圖驗，不依賴真實 logo），以及入庫的成品沒有過期、品質合格。
const root = fileURLToPath(new URL('../../', import.meta.url));

async function raw(buffer: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const pixel = (image: { data: Buffer; width: number }, x: number, y: number) => {
  const o = (y * image.width + x) * 4;
  return { r: image.data[o]!, g: image.data[o + 1]!, b: image.data[o + 2]!, a: image.data[o + 3]! };
};

/** 合成來源：純黑底，中央一塊米白方塊（模擬 logo：黑底、米白線條）。 */
async function syntheticSource(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: '#000000' } })
    .composite([{ input: { create: { width: 200, height: 120, channels: 3, background: '#f1e3c6' } }, left: 100, top: 90 }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

describe('renderCrest（轉換程式）', () => {
  it('黑底變透明、米白線條變不透明，並裁到線條的外框加一點留白', async () => {
    const out = await renderCrest({ input: await syntheticSource(), width: 120 });
    const image = await raw(out.png);
    expect(image.width).toBe(120);
    // 外框 200×120 加四周各 4% 留白（相對線條的寬）：比例接近 (200+16)/(120+16)
    expect(image.width / image.height).toBeGreaterThan(1.45);
    expect(image.width / image.height).toBeLessThan(1.75);
    expect(pixel(image, 0, 0).a, '左上角（純黑底）透明').toBe(0);
    expect(pixel(image, image.width - 1, image.height - 1).a, '右下角透明').toBe(0);
    const center = pixel(image, Math.floor(image.width / 2), Math.floor(image.height / 2));
    expect(center.a, '線條中央不透明').toBe(255);
    expect(center.r, '顏色是金（紅 > 綠 > 藍），不是原本的米白').toBeGreaterThan(center.g);
    expect(center.g).toBeGreaterThan(center.b);
    expect(center.b, '不是米白').toBeLessThan(0xc6 - 20);
  });

  it('輸出尺寸由 width 決定，高度依裁切後的比例；來源是全黑時丟出明確的錯誤', async () => {
    const out = await renderCrest({ input: await syntheticSource(), width: 60 });
    expect(out.width).toBe(60);
    expect(out.height).toBe((await raw(out.png)).height);
    const black = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#000' } }).jpeg().toBuffer();
    await expect(renderCrest({ input: black, width: 40 })).rejects.toThrow(/no bright pixels/i);
  });
});

describe('入庫的館徽成品', () => {
  const asset = readFileSync(`${root}${CREST_OUTPUT}`);

  it(`寬 ${CREST_WIDTH}、有透明通道、四個角落完全透明（黑底沒有殘留）`, async () => {
    const meta = await sharp(asset).metadata();
    expect(meta.width).toBe(CREST_WIDTH);
    expect(meta.hasAlpha).toBe(true);
    const image = await raw(asset);
    for (const [x, y] of [[0, 0], [image.width - 1, 0], [0, image.height - 1], [image.width - 1, image.height - 1]] as const) {
      expect(pixel(image, x, y).a, `角落 (${x}, ${y})`).toBe(0);
    }
  });

  it('不透明的像素占 12%–45%（線條圖，不是整塊色），而且是金色：偏暖、不泛白、不死暗', async () => {
    const image = await raw(asset);
    let opaque = 0;
    let lumaSum = 0;
    let warm = 0;
    let bright = 0;
    for (let i = 0; i < image.width * image.height; i++) {
      const o = i * 4;
      const a = image.data[o + 3]!;
      if (a < 230) continue;
      opaque++;
      const r = image.data[o]!;
      const g = image.data[o + 1]!;
      const b = image.data[o + 2]!;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumaSum += luma;
      if (r > g && g > b && b < 0.75 * r) warm++;
      if (luma > 238) bright++;
    }
    const share = opaque / (image.width * image.height);
    expect(share, '不透明像素占比').toBeGreaterThan(0.12);
    expect(share, '不透明像素占比').toBeLessThan(0.45);
    expect(warm / opaque, '偏暖（紅 > 綠 > 藍）的比例').toBeGreaterThan(0.98);
    expect(lumaSum / opaque, '平均亮度：不能暗到在黑底上看不見，也不能白到不像金').toBeGreaterThan(125);
    expect(lumaSum / opaque).toBeLessThan(215);
    expect(bright / opaque, '幾乎沒有泛白（> 238）的像素；高光留給掃光').toBeLessThan(0.03);
  });

  it('與 logo_large.jpg 重新轉出來的結果一致（來源或轉換程式改了，成品就要重建：npm run crest:build）', async () => {
    const fresh = await renderCrest({ input: readFileSync(`${root}${CREST_SOURCE}`), width: CREST_WIDTH });
    const a = await raw(asset);
    const b = await raw(fresh.png);
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    let diff = 0;
    for (let i = 0; i < a.data.length; i++) diff += Math.abs(a.data[i]! - b.data[i]!);
    expect(diff / a.data.length, '平均每個通道的差').toBeLessThan(1.5);
  });
});
