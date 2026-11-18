// 2026-11-18 依 Facebook 粉專（facebook.com/ourLucal）核對後同步到網站的資訊。
// 來源整理在 docs/fb-sync-2026-11-18.md；粉專再更新時，改這裡的期望值與該文件。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SITE } from '../../src/lib/site';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

async function decodeQr(path: string): Promise<string | undefined> {
  const { data, info } = await sharp(fileURLToPath(new URL(`../../${path}`, import.meta.url)))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
}

describe('聯絡資訊（粉專「關於」與貼文末的固定資訊）', () => {
  it('LINE 用粉專貼文寫的官方帳號', () => {
    expect(SITE.lineUrl).toBe('https://lin.ee/kUCPTbo');
    expect(SITE.lineId).toBe('@713oinxb');
  });

  it('LINE QR 圖解出來就是 SITE.lineUrl（換網址時圖要一起換）', async () => {
    expect(await decodeQr('src/assets/images/line.png')).toBe(SITE.lineUrl);
  });

  it('地址、捷運、Email、預約體驗表單', () => {
    expect(SITE.address).toBe('103 臺北市大同區伊寧街43號2樓');
    expect(SITE.transit).toBe('捷運大橋頭站 1 號出口，步行兩分鐘');
    expect(SITE.email).toBe('samartialart@gmail.com');
    expect(SITE.trialFormUrl).toBe('https://forms.gle/FHZ6zVtpS2r76y5b7');
  });

  it('頁尾顯示地址、Email 與 LINE ID', () => {
    const footer = read('src/components/Footer.astro');
    expect(footer).toContain('SITE.address');
    expect(footer).toContain('SITE.email');
    expect(footer).toContain('SITE.lineId');
    expect(footer).not.toContain('地址、電話、營業時間等業主提供後再加');
  });
});

describe('課表（粉專 2026-06-15 的常態班課表）', () => {
  it('課表頁改用新版海報，舊海報不再引用', () => {
    const page = read('src/pages/schedule.astro');
    expect(page).toContain('schedule-2026-06.jpg');
    expect(page).not.toContain('schedule.png');
  });

  it('註明 11/9 貼文公告的週日中式劍新班時段', () => {
    expect(read('src/pages/schedule.astro')).toContain('週日 16:00–17:30');
  });
});

describe('課程文案（粉專貼文）', () => {
  it('散手技擊：週日 19:30–21:00，文案已補', () => {
    const md = read('src/content/courses/sanshou.md');
    expect(md).toContain('週日 19:30–21:00');
    expect(md).toContain('needsOwnerCopy: false');
  });

  it('中式兵器：三種兵器的時段與子項說明', () => {
    const md = read('src/content/courses/chinese-weapons.md');
    for (const slot of ['週五 18:00–19:30', '週六 17:30–19:00', '週日 16:00–17:30']) expect(md).toContain(slot);
    expect(md).toContain('needsOwnerCopy: false');
    expect(md).toMatch(/name: 中國劍\r?\n\s+description: /);
    // 課程卡要維持 3D 兵器（沒有照片才顯示），照片放內文
    expect(md).toMatch(/^photos: \[\]/m);
    expect(md).toContain('](../../assets/images/sword_book_cover.jpg)');
  });

  it('兒童防身兵器：週二、週日兩個時段，小一以上，五張照片', () => {
    const md = read('src/content/courses/kids-weapons.md');
    expect(md).toContain('週二 16:30–17:30');
    expect(md).toContain('週日 10:30–12:00');
    expect(md).toContain('小學一年級以上');
    expect(md).toContain('needsOwnerCopy: false');
    expect(md.match(/- src: /g)).toHaveLength(5);
  });
});

describe('外派與機構合作、收費頁', () => {
  it('課程總覽有外派與機構合作段落', () => {
    const page = read('src/pages/courses/index.astro');
    expect(page).toContain('外派與機構合作');
    expect(page).toContain('安親班');
  });

  it('收費頁有體驗預約表單；不寫粉專沒有明訂的停課規定', () => {
    const page = read('src/pages/pricing.astro');
    expect(page).toContain('SITE.trialFormUrl');
    expect(page).not.toContain('停班停課');
  });
});
