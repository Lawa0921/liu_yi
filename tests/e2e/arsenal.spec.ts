import { expect, test, type Locator, type Page } from '@playwright/test';

// 第二版（設計文件 §15）：3D 金屬兵器與特殊互動。
// 時間相關的斷言一律用停住的假時鐘（clock.install 之後 pauseAt，再用 runFor 推進），不靠真實等待。

// 無頭瀏覽器的 WebGL 是軟體繪製，很吃 CPU：這個檔案裡的測試依序跑（不和自己平行），時限也放寬。
test.describe.configure({ mode: 'default', timeout: 90_000 });

const READY = { timeout: 30_000 };
const T0 = new Date('2026-01-01T08:00:00');
const T1 = new Date('2026-01-01T09:00:00');

const stage = (page: Page) => page.locator('[data-act="weapon"] [data-weapon3d="stage"]');
const weaponAct = (page: Page) => page.locator('[data-act="weapon"]');

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

/** 捲到「兵器」那一幕（桌機是釘選區的中段），等 3D 就緒。 */
async function reachStage(page: Page, into = 0.45) {
  await expect(page.locator('html')).toHaveAttribute('data-acts', /pinned|static/);
  await page.evaluate((fraction) => {
    const act = document.querySelector<HTMLElement>('[data-act="weapon"]')!;
    const spacer = act.closest<HTMLElement>('.pin-spacer');
    const box = (spacer ?? act).getBoundingClientRect();
    const top = box.top + window.scrollY;
    // 釘選：捲進釘選距離的 fraction；不釘選：讓幕落在視窗中間。
    const y = spacer ? top + (box.height - act.offsetHeight) * fraction : top - (window.innerHeight - box.height) / 2;
    window.scrollTo(0, Math.max(1, y));
  }, into);
  await expect(stage(page)).toHaveAttribute('data-weapon3d-state', 'ready', READY);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

/** 記錄每個回應的大小（靜態伺服器不壓縮，所以這是保守的上限）。 */
function trackTransfers(page: Page) {
  const transfers: { url: string; type: string; bytes: number }[] = [];
  page.on('response', async (response) => {
    try {
      const body = await response.body();
      transfers.push({ url: response.url(), type: response.request().resourceType(), bytes: body.length });
    } catch {
      // 導覽中斷的請求沒有內容，略過。
    }
  });
  return transfers;
}

const totalBytes = (transfers: { bytes: number }[]) => transfers.reduce((sum, item) => sum + item.bytes, 0);

test.describe('兵器台：桌機', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('捲到「兵器」那一幕會出現 3D 畫布，而且畫面不是空白', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await reachStage(page);

    const canvas = stage(page).locator('canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute('aria-label', /中國劍/);

    const shot = await snapshot(stage(page));
    expect(shot.width).toBeGreaterThan(800);
    // 兵器是細長的：佔畫面的比例不大，但一定有畫到東西，而且有金屬反光的亮部。
    expect(shot.covered).toBeGreaterThan(0.004);
    expect(shot.bright).toBeGreaterThan(0.0004);

    // 線稿退場，操作列出現。
    await expect(weaponAct(page).locator('.act__weapon').first()).toBeHidden();
    await expect(page.getByRole('button', { name: '苗刀' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('劍｜苗刀｜大槍可切換：舊的先收走，新的入場', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await reachStage(page);
    await page.clock.pauseAt(T1);

    const host = stage(page);
    const jian = page.getByRole('button', { name: '劍', exact: true });
    const miaodao = page.getByRole('button', { name: '苗刀' });
    const spear = page.getByRole('button', { name: '大槍' });
    await expect(host).toHaveAttribute('data-weapon-kind', 'jian');
    await expect(jian).toHaveAttribute('aria-pressed', 'true');

    await miaodao.click();
    await expect(miaodao).toHaveAttribute('aria-pressed', 'true');
    await expect(jian).toHaveAttribute('aria-pressed', 'false');
    // 剛按下去時畫面上還是劍（正在收走）。
    await page.clock.runFor(120);
    await expect(host).toHaveAttribute('data-weapon-kind', 'jian');
    await page.clock.runFor(2500);
    await expect(host).toHaveAttribute('data-weapon-kind', 'miaodao');
    await expect(host.locator('canvas')).toHaveAttribute('aria-label', /苗刀/);
    expect((await snapshot(host)).covered).toBeGreaterThan(0.004);

    await spear.click();
    await page.clock.runFor(2500);
    await expect(host).toHaveAttribute('data-weapon-kind', 'spear');
    // 大槍橫貫畫面：畫到的寬度很大。
    expect((await snapshot(host)).covered).toBeGreaterThan(0.004);
  });

  test('拖曳會轉動兵器，放手後帶著慣性再緩緩回正', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await reachStage(page);
    await page.clock.pauseAt(T1);
    await page.clock.runFor(200);

    const host = stage(page);
    const before = await poseAngle(host);
    await page.mouse.move(360, 480);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(360 + i * 20, 480);
      await page.clock.runFor(16);
    }
    const dragged = await poseAngle(host);
    expect(dragged - before).toBeGreaterThan(0.8);

    await page.mouse.up();
    await page.clock.runFor(160);
    // 慣性：放手後還在往同一個方向走。
    expect(await poseAngle(host)).toBeGreaterThan(dragged);
    // 回正。
    await page.clock.runFor(12_000);
    expect(Math.abs(await poseAngle(host))).toBeLessThan(0.05);
  });

  test('鍵盤也能轉：聚焦畫布按左右方向鍵', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await reachStage(page);
    await page.clock.pauseAt(T1);
    await page.clock.runFor(200);

    const host = stage(page);
    const before = await poseAngle(host);
    await host.locator('canvas').focus();
    await page.keyboard.press('ArrowRight');
    await page.clock.runFor(32);
    expect(await poseAngle(host)).toBeGreaterThan(before + 0.2);
  });

  test('捲動推進時劍出鞘、轉身', async ({ page }) => {
    await page.goto('./');
    await reachStage(page, 0.02);
    const host = stage(page);
    await expect.poll(async () => Number(await host.getAttribute('data-pose-sheath'))).toBeLessThan(0.2);
    const spinAtStart = Number(await host.getAttribute('data-pose-spin'));

    await reachStage(page, 0.9);
    await expect.poll(async () => Number(await host.getAttribute('data-pose-sheath'))).toBeGreaterThan(0.98);
    await expect.poll(async () => Number(await host.getAttribute('data-pose-spin')) - spinAtStart).toBeGreaterThan(2.5);
  });

  test('離開畫面就停止繪製', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await reachStage(page);
    const host = stage(page);
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
    await page.goto('./');
    await reachStage(page);
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

  test('首頁顯示線稿，不載入 three，頁面不報錯', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('data-acts', /pinned|static/);
    await weaponAct(page).scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 900);

    await expect(weaponAct(page)).toHaveAttribute('data-weapon3d-state', 'fallback');
    await expect(weaponAct(page).locator('canvas')).toHaveCount(0);
    await expect(weaponAct(page).locator('.act__weapon')).toHaveCount(3);
    await expect(weaponAct(page).locator('.act__weapon').first()).toBeVisible();
    // 只有 3D 才用得到的切換列不出現。
    await expect(page.getByRole('button', { name: '苗刀' })).toBeHidden();
    await expect(page.locator('html')).not.toHaveAttribute('data-three', /.+/);
    await expect(page.locator('.acts a[href$="courses/chinese-weapons/"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('中式兵器課程頁顯示線稿', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./courses/chinese-weapons/');
    const items = page.locator('[data-sub-items] [data-weapon3d]');
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

  test('兵器以靜態姿勢呈現：不自動轉；拖曳仍可用', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await reachStage(page);
    await page.clock.pauseAt(T1);
    await page.clock.runFor(200);

    const host = stage(page);
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

  test('不出刀光', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await page.clock.pauseAt(T1);
    await page.mouse.move(200, 300);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(200 + i * 90, 300 + i * 30);
      await page.clock.runFor(16);
    }
    await page.mouse.up();
    await expect(page.locator('[data-slash]')).not.toHaveAttribute('data-slash-points', /[1-9]/);
  });

  test('不震：震腳的按鈕不出現', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('data-acts', 'static');
    await page.locator('[data-act="fist"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-stomp]')).toBeHidden();
    await expect(page.locator('[data-act="fist"]')).not.toHaveAttribute('data-stomping', /.+/);
  });
});

test.describe('手機 390 寬', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('首頁的兵器台有 3D，不水平外溢', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await reachStage(page);
    const host = stage(page);
    const shot = await snapshot(host);
    expect(shot.covered).toBeGreaterThan(0.004);
    expect(shot.bright).toBeGreaterThan(0.0004);
    // 手機降規格：像素比有上限（畫布的像素寬不超過 CSS 寬的 1.5 倍）。
    const cssWidth = (await host.boundingBox())!.width;
    expect(shot.width).toBeLessThanOrEqual(Math.ceil(cssWidth * 1.5) + 1);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expect(page.locator('[data-nav-toggle]')).toBeInViewport({ ratio: 1 });
    // 三個切換鈕都在畫面內點得到。
    await page.getByRole('button', { name: '大槍' }).click();
    await expect(page.getByRole('button', { name: '大槍' })).toHaveAttribute('aria-pressed', 'true');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test('中式兵器課程頁的三個子項有 3D，不水平外溢', async ({ page }) => {
    await page.goto('./courses/chinese-weapons/');
    const items = page.locator('[data-sub-items] [data-weapon3d]');
    await items.first().scrollIntoViewIfNeeded();
    for (const item of await items.all()) {
      await item.scrollIntoViewIfNeeded();
      await expect(item).toHaveAttribute('data-weapon3d-state', 'ready', READY);
      expect((await snapshot(item)).covered).toBeGreaterThan(0.004);
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('直向滑過兵器台仍然是捲頁', async ({ page }) => {
    await page.goto('./');
    await reachStage(page);
    const canvas = stage(page).locator('canvas');
    expect(await canvas.evaluate((el) => getComputedStyle(el).touchAction)).toBe('pan-y');
  });
});

test.describe('three 的載入時機', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('首頁首屏不載入 three；首屏 ≤ 1.5 MB、整頁捲完 ≤ 5 MB', async ({ page }) => {
    const transfers = trackTransfers(page);
    await page.goto('./');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('data-acts', /pinned|static/);

    await expect(page.locator('html')).not.toHaveAttribute('data-three', /.+/);
    const firstScreen = [...transfers];
    const firstScripts = firstScreen.filter((item) => item.type === 'script');
    // three 是唯一一支好幾百 KB 的腳本。
    expect(Math.max(...firstScripts.map((item) => item.bytes))).toBeLessThan(250_000);
    expect(totalBytes(firstScreen)).toBeLessThanOrEqual(1.5 * 1024 * 1024);

    // 往下捲：接近兵器台才載。
    await reachStage(page);
    await expect(page.locator('html')).toHaveAttribute('data-three', 'loaded', READY);
    const three = transfers.filter((item) => item.type === 'script' && item.bytes > 250_000);
    expect(three.length).toBeGreaterThanOrEqual(1);
    expect(firstScreen.some((item) => three.some((chunk) => chunk.url === item.url))).toBe(false);

    // 一路捲到底。
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= height; y += 700) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForLoadState('networkidle');
    }
    expect(totalBytes(transfers)).toBeLessThanOrEqual(5 * 1024 * 1024);
  });

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
    const items = page.locator('[data-sub-items] [data-weapon3d]');
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
    const item = page.locator('[data-sub-items] [data-weapon3d]').first();
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

test.describe('首頁大人「中式兵器」卡片', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('卡片上是 3D 兵器；整張卡仍是連到課程頁的連結', async ({ page }) => {
    await page.goto('./');
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

test.describe('震腳', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('可用鍵盤觸發：聚焦按鈕按空白鍵，八方紋震開一圈，之後收掉', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('data-acts', 'pinned');
    const act = page.locator('[data-act="fist"]');
    await page.evaluate(() => {
      const spacer = document.querySelector('[data-act="fist"]')!.closest('.pin-spacer')!;
      window.scrollTo(0, spacer.getBoundingClientRect().top + window.scrollY + 500);
    });
    const button = page.locator('[data-stomp]');
    await expect(button).toBeVisible();
    await page.clock.pauseAt(T1);

    await button.focus();
    await page.keyboard.press('Space');
    await expect(act).toHaveAttribute('data-stomping', 'true');
    await expect(act).toHaveAttribute('data-stomp-count', '1');
    expect(await act.locator('.stomp-ring').count()).toBeGreaterThanOrEqual(1);

    // 按空白鍵是震腳，不是捲頁。
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.clock.runFor(2000);
    await expect(act).not.toHaveAttribute('data-stomping', /.+/);
    await expect(act.locator('.stomp-ring')).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    // 點一下也可以。
    await button.click();
    await expect(act).toHaveAttribute('data-stomp-count', '2');
  });
});

test.describe('斬：刀光', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('快速拖過畫面留下刀光，隨後消失；慢慢移動不會有', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    const layer = page.locator('[data-slash]');
    await expect(layer).toHaveAttribute('data-slash-points', '0');
    await page.clock.pauseAt(T1);

    // 慢。
    await page.mouse.move(200, 300);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(200 + i * 4, 300);
      await page.clock.runFor(16);
    }
    await page.mouse.up();
    await expect(layer).toHaveAttribute('data-slash-points', '0');

    // 快。
    await page.mouse.move(200, 300);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(200 + i * 90, 300 + i * 30);
      await page.clock.runFor(16);
    }
    await page.mouse.up();
    await expect(layer).toHaveAttribute('data-slash-points', /^[1-9]\d*$/);

    await page.clock.runFor(1500);
    await expect(layer).toHaveAttribute('data-slash-points', '0');
  });

  test('刀光層不攔截點擊與捲動', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    const layer = page.locator('[data-slash]');
    await expect(layer).toHaveAttribute('data-slash-points', '0');
    expect(await layer.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    await page.clock.pauseAt(T1);

    // 在首屏的「看課程」連結上方劃一刀，刀光還在的時候直接點連結。
    const link = page.locator('.hero').getByRole('link', { name: '看課程' });
    const box = (await link.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx - 400, cy - 120);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(cx - 400 + i * 100, cy - 120 + i * 30);
      await page.clock.runFor(16);
    }
    await page.mouse.up();
    await expect(layer).toHaveAttribute('data-slash-points', /^[1-9]\d*$/);

    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('a')?.textContent?.trim(), [cx, cy]);
    expect(hit).toBe('看課程');

    // 捲動照常。
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  });

  test('幕與幕之間的轉場有一道斜向刀光', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('data-acts', 'pinned');
    const layer = page.locator('[data-slash]');
    await expect(layer).toHaveAttribute('data-slash-points', '0');
    await expect(layer).toHaveAttribute('data-slash-cuts', '0');

    // 捲進「拳術」那一幕。
    await page.evaluate(() => {
      const spacer = document.querySelector('[data-act="fist"]')!.closest('.pin-spacer')!;
      window.scrollTo(0, spacer.getBoundingClientRect().top + window.scrollY + 200);
    });
    await expect(layer).toHaveAttribute('data-slash-cuts', /^[1-9]/);
  });
});

test.describe('首屏：獅子上的金屬掃光', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('掃光跟著指標移動', async ({ page }) => {
    await page.goto('./');
    const sheen = page.locator('.hero__sheen');
    await expect(sheen).toHaveCount(1);
    const visual = (await page.locator('[data-hero-visual]').boundingBox())!;
    const position = () => sheen.evaluate((el) => getComputedStyle(el).getPropertyValue('--sheen-x').trim());

    await page.mouse.move(visual.x + visual.width * 0.2, visual.y + visual.height * 0.5);
    await expect.poll(async () => parseFloat(await position())).toBeLessThan(35);
    await page.mouse.move(visual.x + visual.width * 0.8, visual.y + visual.height * 0.5);
    await expect.poll(async () => parseFloat(await position())).toBeGreaterThan(65);
    // 掃光是裝飾，不擋住底下的東西。
    expect(await sheen.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  });
});

test.describe('沒有 JavaScript', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });

  test('兵器顯示線稿，3D 的操作列不出現', async ({ page }) => {
    await page.goto('./');
    await expect(weaponAct(page).locator('.act__weapon')).toHaveCount(3);
    await expect(weaponAct(page).locator('.act__weapon').first()).toBeVisible();
    await expect(page.locator('[data-weapon-pick]').first()).toBeHidden();
    await expect(page.locator('[data-stomp]')).toBeHidden();

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
    setKind(kind: string): void;
    setProgress(progress: number | null): void;
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

    test('兵器台：三件兵器在各段捲動進度都不壓到標題與課程牌', async ({ page }) => {
      await page.goto('./');
      await reachStage(page);
      const host = stage(page);
      const title = await rectOf(weaponAct(page).locator('.act__head'));
      const tablets = await rectOf(weaponAct(page).locator('.act__courses'));
      // 畫得出來的只有畫布裡面的部分（手機上畫布只佔幕的上半，落下的劍鞘出了畫布就看不到）。
      const frame = await rectOf(host);
      const clip = (box: Box): Box => ({
        left: Math.max(box.left, frame.left),
        top: Math.max(box.top, frame.top),
        right: Math.min(box.right, frame.right),
        bottom: Math.min(box.bottom, frame.bottom),
      });

      for (const kind of ['jian', 'miaodao', 'spear']) {
        for (const progress of [0, 0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.86, 0.95, 1]) {
          const bounds = clip(
            await host.evaluate(
              (el, [k, p]) => {
                const debug = (el as DebugHost).weaponDebug;
                debug.setKind(k as string);
                debug.setProgress(p as number);
                return debug.bounds();
              },
              [kind, progress] as const,
            ),
          );
          const where = `${kind} @ ${progress}`;
          // 大槍一開始在畫面外（由左邊扎進來）；演到一半以後，三件都一定在畫面上。
          if (progress >= 0.45) expect(bounds.right - bounds.left, where).toBeGreaterThan(40);
          expect(overlap(bounds, title), `${where} 壓到標題`).toBe(0);
          expect(overlap(bounds, tablets), `${where} 壓到課程牌`).toBe(0);
        }
      }
    });

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
