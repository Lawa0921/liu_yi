import { expect, test, type Locator, type Page } from '@playwright/test';
import { trackTransfers } from './helpers';

// 第二版（設計文件 §15）：3D 金屬兵器。首頁改版（氣聚成人）後，兵器台、震腳、刀光、掃光都已移除；
// 3D 兵器只剩課程頁（中式兵器、防身兵器的子項）與課程總覽的兵器字牌。首頁的測試見 home.spec.ts。
// 時間相關的斷言一律用停住的假時鐘（clock.install 之後 pauseAt，再用 runFor 推進），不靠真實等待。

// 無頭瀏覽器的 WebGL 是軟體繪製，很吃 CPU：這個檔案裡的測試依序跑（不和自己平行），時限也放寬。
test.describe.configure({ mode: 'default', timeout: 90_000 });

const READY = { timeout: 30_000 };
const T0 = new Date('2026-01-01T08:00:00');
const T1 = new Date('2026-01-01T09:00:00');

/** 中式兵器課程頁的三個子項（劍、苗刀、大槍），每一個都是一個 3D 宿主。 */
const weaponRows = (page: Page) => page.locator('[data-sub-items] [data-weapon3d]');

interface Snapshot {
  width: number;
  height: number;
  covered: number;
  bright: number;
}

/** 請檢視器立刻畫一格並讀回像素（WebGL 畫布不保留緩衝，不能事後從外面讀）。 */
const snapshot = (host: Locator) =>
  host.evaluate((el) => (el as HTMLElement & { weaponDebug: { snapshot(): Snapshot } }).weaponDebug.snapshot());

const poseAngle = async (host: Locator) => Number(await host.getAttribute('data-pose-angle'));
const frames = async (host: Locator) => Number(await host.getAttribute('data-frames'));

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

/** 開中式兵器課程頁，把第一個子項捲到畫面中間，等 3D 就緒；回傳那個宿主。 */
async function openFirstRow(page: Page) {
  await page.goto('./courses/chinese-weapons/');
  const host = weaponRows(page).first();
  await host.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(host).toHaveAttribute('data-weapon3d-state', 'ready', READY);
  return host;
}

test.describe('中式兵器課程頁：拖曳與鍵盤', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // 課程頁的子項（viewer 的 single 模式）只有慣性、沒有「回正」：回正是首頁兵器台（stage 模式）才有的，
  // 那個行為已隨兵器台移除，所以這裡驗的是放手後帶著慣性再轉一段、然後停在原地。
  test('拖曳會轉動兵器，放手後帶著慣性再轉一段，然後停在原地', async ({ page }) => {
    await page.clock.install({ time: T0 });
    const host = await openFirstRow(page);
    await page.clock.pauseAt(T1);
    await page.clock.runFor(200);

    const box = (await host.boundingBox())!;
    const x = box.x + box.width * 0.4;
    const y = box.y + box.height / 2;
    const before = await poseAngle(host);
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(x + i * 20, y);
      await page.clock.runFor(16);
    }
    const dragged = await poseAngle(host);
    expect(dragged - before).toBeGreaterThan(0.8);

    await page.mouse.up();
    await page.clock.runFor(160);
    // 慣性：放手後還在往同一個方向走。
    expect(await poseAngle(host)).toBeGreaterThan(dragged);
    // 慣性衰減完就停住：再過一陣子角度不變，也沒有回到 0。
    await page.clock.runFor(8000);
    const stopped = await poseAngle(host);
    await page.clock.runFor(4000);
    expect(await poseAngle(host)).toBe(stopped);
    expect(Math.abs(stopped)).toBeGreaterThan(0.5);
  });

  test('鍵盤也能轉：聚焦畫布按左右方向鍵', async ({ page }) => {
    await page.clock.install({ time: T0 });
    const host = await openFirstRow(page);
    await page.clock.pauseAt(T1);
    await page.clock.runFor(200);

    const before = await poseAngle(host);
    await host.locator('canvas').focus();
    await page.keyboard.press('ArrowRight');
    await page.clock.runFor(32);
    expect(await poseAngle(host)).toBeGreaterThan(before + 0.2);
  });

  test('離開畫面就停止繪製', async ({ page }) => {
    await page.clock.install({ time: T0 });
    const host = await openFirstRow(page);
    await expect(host).toHaveAttribute('data-weapon3d-active', 'true');

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(host).toHaveAttribute('data-weapon3d-active', 'false');
    await page.clock.pauseAt(T1);
    await page.clock.runFor(100);
    const stopped = await frames(host);
    await page.clock.runFor(2000);
    expect(await frames(host)).toBe(stopped);
  });

  test('3D 沒有把頁面撐寬，也沒有擋住導覽', async ({ page }) => {
    await openFirstRow(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.getByRole('navigation', { name: '主要導覽' }).getByRole('link', { name: '收費' }).click();
    await expect(page).toHaveURL(/pricing\/$/);
  });
});

test.describe('WebGL 不可用', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) return null;
        return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
  });

  // 首頁沒有 WebGL 時退回靜態圖，由 home-fallback.spec.ts 驗。
  test('中式兵器課程頁顯示線稿', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./courses/chinese-weapons/');
    const items = weaponRows(page);
    await expect(items).toHaveCount(3);
    await items.first().scrollIntoViewIfNeeded();
    await expect(items.first()).toHaveAttribute('data-weapon3d-state', 'fallback');
    await expect(items.locator('svg')).toHaveCount(3);
    await expect(items.first().locator('svg')).toBeVisible();
    await expect(items.locator('canvas')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('減少動態', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('課程頁的兵器以靜態姿勢呈現：不自動轉；拖曳仍可用', async ({ page }) => {
    await page.clock.install({ time: T0 });
    const host = await openFirstRow(page);
    await page.clock.pauseAt(T1);
    await page.clock.runFor(200);

    expect((await snapshot(host)).covered).toBeGreaterThan(0.004);
    const stillFrames = await frames(host);
    const stillAngle = await poseAngle(host);
    await page.clock.runFor(3000);
    expect(await frames(host)).toBe(stillFrames);
    expect(await poseAngle(host)).toBe(stillAngle);

    // 拖曳仍可用，放手後停在放手的地方（沒有慣性、不回正）。
    const box = (await host.boundingBox())!;
    const x = box.x + box.width * 0.3;
    const y = box.y + box.height * 0.5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(x + i * 20, y);
      await page.clock.runFor(16);
    }
    await page.mouse.up();
    await page.clock.runFor(100);
    const released = await poseAngle(host);
    expect(released - stillAngle).toBeGreaterThan(0.6);
    await page.clock.runFor(4000);
    expect(await poseAngle(host)).toBe(released);
  });
});

test.describe('手機 390 寬', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('中式兵器課程頁的三個子項有 3D，不水平外溢', async ({ page }) => {
    await page.goto('./courses/chinese-weapons/');
    const items = weaponRows(page);
    await items.first().scrollIntoViewIfNeeded();
    for (const item of await items.all()) {
      await item.scrollIntoViewIfNeeded();
      await expect(item).toHaveAttribute('data-weapon3d-state', 'ready', READY);
      expect((await snapshot(item)).covered).toBeGreaterThan(0.004);
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('直向滑過子項畫布仍然是捲頁（touch-action: pan-y）', async ({ page }) => {
    const host = await openFirstRow(page);
    const canvas = host.locator('canvas');
    expect(await canvas.evaluate((el) => getComputedStyle(el).touchAction)).toBe('pan-y');
  });
});

test.describe('three 的載入時機', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // 首頁首屏的載入量（新前提是首屏載入 three）由 budget.spec.ts 驗。
  test('沒有 3D 的頁面（收費）完全不載入 three', async ({ page }) => {
    const transfers = trackTransfers(page);
    await page.goto('./pricing/');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.mouse.wheel(0, 400);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).not.toHaveAttribute('data-three', /.+/);
    const scripts = transfers.filter((item) => item.type === 'script');
    expect(Math.max(0, ...scripts.map((item) => item.bytes))).toBeLessThan(250_000);
    await expect(page.locator('[data-weapon3d]')).toHaveCount(0);
  });
});

test.describe('中式兵器課程頁', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('三個子項各有一件可轉動的 3D 兵器', async ({ page }) => {
    const errors = collectErrors(page);
    await page.clock.install({ time: T0 });
    await page.goto('./courses/chinese-weapons/');
    const items = weaponRows(page);
    await expect(items).toHaveCount(3);
    await items.first().scrollIntoViewIfNeeded();
    await expect(items.nth(0)).toHaveAttribute('data-weapon-kind', 'jian');
    await expect(items.nth(1)).toHaveAttribute('data-weapon-kind', 'miaodao');
    await expect(items.nth(2)).toHaveAttribute('data-weapon-kind', 'spear');
    for (const item of await items.all()) {
      await item.scrollIntoViewIfNeeded();
      await expect(item).toHaveAttribute('data-weapon3d-state', 'ready', READY);
    }
    await page.clock.pauseAt(T1);
    await page.clock.runFor(200);

    for (const item of await items.all()) {
      // 一列一件，三列比視窗高：先把這一列捲到畫面中間再拖。
      await item.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.clock.runFor(100);
      const shot = await snapshot(item);
      expect(shot.covered).toBeGreaterThan(0.004);
      expect(shot.bright).toBeGreaterThan(0.0004);

      const box = (await item.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const before = await poseAngle(item);
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) {
        await page.mouse.move(x + i * 15, y);
        await page.clock.runFor(16);
      }
      await page.mouse.up();
      expect((await poseAngle(item)) - before).toBeGreaterThan(0.5);
    }
    expect(errors).toEqual([]);
  });

  test('會自己緩緩擺動（光帶跟著流動）', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./courses/chinese-weapons/');
    const item = weaponRows(page).first();
    await item.scrollIntoViewIfNeeded();
    await expect(item).toHaveAttribute('data-weapon3d-state', 'ready', READY);
    await page.clock.pauseAt(T1);
    await page.clock.runFor(200);
    const spin = async () => Number(await item.getAttribute('data-pose-spin'));
    const before = await spin();
    await page.clock.runFor(1500);
    expect(Math.abs((await spin()) - before)).toBeGreaterThan(0.2);
    // 擺動不是使用者轉的：拖曳的角度沒有變。
    expect(await poseAngle(item)).toBe(0);
  });

  test('其他課程頁沒有 3D，也不載入 three', async ({ page }) => {
    await page.goto('./courses/bajiquan/');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-weapon3d]')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-three', /.+/);
  });
});

test.describe('課程總覽大人「中式兵器」卡片', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('卡片上是 3D 兵器；整張卡仍是連到課程頁的連結', async ({ page }) => {
    await page.goto('./courses/');
    const card = page.locator('[data-audience-panel="adult"] .course-card').filter({ hasText: '中式兵器' });
    await card.scrollIntoViewIfNeeded();
    const plate = card.locator('[data-weapon3d="card"]');
    await expect(plate).toHaveAttribute('data-weapon3d-state', 'ready', READY);
    const shot = await snapshot(plate);
    expect(shot.covered).toBeGreaterThan(0.01);
    expect(shot.bright).toBeGreaterThan(0.0004);

    // 畫布不攔截點擊：點卡片中央會進課程頁。
    const box = (await plate.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('中式兵器');
  });
});

test.describe('沒有 JavaScript', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });

  // 首頁沒有 JS 的版本由 home-fallback.spec.ts 驗。
  test('課程頁的兵器顯示線稿', async ({ page }) => {
    await page.goto('./courses/chinese-weapons/');
    await expect(page.locator('[data-sub-items] svg')).toHaveCount(3);
    await expect(page.locator('[data-sub-items] svg').first()).toBeVisible();
  });
});

// ── 第三輪：構圖 ─────────────────────────────────────────────────────

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type DebugHost = HTMLElement & {
  weaponDebug: {
    bounds(): Box;
  };
};

const rectOf = (locator: Locator) =>
  locator.evaluate((el) => {
    const { left, top, right, bottom } = el.getBoundingClientRect();
    return { left, top, right, bottom };
  });

/** 兩個矩形重疊的面積（px²）。 */
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

for (const device of [
  { name: '桌機 1440', use: { viewport: { width: 1440, height: 900 } } },
  { name: '桌機 1280', use: { viewport: { width: 1280, height: 720 } } },
  { name: '手機 390', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
]) {
  test.describe(`構圖：${device.name}`, () => {
    test.use(device.use);

    test('課程頁：每一列完整裝下兵器，名稱不被壓到', async ({ page }) => {
      await page.goto('./courses/chinese-weapons/');
      const rows = page.locator('[data-sub-items] > li');
      await expect(rows).toHaveCount(3);
      for (const row of await rows.all()) {
        const host = row.locator('[data-weapon3d]');
        await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await expect(host).toHaveAttribute('data-weapon3d-state', 'ready', READY);
        const kind = await host.getAttribute('data-weapon-kind');
        const frame = await rectOf(host);
        const name = await rectOf(row.locator('h3'));
        const bounds = await host.evaluate((el) => (el as DebugHost).weaponDebug.bounds());

        // 名稱和兵器的畫布各佔一塊，不重疊。
        expect(overlap(frame, name), `${kind} 的畫布壓到名稱`).toBe(0);
        expect(bounds.top, `${kind} 上緣`).toBeGreaterThanOrEqual(frame.top - 1);
        expect(bounds.bottom, `${kind} 下緣`).toBeLessThanOrEqual(frame.bottom + 1);
        expect(bounds.right, `${kind} 右緣`).toBeLessThanOrEqual(frame.right + 1);
        // 大槍三公尺長，桿從左緣出去；劍與苗刀要整件在裡面。
        if (kind !== 'spear') expect(bounds.left, `${kind} 左緣`).toBeGreaterThanOrEqual(frame.left - 1);
      }
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  });
}
