import sharp from 'sharp';
import { expect, test, type Page } from './fixtures';
import { boxOf, overlapOfBox } from './helpers';

// 子頁的剪影立體場景（Task 27，使用者要求「每一頁都是粒子有點審美疲勞、前中後遠景的效果沒有出現、整體太抽象」）：
// 頁首是一幕由遠到近四層的剪影（遠景屋脊、中景器物、人物、前景框），純 CSS 分層加少量 JS 視差，不載入 three 與光點引擎（傳輸量見 budget.spec）。
// 這裡驗：四層都在且已載入、捲動時各層位移不同、滑鼠微傾有上限、場景在標題上方不擋字、減少動態與沒有 JS 時正確、課程總覽滑過課程卡換人。
// 只用 page.*（含 page.mouse）；不碰 OS 層級的滑鼠鍵盤。

const SCENE_PAGES = [
  { name: '課程總覽', path: './courses/', kind: 'courses' },
  { name: '課程：八極專修（拳）', path: './courses/bajiquan/', kind: 'course' },
  { name: '課程：散手技擊（格鬥）', path: './courses/sanshou/', kind: 'course' },
  { name: '課程：中式兵器', path: './courses/chinese-weapons/', kind: 'course' },
  { name: '課程：兒童武術', path: './courses/kids-martial-arts/', kind: 'course' },
  { name: '課程：防身格鬥', path: './courses/kids-self-defense/', kind: 'course' },
  { name: '課程：防身兵器', path: './courses/kids-weapons/', kind: 'course' },
  { name: '課程：巴西柔術', path: './courses/bjj/', kind: 'course' },
  { name: '課程：核心瑜珈', path: './courses/core-yoga/', kind: 'course' },
  { name: '師資總覽', path: './coaches/', kind: 'coaches' },
  { name: '教練頁', path: './coaches/chan/', kind: 'coach' },
  { name: '場地', path: './facility/', kind: 'facility' },
  { name: '收費', path: './pricing/', kind: 'pricing' },
  { name: '課表', path: './schedule/', kind: 'schedule' },
  { name: '404', path: './no-such-page/', kind: 'lost' },
];

const LAYERS = ['far', 'mid', 'subject', 'fg'] as const;
type Layer = (typeof LAYERS)[number];

/** 某一層目前的位移（由 computed transform 的 matrix 讀出）。沒有 transform 就是 0。 */
async function offsetOf(page: Page, layer: Layer): Promise<{ x: number; y: number }> {
  return page.evaluate((kind) => {
    const el = document.querySelector<HTMLElement>(`[data-scene-layer="${kind}"]`);
    if (!el) throw new Error(`layer ${kind} missing`);
    const value = getComputedStyle(el).transform;
    if (value === 'none') return { x: 0, y: 0 };
    const m = new DOMMatrixReadOnly(value);
    return { x: m.m41, y: m.m42 };
  }, layer);
}

const nextFrames = (page: Page, count = 3) =>
  page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
        step(n);
      }),
    count,
  );

for (const device of [
  { name: '桌機 1440×900', viewport: { width: 1440, height: 900 } },
  { name: '手機 390×844', viewport: { width: 390, height: 844 } },
]) {
  test.describe(`場景的四層：${device.name}`, () => {
    test.use({ viewport: device.viewport });

    for (const item of SCENE_PAGES) {
      test(`${item.name}：遠景、中景、人物、前景都在，圖已載入；場景在標題上方；頁面沒有 canvas`, async ({ page }) => {
        const failed: string[] = [];
        page.on('pageerror', (error) => failed.push(error.message));
        await page.goto(item.path);
        await page.waitForLoadState('load');
        const scene = page.locator('.scene');
        await expect(scene).toHaveCount(1);
        await expect(scene).toHaveAttribute('data-scene', item.kind);
        await expect(scene).toHaveAttribute('aria-hidden', 'true');

        for (const layer of LAYERS) {
          const images = page.locator(`[data-scene-layer="${layer}"] img`);
          expect(await images.count(), `${layer} 至少一張圖`).toBeGreaterThanOrEqual(1);
          if (layer === 'fg') expect(await images.count(), 'fg 最多兩張').toBeLessThanOrEqual(2);
        }
        // 每一張都解碼完成（naturalWidth > 0）；裝飾圖 alt 是空的
        const states = await page.evaluate(async () => {
          const imgs = [...document.querySelectorAll<HTMLImageElement>('.scene img')];
          await Promise.all(imgs.map((img) => img.decode().catch(() => undefined)));
          return imgs.map((img) => ({ asset: img.dataset.asset, ok: img.complete && img.naturalWidth > 0, alt: img.getAttribute('alt') }));
        });
        expect(states.length, '遠景、中景、人物、前景至少各一張').toBeGreaterThanOrEqual(4);
        for (const state of states) {
          expect(state.ok, `${state.asset} 已載入`).toBe(true);
          expect(state.alt, `${state.asset} alt`).toBe('');
        }

        // 不是 WebGL：頁面沒有 canvas
        await expect(page.locator('main canvas')).toHaveCount(0);

        // 場景在內容上方：<main> 的第一個子元素，而且內容裡的文字都在場景下緣之下（重疊 ≤ 5%）
        expect(await page.evaluate(() => document.querySelector('main')!.firstElementChild!.classList.contains('scene'))).toBe(true);
        const [sceneBox] = await boxOf(page, '.scene');
        expect(sceneBox, '場景有大小').toBeTruthy();
        const textBoxes = await page.evaluate(() => {
          const out: { left: number; right: number; top: number; bottom: number; text: string }[] = [];
          const range = document.createRange();
          const walker = document.createTreeWalker(document.querySelector('main')!, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent?.trim() || node.parentElement?.closest('.scene, script, style, noscript')) continue;
            range.selectNodeContents(node);
            for (const r of range.getClientRects()) {
              if (r.width > 0 && r.height > 0) out.push({ left: r.left, right: r.right, top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, text: node.textContent.trim().slice(0, 12) });
            }
          }
          return out;
        });
        expect(textBoxes.length).toBeGreaterThan(0);
        const sceneDoc = await page.evaluate(() => {
          const r = document.querySelector('.scene')!.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
        });
        for (const box of textBoxes) {
          expect(overlapOfBox(sceneDoc, box), `文字「${box.text}」被場景蓋住`).toBeLessThanOrEqual(0.05);
        }

        // 手機與桌機的場景高度：桌機約 50svh（≥ 45%、≤ 60%）、手機約 45svh
        const ratio = (sceneBox!.bottom - sceneBox!.top) / device.viewport.height;
        if (device.viewport.width >= 768) {
          expect(ratio, '桌機場景高占視窗').toBeGreaterThanOrEqual(0.45);
          expect(ratio).toBeLessThanOrEqual(0.62);
        } else {
          expect(ratio, '手機場景高占視窗').toBeGreaterThanOrEqual(0.38);
          expect(ratio).toBeLessThanOrEqual(0.5);
        }
        expect(failed).toEqual([]);
      });
    }
  });
}

// ── 前景看得見（審查：手機的前景幾乎看不見）：用截圖量每一張前景實際畫在場景上的高度 ─────────────

/** 場景截圖的亮度（0–255）。 */
async function sceneLuma(page: Page): Promise<{ luma: Float32Array; width: number; height: number }> {
  const { data, info } = await sharp(await page.locator('.scene').screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const luma = new Float32Array(info.width * info.height);
  for (let i = 0; i < luma.length; i++) luma[i] = 0.2126 * data[i * 3]! + 0.7152 * data[i * 3 + 1]! + 0.0722 * data[i * 3 + 2]!;
  return { luma, width: info.width, height: info.height };
}

/** 門檻：每一張前景看得見的高度（有被畫出來、與沒有它時的截圖差 > 6 的像素所佔的列）至少占場景高的 15%（審查量到第一版手機的石階約 11%、窗櫺與廊柱更少）；差的像素平均至少 8（不是一層淡到看不見的影子）。 */
const MIN_FG_HEIGHT_SHARE = 0.15;
const MIN_FG_CONTRAST = 8;

for (const device of [
  { name: '桌機 1440×900', viewport: { width: 1440, height: 900 } },
  { name: '手機 390×844', viewport: { width: 390, height: 844 } },
]) {
  test.describe(`前景看得見：${device.name}`, () => {
    // 減少動態：沒有飄塵與視差，同一頁連截兩張是同一個畫面
    test.use({ viewport: device.viewport, reducedMotion: 'reduce' });

    for (const item of SCENE_PAGES) {
      test(`${item.name}：每一張前景看得見的高度 ≥ 場景高的 15%，且與背景有亮度差`, async ({ page }) => {
        await page.goto(item.path);
        await page.waitForLoadState('load');
        await page.evaluate(() => Promise.all([...document.querySelectorAll<HTMLImageElement>('.scene img')].map((img) => img.decode().catch(() => undefined))));
        const count = await page.locator('[data-scene-layer="fg"] img').count();
        expect(count, '前景 1–2 張').toBeGreaterThanOrEqual(1);

        const hideAll = '[data-scene-layer="fg"] img { visibility: hidden !important }';
        const base = await (async () => {
          const handle = await page.addStyleTag({ content: hideAll });
          const shot = await sceneLuma(page);
          await handle.evaluate((el) => (el as Element).remove());
          return shot;
        })();

        for (let i = 0; i < count; i++) {
          const asset = await page.locator('[data-scene-layer="fg"] img').nth(i).getAttribute('data-asset');
          const handle = await page.addStyleTag({ content: `${hideAll} [data-scene-layer="fg"] img:nth-of-type(${i + 1}) { visibility: visible !important }` });
          const shot = await sceneLuma(page);
          await handle.evaluate((el) => (el as Element).remove());

          const rows = new Set<number>();
          let changed = 0;
          let sum = 0;
          for (let y = 0; y < shot.height; y++) {
            let inRow = 0;
            for (let x = 0; x < shot.width; x++) {
              const d = Math.abs(shot.luma[y * shot.width + x]! - base.luma[y * shot.width + x]!);
              if (d > 6) {
                inRow++;
                changed++;
                sum += d;
              }
            }
            if (inRow >= 3) rows.add(y);
          }
          const visible = rows.size === 0 ? 0 : Math.max(...rows) - Math.min(...rows) + 1;
          test.info().annotations.push({ type: `fg-${device.viewport.width}`, description: `${item.path} ${asset}: ${(visible / shot.height * 100).toFixed(0)}% 高，亮度差 ${(sum / Math.max(1, changed)).toFixed(1)}` });
          expect(visible / shot.height, `${item.path} 的 ${asset} 看得見的高度占場景高`).toBeGreaterThanOrEqual(MIN_FG_HEIGHT_SHARE);
          expect(sum / Math.max(1, changed), `${item.path} 的 ${asset} 與背景的平均亮度差`).toBeGreaterThanOrEqual(MIN_FG_CONTRAST);
        }
      });
    }
  });
}

test.describe('捲動視差', () => {
  for (const device of [
    { name: '桌機', viewport: { width: 1440, height: 900 } },
    { name: '手機', viewport: { width: 390, height: 844 } },
  ]) {
    test(`${device.name}：捲動後四層位移互不相同（遠景往下、前景往上），回到頂端回到原位`, async ({ page }) => {
      await page.setViewportSize(device.viewport);
      await page.goto('./courses/bajiquan/');
      await expect(page.locator('html')).toHaveAttribute('data-scene-motion', 'on');
      await nextFrames(page);
      const before = Object.fromEntries(await Promise.all(LAYERS.map(async (layer) => [layer, await offsetOf(page, layer)])));
      for (const layer of LAYERS) expect(before[layer]!.y, `${layer} 捲動前在原位`).toBe(0);

      await page.evaluate(() => window.scrollTo(0, 260));
      await nextFrames(page);
      const after = Object.fromEntries(await Promise.all(LAYERS.map(async (layer) => [layer, await offsetOf(page, layer)])));
      const ys = LAYERS.map((layer) => after[layer]!.y);
      expect(new Set(ys.map((y) => y.toFixed(1))).size, `四層位移 ${ys.join('、')} 要互不相同`).toBe(4);
      expect(after.far!.y).toBeGreaterThan(after.mid!.y);
      expect(after.mid!.y).toBeGreaterThan(after.subject!.y);
      expect(after.subject!.y).toBeGreaterThan(after.fg!.y);
      expect(after.subject!.y, '人物與頁面同速').toBeCloseTo(0, 1);

      await page.evaluate(() => window.scrollTo(0, 0));
      await nextFrames(page);
      for (const layer of LAYERS) expect((await offsetOf(page, layer)).y, `${layer} 回到原位`).toBeCloseTo(0, 1);
    });
  }

  test('捲出場景之後位移不再增加（場景離開視窗，層不漂遠）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('./courses/bajiquan/');
    await page.evaluate(() => window.scrollTo(0, 700));
    await nextFrames(page);
    const a = (await offsetOf(page, 'fg')).y;
    await page.evaluate(() => window.scrollTo(0, 1500));
    await nextFrames(page);
    const b = (await offsetOf(page, 'fg')).y;
    expect(b).toBeCloseTo(a, 0);
  });
});

test.describe('滑鼠微傾（桌機）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('指標移到右下角：各層水平位移不同、不超過上限（最大一層 ≤ 14 px），遠景與前景方向相反；移回中央回到原位', async ({ page }) => {
    await page.goto('./courses/bajiquan/');
    await nextFrames(page);
    await page.mouse.move(1430, 880);
    await nextFrames(page);
    const right = Object.fromEntries(await Promise.all(LAYERS.map(async (layer) => [layer, await offsetOf(page, layer)])));
    for (const layer of LAYERS) {
      expect(Math.abs(right[layer]!.x), `${layer} 水平位移上限`).toBeLessThanOrEqual(14.01);
      expect(Math.abs(right[layer]!.y), `${layer} 垂直位移上限`).toBeLessThanOrEqual(14.01);
    }
    const xs = LAYERS.map((layer) => right[layer]!.x);
    expect(new Set(xs.map((x) => x.toFixed(1))).size, `四層水平位移 ${xs.join('、')}`).toBe(4);
    expect(Math.sign(right.far!.x)).toBe(-Math.sign(right.fg!.x));
    expect(Math.abs(right.fg!.x), '前景動最多').toBeGreaterThan(Math.abs(right.far!.x));
    expect(Math.max(...xs.map(Math.abs)), '最大位移在「幾 px 到十幾 px」').toBeGreaterThan(8);

    await page.mouse.move(720, 450);
    await nextFrames(page);
    for (const layer of LAYERS) expect(Math.abs((await offsetOf(page, layer)).x), `${layer} 回到中央`).toBeLessThan(0.6);
  });
});

test.describe('減少動態', () => {
  test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });

  test('不做視差（捲動、滑鼠都不位移）、不飄塵、不載入視差腳本的位移；場景仍在', async ({ page }) => {
    await page.goto('./courses/bajiquan/');
    await expect(page.locator('html')).toHaveAttribute('data-scene-motion', 'off');
    await page.mouse.move(1400, 850);
    await page.evaluate(() => window.scrollTo(0, 300));
    await nextFrames(page, 4);
    for (const layer of LAYERS) {
      const { x, y } = await offsetOf(page, layer);
      expect(x, `${layer} x`).toBe(0);
      expect(y, `${layer} y`).toBe(0);
      expect(await page.evaluate((kind) => document.querySelector<HTMLElement>(`[data-scene-layer="${kind}"]`)!.style.transform, layer), `${layer} 沒有行內 transform`).toBe('');
    }
    // 飄塵不顯示、沒有跑動畫
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.scene__dust')!).display)).toBe('none');
    expect(await page.evaluate(() => document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.target?.closest?.('.scene')).length)).toBe(0);
    await expect(page.locator('.scene img').first()).toBeVisible();
  });

  test('課程總覽：換人沒有交叉淡化的轉場（直接換）', async ({ page }) => {
    await page.goto('./courses/');
    const transition = await page.evaluate(() => getComputedStyle(document.querySelector('.scene__layer--subject .scene__img')!).transitionDuration);
    expect(parseFloat(transition), '全站的減少動態規則把轉場壓到近 0').toBeLessThan(0.01);
  });
});

test.describe('沒有 JavaScript', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });

  test('場景是靜態的一幕：四層都在、圖已載入、沒有位移；標題與內容完整', async ({ page }) => {
    await page.goto('./courses/bajiquan/');
    for (const layer of LAYERS) await expect(page.locator(`[data-scene-layer="${layer}"] img`).first()).toBeVisible();
    const loaded = await page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.scene img')].every((img) => img.complete && img.naturalWidth > 0));
    expect(loaded).toBe(true);
    for (const layer of LAYERS) expect((await offsetOf(page, layer)).y).toBe(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('八極專修');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('課程總覽：所有課程卡的連結都在（換人只是裝飾）', async ({ page }) => {
    await page.goto('./courses/');
    expect(await page.locator('.course-card h3').count()).toBeGreaterThanOrEqual(6);
  });
});

test.describe('課程總覽：滑過或聚焦課程卡，人物換成該課的剪影', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const activeAsset = (page: Page) => page.evaluate(() => document.querySelector('.scene .scene__img.is-active')?.getAttribute('data-asset') ?? null);
  const visibleAssets = (page: Page) =>
    page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.scene__layer--subject .scene__img')].filter((img) => Number(getComputedStyle(img).opacity) > 0.9).map((img) => img.dataset.asset));

  test('預設是站樁的人物；卡片都帶 data-scene-card；滑過換成該卡的人物、離開回到預設', async ({ page }) => {
    await page.goto('./courses/');
    await expect(page.locator('html')).toHaveAttribute('data-scene-motion', 'on');
    const initial = await activeAsset(page);
    expect(initial).toBe('fig-zhenjiao-land');
    expect(await visibleAssets(page)).toEqual([initial]);

    const cards = page.locator('.course-card[data-scene-card]');
    expect(await cards.count()).toBeGreaterThanOrEqual(6);
    // 每一種人物都在場景裡（預先放進去，換人時不用再載）
    const cardAssets = await cards.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.sceneCard));
    const inScene = await page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.scene__layer--subject .scene__img')].map((img) => img.dataset.asset));
    for (const asset of cardAssets) expect(inScene, `場景裡有 ${asset}`).toContain(asset);

    const target = cards.first();
    const expected = await target.getAttribute('data-scene-card');
    await target.scrollIntoViewIfNeeded();
    await target.hover();
    await expect.poll(() => activeAsset(page)).toBe(expected);
    await expect.poll(() => visibleAssets(page)).toEqual([expected]); // 交叉淡化完成後只剩這一張

    await page.mouse.move(5, 450);
    await expect.poll(() => activeAsset(page)).toBe(initial);
    await expect.poll(() => visibleAssets(page)).toEqual([initial]);
  });

  test('鍵盤聚焦課程卡的連結也會換人；焦點離開回到預設', async ({ page }) => {
    await page.goto('./courses/');
    const card = page.locator('.course-card[data-scene-card]').nth(1);
    const expected = await card.getAttribute('data-scene-card');
    await card.locator('a').first().focus();
    await expect.poll(() => activeAsset(page)).toBe(expected);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect.poll(() => activeAsset(page)).toBe('fig-zhenjiao-land');
  });
});

test.describe('場景不影響既有的互動', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('場景不接收指標事件（pointer-events: none）、不可聚焦、整塊 aria-hidden；Tab 不會停在場景裡', async ({ page }) => {
    await page.goto('./courses/');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.scene')!).pointerEvents === 'none' || [...document.querySelectorAll<HTMLElement>('.scene *')].every((el) => getComputedStyle(el).pointerEvents === 'none'))).toBe(true);
    expect(await page.evaluate(() => document.querySelectorAll('.scene [tabindex], .scene a, .scene button').length)).toBe(0);
  });
});
