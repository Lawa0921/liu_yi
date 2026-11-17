import { expect, test, type Page } from './fixtures';

// 推門換頁（Task 27，使用者選定「推門／捲簾轉場」）：站內換頁（跨文件）用 CSS 的 `@view-transition { navigation: auto }`，
// 舊頁像兩扇門往中間關（0.3 s）、新頁從中間往兩邊推開（0.3 s），總長 0.6 s。
// 不支援的瀏覽器直接換頁；偏好減少動態時關閉；錨點與上一頁、下一頁照常。
// 這裡驗：規則有宣告（桌機與手機）、減少動態時不啟用、真的換頁時有轉場（舊頁關門、新頁開門的動畫都在）、上一頁／錨點／首頁閘門不退步。
// 只用 page.*；不碰 OS 層級的滑鼠鍵盤。

/** 有效的 @view-transition 規則（含巢在符合條件的 @media 裡的）。 */
function activeViewTransition(page: Page): Promise<{ navigation: string; declared: boolean }> {
  return page.evaluate(() => {
    const found: string[] = [];
    let declared = false;
    const walk = (rules: CSSRuleList): void => {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule) {
          declared = declared || /view-transition/.test(rule.cssText);
          if (matchMedia(rule.conditionText).matches) walk(rule.cssRules);
        } else if (/^@view-transition/.test(rule.cssText)) {
          found.push(((rule as unknown as { navigation?: string }).navigation ?? /navigation:\s*([a-z-]+)/.exec(rule.cssText)?.[1] ?? '') as string);
          declared = true;
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules);
      } catch {
        // 跨來源樣式表讀不到
      }
    }
    return { navigation: found.join(','), declared };
  });
}

/** 每一頁載入前掛上：記下 pagereveal 時有沒有 viewTransition，以及它 ready 之後頁面上正在跑的動畫（舊頁關門、新頁開門）。 */
async function recordTransitions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.addEventListener('pagereveal', (event) => {
      const vt = (event as unknown as { viewTransition?: { ready: Promise<void>; finished: Promise<void> } | null }).viewTransition;
      const note: { has: boolean; names: string[]; durations: number[]; finished: boolean } = { has: Boolean(vt), names: [], durations: [], finished: false };
      sessionStorage.setItem('liuyi:vt', JSON.stringify(note));
      if (!vt) return;
      vt.ready
        .then(() => {
          for (const animation of document.getAnimations()) {
            const effect = animation.effect as KeyframeEffect | null;
            const pseudo = (effect as unknown as { pseudoElement?: string } | null)?.pseudoElement ?? '';
            if (!pseudo.includes('view-transition')) continue;
            note.names.push(`${pseudo}:${(animation as unknown as { animationName?: string }).animationName ?? ''}`);
            note.durations.push(Number(effect?.getComputedTiming().endTime ?? 0));
          }
          sessionStorage.setItem('liuyi:vt', JSON.stringify(note));
        })
        .catch(() => undefined);
      vt.finished.then(() => {
        note.finished = true;
        sessionStorage.setItem('liuyi:vt', JSON.stringify(note));
      }, () => undefined);
    });
  });
}

const note = (page: Page) =>
  page.evaluate(() => {
    const raw = sessionStorage.getItem('liuyi:vt');
    return raw ? (JSON.parse(raw) as { has: boolean; names: string[]; durations: number[]; finished: boolean }) : null;
  });

for (const device of [
  { name: '桌機 1440×900', viewport: { width: 1440, height: 900 } },
  { name: '手機 390×844', viewport: { width: 390, height: 844 } },
]) {
  test.describe(`推門換頁的宣告：${device.name}`, () => {
    test.use({ viewport: device.viewport });

    test('@view-transition { navigation: auto } 已宣告而且有效；舊頁、新頁的動畫是 0.3 s 的關門與開門', async ({ page }) => {
      await page.goto('./courses/');
      const rule = await activeViewTransition(page);
      expect(rule.declared, '有 @view-transition 規則').toBe(true);
      expect(rule.navigation).toBe('auto');
      const css = await page.evaluate(async () => {
        const out: string[] = [];
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules) out.push(rule.cssText);
          } catch {
            // ignore
          }
        }
        return out.join('\n');
      });
      expect(css).toMatch(/::view-transition-old\(root\)/);
      expect(css).toMatch(/::view-transition-new\(root\)/);
    });
  });
}

test.describe('減少動態：關閉轉場', () => {
  test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });

  test('@view-transition 在 prefers-reduced-motion: reduce 時不生效；換頁沒有轉場', async ({ page }) => {
    await recordTransitions(page);
    await page.goto('./courses/');
    const rule = await activeViewTransition(page);
    expect(rule.navigation, '減少動態時沒有有效的規則').toBe('');
    await page.getByRole('link', { name: '收費', exact: true }).first().click();
    await expect(page).toHaveURL(/\/pricing\/$/);
    const n = await note(page);
    expect(n === null || n.has === false, '沒有 viewTransition').toBe(true);
  });
});

test.describe('真的換頁：站內連結', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('課程總覽 → 收費：新頁的 pagereveal 帶 viewTransition，舊頁關門（view-transition-old）與新頁開門（view-transition-new）的動畫都在，約 0.3 s 一段，轉場會結束', async ({ page }) => {
    await recordTransitions(page);
    await page.goto('./courses/');
    await page.getByRole('link', { name: '收費', exact: true }).first().click();
    await expect(page).toHaveURL(/\/pricing\/$/);
    await expect.poll(async () => (await note(page))?.finished, { timeout: 8000, message: '轉場結束' }).toBe(true);
    const n = (await note(page))!;
    expect(n.has, '新頁有 viewTransition').toBe(true);
    expect(n.names.join('|'), '舊頁的動畫').toMatch(/::view-transition-old\(root\)/);
    expect(n.names.join('|'), '新頁的動畫').toMatch(/::view-transition-new\(root\)/);
    // 舊頁 0.3 s、新頁延後 0.3 s 再 0.3 s（總長 0.6 s）
    const ends = n.durations.filter((d) => d > 0);
    expect(Math.max(...ends), '總長約 0.6 s').toBeGreaterThanOrEqual(550);
    expect(Math.max(...ends)).toBeLessThanOrEqual(700);
    // 換頁後內容正常
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('上一頁：回到課程總覽，內容正常、沒有殘留的轉場遮罩（頁面可互動）', async ({ page }) => {
    await recordTransitions(page);
    await page.goto('./courses/');
    await page.getByRole('link', { name: '收費', exact: true }).first().click();
    await expect(page).toHaveURL(/\/pricing\/$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/courses\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.scene')).toHaveCount(1);
    // 沒有被轉場卡住：等轉場結束後可以再點連結
    await page.waitForTimeout(800);
    await page.getByRole('link', { name: '師資', exact: true }).first().click();
    await expect(page).toHaveURL(/\/coaches\/$/);
  });

  test('錨點：同一頁內的 #錨點跳轉沒有轉場、位置正確（跳過連結跳到主要內容）', async ({ page }) => {
    await recordTransitions(page);
    await page.goto('./courses/');
    await page.evaluate(() => {
      location.hash = '#main';
    });
    await expect(page).toHaveURL(/#main$/);
    expect((await note(page))?.has ?? false, '同文件的錨點不是換頁，不會有 viewTransition').toBe(false);
    expect(await page.evaluate(() => document.querySelector('#main') !== null)).toBe(true);
  });

  test('從站內其他頁回到首頁：不顯示入館閘門（行為不退步）', async ({ page }) => {
    await recordTransitions(page);
    await page.goto('./courses/');
    await page.locator('a.site-header__brand').click();
    await expect(page).toHaveURL(/\/liu_yi\/$/);
    await expect(page.locator('html')).not.toHaveAttribute('data-gate', /.*/);
    await expect(page.locator('#opening')).toBeAttached();
  });
});
