import { expect, test, type Page } from '@playwright/test';

// 第三版「衝擊感」：首屏一震開門、淬火成形、苗刀破幅、震腳升級與貼山靠、章節色。
// 時間相關的斷言用停住的假時鐘（clock.install → pauseAt → runFor）。
// 這個檔案「不」開 weaponDebug 的測試旗標：正式站的樣子。

test.describe.configure({ mode: 'default', timeout: 90_000 });

const READY = { timeout: 30_000 };
const T0 = new Date('2026-01-01T08:00:00');
const T1 = new Date('2026-01-01T09:00:00');

const html = (page: Page) => page.locator('html');
const heroImpact = (page: Page) => page.locator('.hero canvas[data-impact]');
const fist = (page: Page) => page.locator('[data-act="fist"]');
const stage = (page: Page) => page.locator('[data-act="weapon"] [data-weapon3d="stage"]');
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

/** 捲進某一幕的釘選區。 */
const intoAct = (page: Page, act: string, offset: number) =>
  page.evaluate(
    ([name, by]) => {
      const element = document.querySelector(`[data-act="${name}"]`)!;
      const box = (element.closest('.pin-spacer') ?? element).getBoundingClientRect();
      window.scrollTo(0, box.top + window.scrollY + (by as number));
    },
    [act, offset] as const,
  );

test.describe('首屏：一震開門', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('演完是終態；同一個工作階段重新整理不再演；首屏不載 three', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'done', { timeout: 10_000 });
    await expect(html(page)).toHaveAttribute('data-opening-played', 'true');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // 八條主裂線留在首屏當紋飾。
    await expect(heroImpact(page)).toHaveAttribute('data-impact-cracks', '8');
    await expect(page.locator('[data-opening-skip]')).toBeHidden();
    await expect(html(page)).not.toHaveAttribute('data-three', /.+/);
    expect(await page.evaluate(() => window.sessionStorage.getItem('liuyi:opening'))).toBe('1');

    await page.reload();
    await expect(html(page)).toHaveAttribute('data-opening', 'done');
    await expect(html(page)).toHaveAttribute('data-opening-played', 'false');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(heroImpact(page)).toHaveAttribute('data-impact-cracks', '8');
    expect(errors).toEqual([]);
  });

  test('節奏：蓄（只有地平線）→ 擊（裂紋炸開、內容出現）→ 終態', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T1);
    await page.goto('./');

    // 蓄：內容還藏著，只有地平線與跳過鈕。
    await expect(html(page)).toHaveAttribute('data-opening', 'playing');
    await expect(page.getByRole('heading', { level: 1 })).toBeHidden();
    await expect(page.locator('.hero__horizon')).toHaveCSS('opacity', '1');
    await expect(page.getByRole('button', { name: '跳過' })).toBeVisible();
    await expect(heroImpact(page)).toHaveAttribute('data-impact-cracks', '0');

    // 擊。
    await page.clock.runFor(640);
    await expect(html(page)).toHaveAttribute('data-opening', 'struck');
    await expect(heroImpact(page)).toHaveAttribute('data-impact-cracks', '8');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // 餘韻：塵浪。
    await page.clock.runFor(120);
    await expect(heroImpact(page)).toHaveAttribute('data-impact-particles', /^[1-9]\d*$/);

    await page.clock.runFor(2000);
    await expect(html(page)).toHaveAttribute('data-opening', 'done');
    await expect(html(page)).toHaveAttribute('data-opening-played', 'true');
    // 整段沒有把頁面撐寬。
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('可用鍵盤跳過：演到一半按 Esc 直接到終態', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T1);
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'playing');

    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-opening', 'done');
    await expect(html(page)).toHaveAttribute('data-opening-played', 'skipped');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(heroImpact(page)).toHaveAttribute('data-impact-cracks', '8');
  });

  test('「跳過」鈕可聚焦、可用 Enter 觸發', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T1);
    await page.goto('./');
    const skip = page.getByRole('button', { name: '跳過' });
    await skip.focus();
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(html(page)).toHaveAttribute('data-opening', 'done');
    await expect(skip).toBeHidden();
  });
});

test.describe('首屏：減少動態', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('直接顯示終態：不演、塵粒不飄，裂紋是靜態的紋飾', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T1);
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'done');
    await expect(html(page)).toHaveAttribute('data-opening-played', 'false');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(heroImpact(page)).toHaveAttribute('data-impact-cracks', '8');
    await expect(heroImpact(page)).toHaveAttribute('data-impact-particles', '0');
    await expect(page.locator('[data-opening-skip]')).toBeHidden();
  });

  test('拳術幕：震腳與貼山靠的按鈕都不出現；幕間不破幅', async ({ page }) => {
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-acts', 'static');
    await fist(page).scrollIntoViewIfNeeded();
    await expect(page.locator('[data-stomp]')).toBeHidden();
    await expect(page.locator('[data-kao]')).toBeHidden();
    await page.locator('[data-act="combat"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-cleave]')).not.toHaveAttribute('data-cleave-count', /[1-9]/);
    await expect(page.locator('[data-cleave]')).toBeHidden();
  });
});

test.describe('首屏：手機與沒有 JavaScript', () => {
  test('手機 390：演完是終態，不水平外溢', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'done', { timeout: 10_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(heroImpact(page)).toHaveAttribute('data-impact-cracks', '8');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await context.close();
  });

  test('沒有 JavaScript：首屏內容直接可見，沒有跳過鈕', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto('./');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[data-opening-skip]')).toBeHidden();
    await expect(page.locator('[data-kao]')).toBeHidden();
    await context.close();
  });
});

test.describe('拳術幕：震腳升級與貼山靠', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('震腳：八方裂紋加塵浪，之後收掉', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-acts', 'pinned');
    await intoAct(page, 'fist', 500);
    const button = page.locator('[data-stomp]');
    await expect(button).toBeVisible();
    await page.clock.pauseAt(T1);
    const canvas = fist(page).locator('canvas[data-impact]');

    await button.focus();
    await page.keyboard.press('Space');
    await expect(fist(page)).toHaveAttribute('data-stomping', 'true');
    await expect(canvas).toHaveAttribute('data-impact-cracks', '8');
    await page.clock.runFor(120);
    await expect(canvas).toHaveAttribute('data-impact-particles', /^[1-9]\d*$/);

    await page.clock.runFor(3000);
    await expect(fist(page)).not.toHaveAttribute('data-stomping', /.+/);
    await expect(canvas).toHaveAttribute('data-impact-cracks', '0');
    await expect(canvas).toHaveAttribute('data-impact-particles', '0');
  });

  test('貼山靠：可用鍵盤觸發，撞點噴漆片，之後回正', async ({ page }) => {
    const errors = collectErrors(page);
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-acts', 'pinned');
    await intoAct(page, 'fist', 500);
    const button = page.getByRole('button', { name: '貼山靠' });
    await expect(button).toBeVisible();
    await page.clock.pauseAt(T1);
    const canvas = fist(page).locator('canvas[data-impact]');
    const scrollBefore = await page.evaluate(() => window.scrollY);

    await button.focus();
    await page.keyboard.press('Enter');
    await expect(fist(page)).toHaveAttribute('data-kao', 'true');
    await expect(fist(page)).toHaveAttribute('data-kao-count', '1');
    await expect(canvas).toHaveAttribute('data-impact-particles', /^[1-9]\d*$/);

    await page.clock.runFor(2500);
    await expect(fist(page)).not.toHaveAttribute('data-kao', /.+/);
    await expect(canvas).toHaveAttribute('data-impact-particles', '0');
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // 課程牌還是點得到。
    await expect(page.locator('.acts a[href$="courses/bajiquan/"]')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('幕間：苗刀破幅', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('捲進下一幕：落幅 → 劈 → 定格 → 滑開，然後收掉；不擋點擊', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-acts', 'pinned');
    const cleave = page.locator('[data-cleave]');
    await expect(cleave).toHaveAttribute('data-cleave-phase', 'idle');
    await expect(cleave).toBeHidden();
    await page.clock.pauseAt(T1);

    await intoAct(page, 'fist', -300);
    await expect(cleave).toHaveAttribute('data-cleave-count', '1');
    await expect(cleave).toHaveAttribute('data-cleave-phase', 'drop');
    await expect(cleave).toBeVisible();
    expect(await cleave.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    // 幅上是下一幕的單字。
    await expect(cleave.locator('.cleave__glyph').first()).toHaveText('拳');

    await page.clock.runFor(115);
    await expect(cleave).toHaveAttribute('data-cleave-phase', 'slash');
    await page.clock.runFor(110);
    await expect(cleave).toHaveAttribute('data-cleave-phase', 'freeze');
    await page.clock.runFor(55);
    await expect(cleave).toHaveAttribute('data-cleave-phase', 'part');
    await page.clock.runFor(700);
    await expect(cleave).toHaveAttribute('data-cleave-phase', 'idle');
    await expect(cleave).toBeHidden();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('兵器台：淬火成形', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('第一次進場與切換兵器都是燒出來的；正式站的宿主元素上沒有除錯介面', async ({ page }) => {
    const errors = collectErrors(page);
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-acts', 'pinned');
    await intoAct(page, 'weapon', 500);
    const host = stage(page);
    await expect(host).toHaveAttribute('data-weapon3d-state', 'ready', READY);
    // 第一次進場：成形完畢。
    await expect(host).toHaveAttribute('data-forge', '1.00', READY);
    expect(await host.evaluate((el) => 'weaponDebug' in el)).toBe(false);
    await page.clock.pauseAt(T1);
    await page.clock.runFor(100);

    const forge = async () => Number(await host.getAttribute('data-forge'));
    await page.getByRole('button', { name: '苗刀' }).click();
    // 舊兵器燃盡中。
    await page.clock.runFor(190);
    await expect(host).toHaveAttribute('data-weapon-kind', 'jian');
    expect(await forge()).toBeGreaterThan(0);
    expect(await forge()).toBeLessThan(1);
    // 新兵器燒出來中。
    await page.clock.runFor(450);
    await expect(host).toHaveAttribute('data-weapon-kind', 'miaodao');
    expect(await forge()).toBeGreaterThan(0);
    expect(await forge()).toBeLessThan(1);

    await page.clock.runFor(2500);
    await expect(host).toHaveAttribute('data-forge', '1.00');
    // 章節色跟著台上的兵器換。
    await expect(page.locator('[data-act="weapon"]')).toHaveAttribute('data-chapter', 'miaodao');
    expect(errors).toEqual([]);
  });
});

// ── 立體空間：有縱深的場景（剪影層、視差、推進） ─────────────────────

const heroScene = (page: Page) => page.locator('.hero [data-scene="hero"]');
const originX = (page: Page) => heroScene(page).evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--ox')));
const opacityOf = (page: Page, selector: string) => page.locator(selector).evaluate((el) => Number(getComputedStyle(el).opacity));

test.describe('首屏：演武場的景深', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('由遠到近至少五層；剪影延後載入後都抓得到；缺的石階用畫的地面頂上', async ({ page, request }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'done', { timeout: 10_000 });
    const scene = heroScene(page);
    await expect(scene).toHaveAttribute('data-scene-ready', 'true');

    const roles = await scene.locator('[data-scene-layer]').evaluateAll((layers) => [
      ...new Set(
        layers.map((layer) =>
          [...layer.classList].find((name) => name.startsWith('scene__layer--') && name !== 'scene__layer--desktop')!.replace('scene__layer--', ''),
        ),
      ),
    ]);
    for (const role of ['far', 'mid', 'figure', 'dust', 'fore', 'ground']) expect(roles, role).toContain(role);

    // 每張剪影都套上了遮罩，而且圖抓得到。
    const masks = await scene.locator('[data-scene-asset]').evaluateAll((layers) =>
      layers.map((layer) => ({
        asset: layer.getAttribute('data-scene-asset'),
        mask: getComputedStyle(layer).getPropertyValue('--mask'),
        pending: layer.hasAttribute('data-mask'),
      })),
    );
    expect(masks.length).toBeGreaterThanOrEqual(5);
    for (const { asset, mask, pending } of masks) {
      expect(pending, asset!).toBe(false);
      const url = /url\("?([^")]+)"?\)/.exec(mask)?.[1];
      expect(url, asset!).toBeTruthy();
      expect((await request.get(new URL(url!, page.url()).href)).status(), asset!).toBe(200);
    }
    // 石階沒有素材：不出現在場景裡，地面是畫的。
    expect(masks.some((item) => item.asset === 'fg-steps')).toBe(false);
    await expect(scene.locator('.scene__floor')).toHaveCount(1);

    // 定格的人在、落腳的人退場。
    expect(await opacityOf(page, '.hero [data-figure="hero"]')).toBeGreaterThan(0.9);
    expect(await opacityOf(page, '.hero [data-figure="stomp"]')).toBe(0);
    await expect(html(page)).not.toHaveAttribute('data-three', /.+/);
    expect(errors).toEqual([]);
  });

  test('開場：先只有落腳的人；擊中之後換成定格的人，各層由遠到近亮起', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T1);
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'playing');
    expect(await opacityOf(page, '.hero [data-figure="stomp"]')).toBe(1);
    expect(await opacityOf(page, '.hero [data-scene-layer="far-roofs"]')).toBe(0);
    expect(await opacityOf(page, '.hero [data-scene-layer="fore-pillars"]')).toBe(0);

    await page.clock.runFor(760);
    await expect(page.locator('.hero [data-figure="hero"]')).toHaveClass(/is-set/);
    // 近的層比遠的層晚亮。
    const delay = (id: string) =>
      page.locator(`.hero [data-scene-layer="${id}"]`).evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--reveal')));
    expect(await delay('far-roofs')).toBeLessThan(await delay('fore-pillars'));

    await page.clock.runFor(2500);
    await expect(html(page)).toHaveAttribute('data-opening', 'done');
    await expect.poll(() => opacityOf(page, '.hero [data-scene-layer="fore-pillars"]')).toBeGreaterThan(0.9);
  });

  test('滑鼠移動有視差；捲動時鏡頭往前推進', async ({ page }) => {
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'done', { timeout: 10_000 });
    await expect(heroScene(page)).toHaveAttribute('data-scene-mode', 'mouse');

    await page.mouse.move(100, 450);
    await expect.poll(() => originX(page)).toBeLessThan(47);
    await page.mouse.move(1340, 450);
    await expect.poll(() => originX(page)).toBeGreaterThan(53);

    await page.evaluate(() => window.scrollTo(0, 380));
    await expect.poll(async () => Number(await heroScene(page).getAttribute('data-scene-push'))).toBeGreaterThan(0.3);
    const push = await heroScene(page).evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--push')));
    expect(push).toBeGreaterThan(50);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('景深：減少動態', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('靜態的分層構圖：沒有視差、沒有推進，層都在', async ({ page }) => {
    await page.goto('./');
    await expect(heroScene(page)).toHaveAttribute('data-scene-mode', 'static');
    await expect(heroScene(page)).toHaveAttribute('data-scene-ready', 'true');
    await page.mouse.move(100, 450);
    await page.mouse.move(1340, 450);
    await page.evaluate(() => window.scrollTo(0, 380));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await originX(page)).toBe(50);
    expect(await heroScene(page).evaluate((el) => getComputedStyle(el).getPropertyValue('--push').trim())).toBe('0px');
    expect(await opacityOf(page, '.hero [data-figure="hero"]')).toBeGreaterThan(0.9);
    expect(await opacityOf(page, '.hero [data-scene-layer="fore-pillars"]')).toBeGreaterThan(0.9);
  });
});

test.describe('景深：手機', () => {
  test('沒有滑鼠：用陀螺儀或緩慢漂移；層數比桌機少；不水平外溢', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'done', { timeout: 10_000 });
    await expect(heroScene(page)).toHaveAttribute('data-scene-mode', /tilt|drift/);
    const counts = await heroScene(page)
      .locator('[data-scene-layer]')
      .evaluateAll((layers) => ({ all: layers.length, shown: layers.filter((layer) => getComputedStyle(layer).display !== 'none').length }));
    expect(counts.shown).toBeLessThan(counts.all);
    expect(counts.shown).toBeGreaterThanOrEqual(5);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await context.close();
  });
});

test.describe('各幕的人形', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('兵器幕：持械人形跟著台上的兵器換；拳術幕有八極人形', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-acts', 'pinned');
    await intoAct(page, 'weapon', 500);
    await expect(stage(page)).toHaveAttribute('data-forge', '1.00', READY);
    const figure = (key: string) => `[data-act="weapon"] .scene [data-figure="${key}"]`;
    await expect.poll(() => opacityOf(page, figure('jian'))).toBeGreaterThan(0.15);
    expect(await opacityOf(page, figure('spear'))).toBe(0);

    await page.clock.pauseAt(T1);
    await page.getByRole('button', { name: '大槍' }).click();
    await page.clock.runFor(3000);
    await expect(page.locator('[data-act="weapon"]')).toHaveAttribute('data-chapter', 'spear');
    await expect.poll(() => opacityOf(page, figure('spear'))).toBeGreaterThan(0.15);
    await expect.poll(() => opacityOf(page, figure('jian'))).toBe(0);
    // 人形在 3D 兵器後面：不擋拖曳、不擋課程牌。
    expect(await page.locator('[data-act="weapon"] .scene').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');

    await expect(page.locator('[data-act="fist"] .scene [data-figure="fist"]')).toHaveCount(1);
  });
});

// ── 修正輪：版面不相疊、擊中夠重、不踩禁用項 ─────────────────────────

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const boxOf = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const { left, top, right, bottom } = el.getBoundingClientRect();
    return { left, top, right, bottom };
  });
const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

test.describe('修正：手機首屏', () => {
  test('人形不壓到標語與按鈕', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'done', { timeout: 10_000 });
    const figure = await boxOf(page, '.hero [data-figure="hero"] .scene__figure');
    expect(figure.bottom - figure.top).toBeGreaterThan(60);
    for (const selector of ['.hero__actions', '.hero__couplet', '.hero__title']) {
      expect(overlapArea(figure, await boxOf(page, selector)), selector).toBe(0);
    }
    // 人整個在第一屏裡（不是被擠到捲動才看得到的地方）。
    expect(figure.top).toBeGreaterThan(0);
    expect(figure.bottom).toBeLessThanOrEqual(844);
    // 標語與按鈕有一塊乾淨的底（不透明度夠高的底色）。
    for (const selector of ['.hero__couplet', '.hero__actions']) {
      const alpha = await page.locator(selector).evaluate((el) => {
        // 底色可能是 rgb()/rgba()，也可能是 color-mix() 算出來的 color(srgb r g b / a)：用畫布換算成 rgba 再取 alpha。
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = getComputedStyle(el).backgroundColor;
        ctx.fillRect(0, 0, 1, 1);
        return ctx.getImageData(0, 0, 1, 1).data[3]! / 255;
      });
      expect(alpha, selector).toBeGreaterThanOrEqual(0.8);
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await context.close();
  });

  test('開場下沉帶縮放時也不把頁面撐寬', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T1);
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'playing');
    await page.clock.runFor(640);
    await expect(html(page)).toHaveAttribute('data-opening', 'struck');
    // 下沉的動畫（Web Animations，走真實時間）：整段每 25ms 量一次。
    for (let i = 0; i < 18; i++) {
      expect(await overflow(page), `#${i}`).toBeLessThanOrEqual(0);
      await page.waitForTimeout(25);
    }
    await context.close();
  });
});

test.describe('修正：桌機', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('首屏首屏傳輸量 ≤ 1.3 MB', async ({ page }) => {
    // 每個回應的大小都要等它讀完才算數（不然會少算）。
    const sizes: Promise<number>[] = [];
    page.on('response', (response) => {
      sizes.push(
        response
          .body()
          .then((body) => body.length)
          .catch(() => 0),
      );
    });
    await page.goto('./');
    await page.waitForLoadState('networkidle');
    await expect(html(page)).toHaveAttribute('data-opening', 'done', { timeout: 10_000 });
    // 首屏的剪影層都套上、字型也抓完了才算。
    await expect(heroScene(page)).toHaveAttribute('data-scene-ready', 'true');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState('networkidle');
    const bytes = (await Promise.all(sizes)).reduce((sum, size) => sum + size, 0);
    expect(bytes).toBeGreaterThan(500 * 1024);
    expect(bytes).toBeLessThanOrEqual(1.3 * 1024 * 1024);
  });

  test('震腳的落點在人的腳下；裂紋衝到視窗邊緣；擊中時有塵牆與碎石', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T1);
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'playing');
    const foot = await boxOf(page, '.hero [data-figure="stomp"] .scene__figure');
    const origin = await boxOf(page, '.hero [data-impact-origin]');
    // 落點在腳底那條線上（上下差不到人高的 6%），左右在人的框裡。
    expect(Math.abs(origin.top - foot.bottom)).toBeLessThan((foot.bottom - foot.top) * 0.06);
    expect(origin.left).toBeGreaterThan(foot.left);
    expect(origin.left).toBeLessThan(foot.right);
    // 是落下的那隻腳（抬起來的左腳），不是撐地的右腳：在人形框的左半邊。
    expect(origin.left).toBeLessThan(foot.left + (foot.right - foot.left) * 0.4);

    await page.clock.runFor(900);
    const canvas = heroImpact(page);
    // 裂紋的範圍（相對於畫布半寬）：衝到邊緣。
    expect(Number(await canvas.getAttribute('data-impact-reach'))).toBeGreaterThanOrEqual(0.95);
    expect(Number(await canvas.getAttribute('data-impact-particles'))).toBeGreaterThanOrEqual(200);
  });

  test('捲動頭六成就推進到底', async ({ page }) => {
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'done', { timeout: 10_000 });
    const height = await page.locator('.hero').evaluate((el) => (el as HTMLElement).offsetHeight);
    const restTop = (await boxOf(page, '.hero')).top;
    // 推進的這段，首屏停在畫面上（鏡頭在往前推，畫面不往上捲走）。
    await page.evaluate((y) => window.scrollTo(0, y), Math.ceil(height * 0.3));
    await expect.poll(async () => Number(await heroScene(page).getAttribute('data-scene-push'))).toBeGreaterThan(0.4);
    expect(Math.abs((await boxOf(page, '.hero')).top - restTop)).toBeLessThanOrEqual(2);
    // 推到一半，前景立柱已經放大到出框（比視窗寬得多）。
    // 立柱拆成左右兩根（第四輪）：左柱推出左緣、右柱推出右緣。
    const pillars = page.locator('.hero [data-scene-layer="fore-pillars"] .scene__shape');
    const leftPillar = await pillars.first().evaluate((el) => el.getBoundingClientRect().left);
    const rightPillar = await pillars.last().evaluate((el) => el.getBoundingClientRect().right);
    expect(leftPillar).toBeLessThan(-200);
    expect(rightPillar).toBeGreaterThan(1440 + 200);
    await page.evaluate((y) => window.scrollTo(0, y), Math.ceil(height * 0.6));
    await expect.poll(async () => Number(await heroScene(page).getAttribute('data-scene-push'))).toBe(1);
    expect(Math.abs((await boxOf(page, '.hero')).top - restTop)).toBeLessThanOrEqual(2);
    // 推完才交給下一幕：再往下捲，首屏才開始往上走。
    await page.evaluate((y) => window.scrollTo(0, y), Math.ceil(height * 0.6) + 300);
    await expect.poll(async () => (await boxOf(page, '.hero')).top).toBeLessThan(restTop - 200);
  });

  test('貼山靠：殘影是平面的錯位複本，不用陰影疊出立體字；人形不和大字重疊', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-acts', 'pinned');
    await intoAct(page, 'fist', 500);
    await expect(page.locator('[data-kao]')).toBeVisible();
    await expect(page.locator('[data-act="fist"] .scene [data-figure="fist"]')).toHaveCount(1);
    await page.clock.pauseAt(T1);

    const figure = await boxOf(page, '[data-act="fist"] .scene [data-figure="fist"] .scene__figure');
    const glyph = await boxOf(page, '[data-act="fist"] .act__glyph > span');
    expect(overlapArea(figure, glyph)).toBe(0);
    // 人也不壓到課程牌：站在大字的一側。
    expect(overlapArea(figure, await boxOf(page, '[data-act="fist"] .act__courses'))).toBe(0);
    // 大字是平面的單色（不是金色漸層字）；八方線框與大字二選一：大字當主角，線框不出現。
    expect(await page.locator('[data-act="fist"] .act__glyph > span').evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
    expect(await opacityOf(page, '[data-act="fist"] .act__emblem')).toBe(0);
    // 窗櫺很淡、退在遠處。
    expect(await opacityOf(page, '[data-act="fist"] [data-scene-layer="mid-lattice"]')).toBeLessThanOrEqual(0.15);

    await page.locator('[data-kao]').click();
    await expect(fist(page)).toHaveAttribute('data-kao', 'true');
    const ghosts = fist(page).locator('.act__ghost');
    expect(await ghosts.count()).toBeGreaterThanOrEqual(2);
    expect(await ghosts.count()).toBeLessThanOrEqual(3);
    // 複本是大字本身的平面錯位複本（同一個字），不是一塊色塊。
    await expect(ghosts.first()).toHaveText('拳');
    // 複本是單色的平面：沒有漸層、沒有陰影。
    const flat = await ghosts.first().evaluate((el) => {
      const style = getComputedStyle(el);
      return { image: style.backgroundImage, shadow: style.boxShadow, filter: style.filter };
    });
    expect(flat).toEqual({ image: 'none', shadow: 'none', filter: 'none' });
    expect(await fist(page).locator('.act__stage').evaluate((el) => getComputedStyle(el).filter)).toBe('none');

    await page.clock.runFor(2500);
    await expect(ghosts).toHaveCount(0);
  });

  test('兵器幕：3D 兵器是主角——背景大字收掉，人形小、偏在一側、比兵器暗', async ({ page }) => {
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-acts', 'pinned');
    await intoAct(page, 'weapon', 500);
    const host = stage(page);
    await expect(host).toHaveAttribute('data-forge', '1.00', READY);
    // 背景大字與持械人形只留其一：留人形，大字退場。
    await expect.poll(() => opacityOf(page, '[data-act="weapon"] .act__glyph')).toBe(0);
    // 第四輪：人形原本暗到幾乎看不到，調亮一些（仍在霧後、比 3D 兵器暗）。
    expect(await opacityOf(page, '[data-act="weapon"] .scene [data-figure="jian"]')).toBeLessThanOrEqual(0.45);
    expect(await opacityOf(page, '[data-act="weapon"] .scene [data-figure="jian"]')).toBeGreaterThan(0.05);
    // 兵器架只留霧裡的一抹輪廓。
    expect(await opacityOf(page, '[data-act="weapon"] [data-scene-layer="mid-rack"]')).toBeLessThanOrEqual(0.12);
    const act = await boxOf(page, '[data-act="weapon"]');
    const figure = await boxOf(page, '[data-act="weapon"] .scene [data-figure="jian"] .scene__figure');
    expect(figure.bottom - figure.top).toBeLessThan((act.bottom - act.top) * 0.4);
    // 桌機有發光疊加（淬火的邊緣與刃口）。
    await expect(host).toHaveAttribute('data-bloom', 'on');
  });

  test('破幅：切線是 2–4px 的亮金細線，兩半錯位 6–8%', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-acts', 'pinned');
    await page.clock.pauseAt(T1);
    await intoAct(page, 'fist', -300);
    const cleave = page.locator('[data-cleave]');
    await expect(cleave).toHaveAttribute('data-cleave-count', '1');
    const shift = Number(await cleave.getAttribute('data-cleave-shift'));
    expect(shift).toBeGreaterThanOrEqual(0.06);
    expect(shift).toBeLessThanOrEqual(0.08);
    const width = await cleave.locator('.cleave__edge path').first().evaluate((el) => parseFloat(getComputedStyle(el).strokeWidth));
    expect(width).toBeGreaterThanOrEqual(2);
    expect(width).toBeLessThanOrEqual(4);
    // 兩半各帶一條金邊。
    await expect(cleave.locator('.cleave__half .cleave__edge')).toHaveCount(2);
  });
});

test.describe('修正：手機的降級', () => {
  test('手機不開發光疊加', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-acts', 'static');
    await page.locator('[data-act="weapon"]').scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 300);
    await expect(stage(page)).toHaveAttribute('data-weapon3d-state', 'ready', READY);
    await expect(stage(page)).toHaveAttribute('data-bloom', 'off');
    await context.close();
  });
});
