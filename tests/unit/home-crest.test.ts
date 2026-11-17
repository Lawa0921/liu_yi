import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CREST_FAILSAFE_MS, SHEEN_MAX, SHEEN_MIN, sheenPoint } from '../../src/scripts/home/crest-sheen';
import { INTRO_STORAGE_KEY } from '../../src/scripts/home/intro-gate';

// 館徽掃光的換算（Task 24）：指標位置 → 館徽盒子內的百分比（寫進 --sheen-x／--sheen-y）。接線與樣子由 e2e（home-crest.spec）驗。
const box = { left: 100, top: 200, width: 200, height: 100 };

describe('sheenPoint', () => {
  it('指標在館徽正中央 → 50%／50%；左上角 → 0%／0%；右下角 → 100%／100%', () => {
    expect(sheenPoint(box, 200, 250)).toEqual({ x: 50, y: 50 });
    expect(sheenPoint(box, 100, 200)).toEqual({ x: 0, y: 0 });
    expect(sheenPoint(box, 300, 300)).toEqual({ x: 100, y: 100 });
  });

  it('指標在館徽外面也有值（掃光從外面滑進來），但夾在 [-30%, 130%]：太遠就不再往外跑', () => {
    expect(sheenPoint(box, 100 - 20, 250)?.x).toBeCloseTo(-10, 5);
    expect(sheenPoint(box, -5000, -5000)).toEqual({ x: SHEEN_MIN, y: SHEEN_MIN });
    expect(sheenPoint(box, 9000, 9000)).toEqual({ x: SHEEN_MAX, y: SHEEN_MAX });
    expect([SHEEN_MIN, SHEEN_MAX]).toEqual([-30, 130]);
  });

  it('盒子沒有大小（display:none 的館徽）→ null，不寫任何值', () => {
    expect(sheenPoint({ left: 0, top: 0, width: 0, height: 0 }, 10, 10)).toBeNull();
    expect(sheenPoint({ left: 0, top: 0, width: 100, height: 0 }, 10, 10)).toBeNull();
  });
});

describe('館徽掃光不是 background-clip:text 的漸層字（全站守門）', () => {
  const css = readFileSync(new URL('../../src/styles/home.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const crestCss = css
    .split('}')
    .filter((rule) => rule.includes('opening__crest'))
    .join('}');

  it('館徽相關的規則沒有 background-clip，也沒有 text-shadow／外發光的 box-shadow', () => {
    expect(crestCss).not.toMatch(/background-clip/);
    expect(crestCss).not.toMatch(/text-shadow|box-shadow/);
  });

  it('掃光用漸層遮罩（mask-image）蓋在 logo 上，不是混色模式', () => {
    expect(crestCss).toMatch(/mask-image\s*:[^;]*gradient/);
    expect(crestCss).not.toMatch(/mix-blend-mode/);
  });
});

describe('館徽的露出時機', () => {
  it('<head> 的行內腳本用開場閘門同一把鍵標 data-qi-crest="shown"（再訪的首繪就是終態，不等腳本）', () => {
    const layout = readFileSync(new URL('../../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');
    expect(layout).toContain(`getItem('${INTRO_STORAGE_KEY}') === '1'`);
    expect(layout).toMatch(/root\.dataset\.qiCrest = 'shown'/);
  });

  it('逾時保險是 7 秒左右（引擎卡住時館徽不能永遠不見，也不能在開場演到落地之前就先出現）', () => {
    expect(CREST_FAILSAFE_MS).toBeGreaterThanOrEqual(6000);
    expect(CREST_FAILSAFE_MS).toBeLessThanOrEqual(8000);
  });

  it('擦出與閃光的動畫只掛在 data-qi-crest="in"（落地），其餘露出方式沒有動畫', () => {
    const css = readFileSync(new URL('../../src/styles/home.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const name of ['crest-wipe', 'crest-flash']) {
      const users = css.split('}').filter((rule) => new RegExp(`animation\\s*:\\s*${name}\\b`).test(rule));
      expect(users, `${name} 有人用`).not.toHaveLength(0);
      for (const rule of users) expect(rule, `${name} 只在 [data-qi-crest='in'] 下播`).toContain("[data-qi-crest='in']");
    }
  });
});
