import { describe, expect, it } from 'vitest';
import { mountDelayMs, planRendering, shouldLoad3d, type DeviceFacts } from '../../src/lib/arsenal/capability';

const desktop: DeviceFacts = {
  webgl: true,
  viewportWidth: 1440,
  devicePixelRatio: 2,
  reducedMotion: false,
  coarsePointer: false,
};
const phone: DeviceFacts = { ...desktop, viewportWidth: 390, devicePixelRatio: 3, coarsePointer: true };

describe('planRendering：能力偵測與降級決策', () => {
  it('沒有 WebGL → 退回線稿', () => {
    expect(planRendering({ ...desktop, webgl: false }).mode).toBe('fallback');
    expect(planRendering({ ...phone, webgl: false }).mode).toBe('fallback');
  });

  it('桌機：3D、陰影開、像素比最多 2', () => {
    const plan = planRendering(desktop);
    expect(plan).toMatchObject({ mode: '3d', shadows: true, pixelRatio: 2, autoMotion: true, slash: true, stomp: true });
    expect(planRendering({ ...desktop, devicePixelRatio: 3 }).pixelRatio).toBe(2);
    expect(planRendering({ ...desktop, devicePixelRatio: 1 }).pixelRatio).toBe(1);
  });

  it('手機：仍是 3D，但像素比上限較低、關陰影', () => {
    const plan = planRendering(phone);
    expect(plan.mode).toBe('3d');
    expect(plan.shadows).toBe(false);
    expect(plan.pixelRatio).toBeLessThanOrEqual(1.5);
    expect(plan.pixelRatio).toBeGreaterThanOrEqual(1);
  });

  it('窄視窗或觸控任一成立就算手機規格', () => {
    expect(planRendering({ ...desktop, viewportWidth: 700 }).shadows).toBe(false);
    expect(planRendering({ ...desktop, coarsePointer: true }).shadows).toBe(false);
  });

  it('減少動態：仍是 3D（可拖曳），但不自動轉、不出刀光、不震', () => {
    const plan = planRendering({ ...desktop, reducedMotion: true });
    expect(plan).toMatchObject({ mode: '3d', autoMotion: false, slash: false, stomp: false });
  });

  it('省流量模式：再降一級像素比', () => {
    expect(planRendering({ ...phone, saveData: true }).pixelRatio).toBe(1);
  });

  it('像素比異常值（0、NaN）當成 1', () => {
    expect(planRendering({ ...desktop, devicePixelRatio: 0 }).pixelRatio).toBe(1);
    expect(planRendering({ ...desktop, devicePixelRatio: Number.NaN }).pixelRatio).toBe(1);
  });
});

describe('shouldLoad3d：什麼時候才下載 three', () => {
  const base = { visibleRatio: 0, distance: 2000, viewportHeight: 900, hasScrolled: false };

  it('首屏時 3D 區塊只在視窗下緣露出一條邊：不載', () => {
    expect(shouldLoad3d({ ...base, visibleRatio: 0.07, distance: 0 })).toBe(false);
  });

  it('還沒捲動、區塊在視窗外：不載', () => {
    expect(shouldLoad3d({ ...base, distance: 300 })).toBe(false);
  });

  it('一進頁面區塊就大半在視窗內：載', () => {
    expect(shouldLoad3d({ ...base, visibleRatio: 0.5, distance: 0 })).toBe(true);
  });

  it('捲動過、而且區塊在一個視窗高度以內：載', () => {
    expect(shouldLoad3d({ ...base, hasScrolled: true, distance: 600 })).toBe(true);
    expect(shouldLoad3d({ ...base, hasScrolled: true, visibleRatio: 0.07, distance: 0 })).toBe(true);
  });

  it('捲動過但還很遠：不載', () => {
    expect(shouldLoad3d({ ...base, hasScrolled: true, distance: 3000 })).toBe(false);
  });
});

describe('mountDelayMs：看到之後等多久才建立 3D', () => {
  it('兵器台與課程頁的單件：一接近就建', () => {
    expect(mountDelayMs('stage')).toBe(0);
    expect(mountDelayMs('single')).toBe(0);
  });

  it('課程卡：要在畫面上停留一下才建（建立時會佔住主執行緒，不該卡到剛進頁面就在操作的人）', () => {
    expect(mountDelayMs('card')).toBeGreaterThanOrEqual(800);
    expect(mountDelayMs('card')).toBeLessThanOrEqual(2000);
  });

  it('不認得的模式當成一般的', () => {
    expect(mountDelayMs('whatever')).toBe(0);
    expect(mountDelayMs(undefined)).toBe(0);
  });
});
