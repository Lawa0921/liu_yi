import { expect, test, type Page } from '@playwright/test';

// 第四輪：首屏「活的電影畫面」（體積光、鏡頭呼吸、視差、刻字、蓋印、落腳）、整個首頁的前後景、
// 大人／小孩的門扇開合、兵器切換的刀鋒指示條、其他切換鈕的蓋章回饋。

test.describe.configure({ mode: 'default', timeout: 90_000 });

const T0 = new Date('2026-01-01T08:00:00');
const T1 = new Date('2026-01-01T09:00:00');
const READY = { timeout: 30_000 };
const html = (page: Page) => page.locator('html');
const heroScene = (page: Page) => page.locator('.hero [data-scene="hero"]');

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const rectOf = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const { left, top, right, bottom } = el.getBoundingClientRect();
    return { left, top, right, bottom };
  });
const rectsOf = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) =>
    els
      // 固定定位的元素沒有 offsetParent：用 getClientRects 判斷有沒有畫出來。
      .filter((el) => getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0)
      .map((el) => {
        const { left, top, right, bottom } = el.getBoundingClientRect();
        return { left, top, right, bottom, name: el.className };
      }),
  );
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

const intoAct = (page: Page, act: string, offset: number) =>
  page.evaluate(
    ([name, by]) => {
      const element = document.querySelector(`[data-act="${name}"]`)!;
      const box = (element.closest('.pin-spacer') ?? element).getBoundingClientRect();
      window.scrollTo(0, box.top + window.scrollY + (by as number));
    },
    [act, offset] as const,
  );

test.describe('首屏：活的電影畫面（桌機）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('門洞的體積光：WebGL2 著色器在畫（不支援就退回 CSS 光束），終態也一直在動', async ({ page }) => {
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'done', { timeout: 10_000 });
    const scene = heroScene(page);
    await expect(scene).toHaveAttribute('data-atmos', /^(webgl2|css)$/);
    if ((await scene.getAttribute('data-atmos')) === 'webgl2') {
      const frames = async () => Number(await page.locator('.hero canvas[data-atmos-canvas]').getAttribute('data-atmos-frames'));
      const first = await frames();
      await expect.poll(frames).toBeGreaterThan(first + 3);
      // CSS 的光束這時讓位。
      expect(await page.locator('.hero [data-scene-layer="beam"]').evaluate((el) => getComputedStyle(el).display)).toBe('none');
    }
    // 鏡頭的呼吸：沒有捲動也在動。
    const breath = () => scene.evaluate((el) => getComputedStyle(el).getPropertyValue('--breath').trim());
    const before = await breath();
    await expect.poll(breath).not.toBe(before);
  });

  test('滑鼠視差：近層的位移明顯大於遠層；人形的輪廓光跟著滑鼠偏', async ({ page }) => {
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'done', { timeout: 10_000 });
    const place = async () => ({
      far: (await rectOf(page, '.hero [data-scene-layer="far-roofs"] .scene__shape')).left,
      fore: (await rectOf(page, '.hero [data-scene-layer="fore-pillars"] .scene__shape')).left,
      rim: await page.locator('.hero [data-figure="hero"] .scene__rim').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41),
    });
    await page.mouse.move(40, 450);
    await page.waitForTimeout(1500);
    const left = await place();
    await page.mouse.move(1400, 450);
    await page.waitForTimeout(1500);
    const right = await place();
    const farShift = Math.abs(right.far - left.far);
    const foreShift = Math.abs(right.fore - left.fore);
    expect(foreShift).toBeGreaterThan(60);
    expect(foreShift).toBeGreaterThan(farShift * 3);
    expect(right.rim).toBeGreaterThan(left.rim);
  });

  test('擊中那一拍換成落地的那張，裂紋中心在落下的那隻腳下；接著刻字、最後蓋印', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T1);
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'playing');
    await page.clock.runFor(640);
    await expect(html(page)).toHaveAttribute('data-opening', 'struck');
    const land = page.locator('.hero [data-figure="land"]');
    await expect(land).toHaveClass(/is-landed/);
    await expect(page.locator('.hero [data-figure="stomp"]')).toHaveClass(/is-spent/);
    const body = await rectOf(page, '.hero [data-figure="land"] .scene__figure');
    const origin = await rectOf(page, '.hero [data-figure="land"] [data-impact-origin]');
    expect(origin.left).toBeGreaterThan(body.left);
    expect(origin.left).toBeLessThan(body.left + (body.right - body.left) * 0.35);
    expect(Math.abs(origin.top - body.bottom)).toBeLessThan((body.bottom - body.top) * 0.06);

    // 刻字：每個大字都在刻（剔紅的刀路），字本身是平面的單色。
    const chars = page.locator('.hero__char');
    await expect(chars.first()).toHaveCSS('animation-name', /hero-carve/);
    expect(await chars.first().evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');

    // 蓋印：最後一拍獅印才落下。
    const visual = page.locator('[data-hero-visual]');
    await expect(visual).not.toHaveClass(/is-stamped/);
    await page.clock.runFor(1500);
    await expect(visual).toHaveClass(/is-stamped/);
  });
});

test.describe('首屏：減少動態', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('靜態終態：不刻字、不蓋印動畫、體積光只畫一格、鏡頭不呼吸', async ({ page }) => {
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'done');
    await expect(page.locator('.hero__char').first()).toHaveCSS('animation-name', 'none');
    const scene = heroScene(page);
    await expect(scene).toHaveAttribute('data-atmos', /^(webgl2|css)$/);
    if ((await scene.getAttribute('data-atmos')) === 'webgl2') {
      await page.waitForTimeout(800);
      await expect(page.locator('.hero canvas[data-atmos-canvas]')).toHaveAttribute('data-atmos-frames', '1');
    }
    expect(await scene.evaluate((el) => getComputedStyle(el).getPropertyValue('--breath').trim() || '0px')).toBe('0px');
  });
});

// ── 整個首頁的前後景 ───────────────────────────────────────────

const SECTIONS = ['hero', 'weapon', 'fist', 'combat', 'courses', 'coaches', 'facility', 'contact'];
/** 不能被前景擋到的：主要按鈕與課程卡的名稱。 */
const GUARDED = ['.site-nav__cta', '.hero__actions a', '.contact__actions a', '.section__more a', '.course-card h3', '.tablet__name', '.audience-cards__option'];

for (const [label, viewport, mobile] of [
  ['桌機', { width: 1440, height: 900 }, false],
  ['手機', { width: 390, height: 844 }, true],
] as const) {
  test(`前後景（${label}）：每一幕、每個區塊都有遠景與前景；前景不壓主要按鈕與課程卡名稱`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'done', { timeout: 10_000 });
    for (const name of SECTIONS) {
      const scene = page.locator(`[data-scene="${name}"]`);
      await expect(scene, name).toHaveCount(1);
      // 把這一塊捲到畫面中間（視差歸零的位置）再量。
      await scene.evaluate((el) => {
        const host = (el.closest('.pin-spacer') as HTMLElement | null) ?? (el.parentElement as HTMLElement);
        const box = host.getBoundingClientRect();
        window.scrollTo(0, window.scrollY + box.top + box.height / 2 - window.innerHeight / 2);
      });
      await expect(scene).toHaveAttribute('data-scene-ready', 'true');
      await page.waitForTimeout(450);
      const layers = await scene.locator('[data-scene-layer]').evaluateAll((els) =>
        els.filter((el) => getComputedStyle(el).display !== 'none').map((el) => [...el.classList].join(' ')),
      );
      expect(layers.some((c) => /scene__layer--(far|mid)/.test(c)), `${name} 遠景`).toBe(true);
      if (!mobile || name === 'hero') expect(layers.some((c) => c.includes('scene__layer--fore')), `${name} 前景`).toBe(true);
      const fores = await rectsOf(page, `[data-scene="${name}"] .scene__layer--fore .scene__shape`);
      for (const selector of GUARDED) {
        for (const target of await rectsOf(page, selector)) {
          if (target.bottom < 0 || target.top > viewport.height) continue;
          for (const fore of fores) expect(overlap(fore, target), `${name}: ${fore.name} × ${selector}`).toBe(0);
        }
      }
    }
    await context.close();
  });
}

test.describe('捲動視差（桌機）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('同一段捲動，前景走得比遠景多很多', async ({ page }) => {
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-opening', 'done', { timeout: 10_000 });
    const scene = page.locator('[data-scene="courses"]');
    const measure = async (offset: number) => {
      await scene.evaluate((el, by) => {
        const box = el.parentElement!.getBoundingClientRect();
        window.scrollTo(0, window.scrollY + box.top - window.innerHeight / 2 + by);
      }, offset);
      await page.waitForTimeout(500);
      const section = await rectOf(page, '#courses');
      const far = await rectOf(page, '[data-scene="courses"] [data-scene-layer="far-roofs"] .scene__shape');
      const fore = await rectOf(page, '[data-scene="courses"] .scene__layer--fore .scene__shape');
      return { far: far.top - section.top, fore: fore.top - section.top };
    };
    const a = await measure(-200);
    const b = await measure(200);
    expect(Math.abs(b.fore - a.fore)).toBeGreaterThan(Math.abs(b.far - a.far) * 4);
    expect(Math.abs(b.fore - a.fore)).toBeGreaterThan(40);
  });
});

// ── 大人／小孩：門扇開合 ─────────────────────────────────────────

const panel = (page: Page, who: string) => page.locator(`[data-audience-panel="${who}"]`);
const doors = (page: Page) => page.locator('#courses .audience-cards');

test.describe('大人／小孩：門扇開合', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('合上 → 換組 → 打開，900ms 內走完；只會有一組在畫面上', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await page.clock.pauseAt(T1);
    await page.locator('#courses').scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: '小孩' }).click();
    await expect(page.getByRole('button', { name: '小孩' })).toHaveAttribute('aria-pressed', 'true');
    await expect(doors(page)).toHaveAttribute('data-door', 'closing');
    await expect(panel(page, 'adult')).toBeVisible();
    await page.clock.runFor(360);
    await expect(doors(page)).toHaveAttribute('data-door', 'opening');
    await expect(panel(page, 'kid')).toBeVisible();
    await expect(panel(page, 'adult')).toBeHidden();
    // 新卡片由深處飛出。
    await expect(panel(page, 'kid').locator('li').first()).toHaveCSS('animation-name', /audience-fly/);
    await page.clock.runFor(560);
    await expect(doors(page)).not.toHaveAttribute('data-door', /.+/);
    await expect(panel(page, 'kid')).toBeVisible();
  });

  test('連點：中斷舊動畫、直接走向最後一次點的；不卡住、不會兩組同時顯示', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await page.clock.pauseAt(T1);
    await page.locator('#courses').scrollIntoViewIfNeeded();
    const kid = page.getByRole('button', { name: '小孩' });
    const adult = page.getByRole('button', { name: '大人' });
    await kid.click();
    await page.clock.runFor(120);
    await adult.click();
    await page.clock.runFor(400);
    await kid.click();
    for (let i = 0; i < 6; i++) {
      await page.clock.runFor(100);
      const shown = await page.locator('[data-audience-panel]').evaluateAll((els) => els.filter((el) => getComputedStyle(el).display !== 'none').length);
      expect(shown).toBe(1);
    }
    await page.clock.runFor(900);
    await expect(doors(page)).not.toHaveAttribute('data-door', /.+/);
    await expect(panel(page, 'kid')).toBeVisible();
    await expect(panel(page, 'adult')).toBeHidden();
    await expect(kid).toHaveAttribute('aria-pressed', 'true');
  });

  test('鍵盤也能切換（門照樣開合）', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: '小孩' }).focus();
    await page.keyboard.press('Enter');
    await expect(panel(page, 'kid')).toBeVisible();
    await expect(panel(page, 'adult')).toBeHidden();
  });
});

test.describe('大人／小孩：減少動態', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('直接切換，沒有門', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: '小孩' }).click();
    await expect(panel(page, 'kid')).toBeVisible();
    await expect(panel(page, 'adult')).toBeHidden();
    await expect(doors(page)).not.toHaveAttribute('data-door', /.+/);
  });
});

// ── 兵器切換與其他切換鈕 ─────────────────────────────────────────

test.describe('兵器切換：刀鋒指示條與人形溶解', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('指示條滑到選中的那一件、留一道殘光；舊的人形溶解（模糊淡出）', async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-acts', 'pinned');
    await intoAct(page, 'weapon', 500);
    const host = page.locator('[data-act="weapon"] [data-weapon3d="stage"]');
    await expect(host).toHaveAttribute('data-forge', '1.00', READY);
    const blade = page.locator('.armory-switch__blade');
    await expect(blade).toHaveCount(1);
    const pick = page.getByRole('button', { name: '苗刀' });
    await pick.click();
    await expect(page.locator('.armory-switch__trail')).toHaveCount(1);
    await expect
      .poll(async () => Math.abs((await rectOf(page, '.armory-switch__blade')).left - (await pick.boundingBox())!.x))
      .toBeLessThan(3);
    // 舊的人形溶解：糊開（至少 4px）再淡掉。
    await expect
      .poll(() =>
        page.locator('[data-act="weapon"] [data-figure="jian"]').evaluate((el) => parseFloat(/blur\(([\d.]+)px\)/.exec(getComputedStyle(el).filter)?.[1] ?? '0')),
      )
      .toBeGreaterThanOrEqual(4);
  });

  test('持械人形看得到、整個在幕裡（不被左邊切掉）', async ({ page }) => {
    await page.goto('./');
    await expect(html(page)).toHaveAttribute('data-acts', 'pinned');
    await intoAct(page, 'weapon', 500);
    await expect(page.locator('[data-act="weapon"] [data-weapon3d="stage"]')).toHaveAttribute('data-forge', '1.00', READY);
    const act = await rectOf(page, '[data-act="weapon"]');
    const figure = await rectOf(page, '[data-act="weapon"] .scene [data-figure="jian"] .scene__figure');
    expect(figure.left).toBeGreaterThanOrEqual(act.left);
    const opacity = await page.locator('[data-act="weapon"] .scene [data-figure="jian"]').evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(opacity).toBeGreaterThan(0.3);
  });
});

test('手機拳術幕：兩顆朱印不壓在大字上', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('./');
  await page.locator('[data-act="fist"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-stomp]')).toBeVisible();
  const glyph = await rectOf(page, '[data-act="fist"] .act__glyph > span');
  for (const selector of ['[data-stomp]', '[data-kao]']) expect(overlap(glyph, await rectOf(page, selector)), selector).toBe(0);
  await context.close();
});

test('貼山靠：撞過去的是貼山靠的人形（快速掠過後退場）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: T0 });
  await page.goto('./');
  await expect(html(page)).toHaveAttribute('data-acts', 'pinned');
  await intoAct(page, 'fist', 500);
  await expect(page.locator('[data-kao]')).toBeVisible();
  await page.clock.pauseAt(T1);
  await page.locator('[data-kao]').click();
  await expect(page.locator('[data-act="fist"] [data-figure="kao"]')).toHaveClass(/is-charging/);
  await page.clock.runFor(2500);
  await expect(page.locator('[data-act="fist"] [data-figure="kao"]')).not.toHaveClass(/is-charging/);
});

test('課程頁的照片切換鈕：蓋章式的按下回饋，換到的照片淡入就位', async ({ page }) => {
  await page.goto('./courses/kids-self-defense/');
  const next = page.getByRole('button', { name: '下一張照片' });
  await next.click();
  await expect(next).toHaveAttribute('data-stamped', 'true');
  await expect(page.locator('[data-gallery] > *').nth(1)).toHaveClass(/is-current/);
  await expect(page.locator('[data-gallery] > *').nth(0)).not.toHaveClass(/is-current/);
});

// ── 驗收後的修正 ───────────────────────────────────────────

test('大人／小孩：點下後 50ms 內按鈕就換高亮（不等門合上）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: T0 });
  await page.goto('./');
  await page.clock.pauseAt(T1);
  const kid = page.getByRole('button', { name: '小孩' });
  const adult = page.getByRole('button', { name: '大人' });
  await kid.scrollIntoViewIfNeeded();
  const colour = (locator: typeof kid) => locator.evaluate((el) => getComputedStyle(el).color);
  const lit = await colour(adult);
  const dim = await colour(kid);
  expect(lit).not.toBe(dim);
  await kid.click();
  // 點下後 50ms（真實時間）內就換好。
  await page.waitForTimeout(50);
  // 門還在合（卡片組還沒換），按鈕已經換好。
  await expect(page.locator('#courses .audience-cards')).toHaveAttribute('data-door', 'closing');
  expect(await colour(kid)).toBe(lit);
  expect(await colour(adult)).not.toBe(lit);
  // 金色滑塊也已經在往選中的那一邊滑（有一段往右的過場，或已經到了）。
  const sliding = await page.locator('#courses .audience-cards__thumb').evaluate(
    (el) => el.getAnimations().length > 0 || new DOMMatrix(getComputedStyle(el).transform).m41 > 0,
  );
  expect(sliding).toBe(true);
});

test('開場的模組載不到：首屏的標題與按鈕仍在 3.5 秒內出現', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/Hero\.astro_astro_type_script/, (route) => route.abort());
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 3500 });
  await expect(page.locator('.hero__actions').getByRole('link', { name: '看課程' })).toBeVisible({ timeout: 500 });
  await expect(html(page)).toHaveAttribute('data-opening', 'done');
});

test('課程卡的大字是平面單色（不是金色漸層字）', async ({ page }) => {
  await page.goto('./');
  const glyph = page.locator('.course-card__glyph').first();
  await glyph.scrollIntoViewIfNeeded();
  const style = await glyph.evaluate((el) => {
    const s = getComputedStyle(el);
    return { image: s.backgroundImage, clip: s.backgroundClip || s.webkitBackgroundClip, color: s.color };
  });
  expect(style.image).toBe('none');
  expect(style.color).not.toBe('rgba(0, 0, 0, 0)');
});

test('震腳與貼山靠各有約 400ms 冷卻：連按兩下只算一次', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: T0 });
  await page.goto('./');
  await expect(html(page)).toHaveAttribute('data-acts', 'pinned');
  await intoAct(page, 'fist', 500);
  const act = page.locator('[data-act="fist"]');
  await expect(page.locator('button[data-stomp]')).toBeVisible();
  await page.clock.pauseAt(T1);
  for (const [selector, count] of [['button[data-stomp]', 'data-stomp-count'], ['button[data-kao]', 'data-kao-count']] as const) {
    await page.locator(selector).click();
    await page.clock.runFor(150);
    await page.locator(selector).click();
    await expect(act).toHaveAttribute(count, '1');
    await page.clock.runFor(400);
    await page.locator(selector).click();
    await expect(act).toHaveAttribute(count, '2');
    await page.clock.runFor(3000);
  }
});

test('擊中那一拍硬切：落地那格一換上，抬腳的那格就不見（不交疊）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: T0 });
  await page.clock.pauseAt(T1);
  await page.goto('./');
  await page.clock.runFor(640);
  await expect(html(page)).toHaveAttribute('data-opening', 'struck');
  const opacity = (key: string) => page.locator(`.hero [data-figure="${key}"]`).evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(await opacity('land')).toBe(1);
  expect(await opacity('stomp')).toBe(0);
  // 餘韻換成定格的人時也是硬切：兩邊都不帶淡入淡出（不會有兩個人疊在一起的那幾格）。
  await page.clock.runFor(120);
  await expect(page.locator('.hero [data-figure="hero"]')).toHaveClass(/is-set/);
  for (const key of ['land', 'hero']) {
    const duration = await page.locator(`.hero [data-figure="${key}"]`).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration.split(',').every((d) => parseFloat(d) === 0), key).toBe(true);
  }
});

test('獅印是「蓋」下來的：從兩倍以上大小落下、不淡入，擊中時壓扁再回彈', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: T0 });
  await page.clock.pauseAt(T1);
  await page.goto('./');
  await page.clock.runFor(640 + 1100);
  await expect(page.locator('[data-hero-visual]')).toHaveClass(/is-stamped/);
  const frames = await page.locator('[data-hero-visual]').evaluate((el) =>
    el.getAnimations().flatMap((a) => ((a.effect as KeyframeEffect).getKeyframes?.() ?? []).map((k) => ({ t: String(k.transform ?? ''), o: k.opacity }))),
  );
  expect(frames.length).toBeGreaterThan(2);
  // 不淡入：沒有任何一格是透明的。
  expect(frames.every((f) => f.o === undefined || Number(f.o) >= 0.99)).toBe(true);
  expect(Number(/scale\(([\d.]+)/.exec(frames[0]!.t)?.[1])).toBeGreaterThanOrEqual(2);
  // 壓扁：有一格是橫向比縱向大。
  expect(frames.some((f) => /scale\(([\d.]+),\s*([\d.]+)\)/.test(f.t) && Number(RegExp.$1) > Number(RegExp.$2))).toBe(true);
});
