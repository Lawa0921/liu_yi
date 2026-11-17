import { describe, expect, it } from 'vitest';
import { groundVertex } from '../../src/qi/engine/shaders/ground';
import { COVERAGE_REFERENCE_PX_PER_UNIT, coverageOf, CREST_GRAIN, DENSE_POWER, denseFade, GRAIN, POINT_PX, pointsFragment, pointsVertex } from '../../src/qi/engine/shaders/points';
import { velocityShader } from '../../src/qi/engine/shaders/velocity';
import {
  CAMERA_SHAKE,
  EXHALE,
  INHALE,
  INHALE_EXPONENT,
  SHOCK,
  STREAK,
  SECOND_RING,
  SNAP_DAMP_GAIN,
  burstSpeed,
  cameraShake,
  inhaleAcc,
  inhaleDamp,
  inhaleStreak,
  shockwave,
  shockwaveSecond,
  streakLength,
} from '../../src/qi/engine/effects';

describe('shockwave（落地衝擊波，第一圈）', () => {
  it('t = 0：半徑 0.25、寬 0.12、振幅 3.5、白閃 0.6', () => {
    const s = shockwave(0);
    expect(s.radius).toBe(0.25);
    expect(s.width).toBeCloseTo(0.12, 10);
    expect(s.amp).toBe(3.5);
    expect(s.flash).toBeCloseTo(0.6, 10);
  });

  it('t = 0.5：半徑 0.25 + 3.6t − 0.35t² = 1.9625，寬 0.12 + 0.2t = 0.22，振幅 3.5·e^(−1.5t)，白閃 0.6·e^(−6t)', () => {
    // 簡報寫 ≈ 2.0125（算式 0.25+1.8−0.0875），但這個算式的值是 1.9625；公式與試作的著色器一致，所以以公式為準。
    const s = shockwave(0.5);
    expect(s.radius).toBeCloseTo(0.25 + 1.8 - 0.0875, 10);
    expect(s.radius).toBeCloseTo(1.9625, 10);
    expect(s.width).toBeCloseTo(0.22, 10);
    expect(s.amp).toBeCloseTo(3.5 * Math.exp(-0.75), 10);
    expect(s.flash).toBeCloseTo(0.6 * Math.exp(-3), 10);
  });

  it('半徑隨時間遞增（0–1 s）；振幅與白閃單調遞減', () => {
    let prev = shockwave(0);
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const s = shockwave(t);
      expect(s.radius).toBeGreaterThan(prev.radius);
      expect(s.amp).toBeLessThan(prev.amp);
      expect(s.flash).toBeLessThan(prev.flash);
      prev = s;
    }
  });

  it('t < 0（還沒落地）：振幅與白閃為 0，半徑寬度停在起點（不倒推）', () => {
    const s = shockwave(-1);
    expect(s.amp).toBe(0);
    expect(s.flash).toBe(0);
    expect(s.radius).toBe(0.25);
    expect(s.width).toBeCloseTo(0.12, 10);
  });

  it('非有限的時間視為還沒落地', () => {
    expect(shockwave(Number.NaN).amp).toBe(0);
    expect(shockwave(Number.NEGATIVE_INFINITY).amp).toBe(0);
  });
});

describe('shockwaveSecond（第二圈：延後 0.12 s、振幅 ×0.6、沒有白閃）', () => {
  it('延後常數是 0.12 s、增益 0.6', () => {
    expect(SECOND_RING).toEqual({ delay: 0.12, gain: 0.6 });
  });

  it('第二圈在 t 的狀態 = 第一圈在 t − 0.12 的狀態（振幅 ×0.6）', () => {
    const first = shockwave(0.4 - 0.12);
    const second = shockwaveSecond(0.4);
    expect(second.radius).toBeCloseTo(first.radius, 10);
    expect(second.width).toBeCloseTo(first.width, 10);
    expect(second.amp).toBeCloseTo(first.amp * 0.6, 10);
    expect(second.flash).toBe(0);
  });

  it('第一圈出發後 0.12 s 內第二圈還沒出發（振幅 0），之後才有', () => {
    expect(shockwaveSecond(0).amp).toBe(0);
    expect(shockwaveSecond(0.11).amp).toBe(0);
    expect(shockwaveSecond(0.12).amp).toBeCloseTo(3.5 * 0.6, 10);
    expect(shockwaveSecond(-1).amp).toBe(0);
  });

  it('第二圈永遠落後第一圈（同一刻半徑比較小）', () => {
    for (const t of [0.2, 0.5, 1, 2]) expect(shockwaveSecond(t).radius).toBeLessThan(shockwave(t).radius);
  });
});

describe('SNAP_DAMP_GAIN（落地「啪」時阻尼跟著彈簧走）', () => {
  it('彈簧 ×2.2 時阻尼 ×√2.2：阻尼比（阻尼 / 2√彈簧）不變', () => {
    expect(SNAP_DAMP_GAIN ** 2).toBeCloseTo(2.2, 10);
    expect(SNAP_DAMP_GAIN).toBeGreaterThan(1);
  });
});

describe('cameraShake（落地的鏡頭震幅 0.08，0.8 s 內回到 0）', () => {
  it('起點是 0.08（試作是 0.05，落地要更強）', () => {
    expect(CAMERA_SHAKE.amplitude).toBe(0.08);
    expect(cameraShake(0)).toBeCloseTo(0.08, 10);
  });

  it('單調遞減，0.8 s 起恰為 0；落地前（t < 0）也是 0', () => {
    let prev = cameraShake(0);
    for (let t = 0.05; t < 0.8; t += 0.05) {
      const k = cameraShake(t);
      expect(k).toBeLessThan(prev);
      expect(k).toBeGreaterThan(0);
      prev = k;
    }
    expect(cameraShake(0.8)).toBe(0);
    expect(cameraShake(5)).toBe(0);
    expect(cameraShake(-0.1)).toBe(0);
    expect(cameraShake(Number.NaN)).toBe(0);
  });
});

describe('streakLength（點沿速度方向拉長的倍數）', () => {
  it('不動 = 1 倍；速度 4 以上封頂在 3.6 倍', () => {
    expect(streakLength(0)).toBe(1);
    expect(streakLength(4)).toBe(3.6);
    expect(streakLength(40)).toBe(3.6);
  });

  it('中間值：1 + clamp(速度 × 0.25, 0, 1) × 2.6，且單調不減', () => {
    expect(streakLength(2)).toBeCloseTo(1 + 0.5 * 2.6, 10);
    let prev = streakLength(0);
    for (let v = 0.25; v <= 6; v += 0.25) {
      const l = streakLength(v);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });

  it('負值與非有限的速度不拉長（1 倍）', () => {
    expect(streakLength(-3)).toBe(1);
    expect(streakLength(Number.NaN)).toBe(1);
  });
});

describe('burstSpeed（換招衝量之後，光點速度的估計；拿來決定 uStreak 的上限）', () => {
  it('衝量那一刻最快，之後依阻尼指數衰減；力道越大越快', () => {
    expect(burstSpeed(3.2, 0)).toBeGreaterThan(burstSpeed(3.2, 0.1));
    expect(burstSpeed(3.2, 0.1)).toBeGreaterThan(burstSpeed(3.2, 0.5));
    expect(burstSpeed(3.6, 0.2)).toBeGreaterThan(burstSpeed(1.8, 0.2));
  });

  it('沒有衝量（力道 0）、還沒發生（t < 0）、非有限的輸入 → 0', () => {
    expect(burstSpeed(0, 0.1)).toBe(0);
    expect(burstSpeed(3, -0.1)).toBe(0);
    expect(burstSpeed(Number.NaN, 0.1)).toBe(0);
    expect(burstSpeed(3, Number.NaN)).toBe(0);
  });

  it('換招峰值（頂肘 3.2、衝量後 0.1 s）拉得出明顯的拖尾（> 1.5 倍）；1 秒後收回接近 1 倍', () => {
    expect(streakLength(burstSpeed(3.2, 0.1))).toBeGreaterThan(1.5);
    expect(streakLength(burstSpeed(3.2, 1))).toBeLessThan(1.1);
  });
});

describe('inhaleStreak（吸氣流線的拖尾上限）', () => {
  it('吸氣開始與結束都是 1 倍（不拉長），前段（INHALE.peak）最長', () => {
    expect(inhaleStreak(0)).toBe(1);
    expect(inhaleStreak(1)).toBe(1);
    expect(inhaleStreak(INHALE.peak)).toBeCloseTo(1 + INHALE.streak, 10);
    expect(inhaleStreak(INHALE.peak)).toBeGreaterThan(1.5);
    expect(inhaleStreak(INHALE.peak)).toBeGreaterThan(inhaleStreak(0.1));
    expect(inhaleStreak(INHALE.peak)).toBeGreaterThan(inhaleStreak(0.8));
  });

  it('輸入夾在 0–1；非有限視為 0', () => {
    expect(inhaleStreak(-1)).toBe(1);
    expect(inhaleStreak(2)).toBe(1);
    expect(inhaleStreak(Number.NaN)).toBe(1);
  });
});

describe('inhaleDamp（吸氣階段的阻尼）', () => {
  it('進度 0 是基底阻尼；進度 1 是 dampEnd；中間單調上升', () => {
    expect(inhaleDamp(3, 0)).toBe(3);
    expect(inhaleDamp(3, 1)).toBeCloseTo(INHALE.dampEnd, 10);
    let prev = inhaleDamp(3, 0);
    for (let t = 0.1; t <= 1.0001; t += 0.1) {
      const d = inhaleDamp(3, t);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });

  it('夾在 0–1、非有限視為 0；基底已經比 dampEnd 大時不會變小（向 dampEnd 靠，不是取最大）', () => {
    expect(inhaleDamp(3, -1)).toBe(3);
    expect(inhaleDamp(3, 5)).toBeCloseTo(INHALE.dampEnd, 10);
    expect(inhaleDamp(3, Number.NaN)).toBe(3);
    expect(inhaleDamp(INHALE.dampEnd, 0.5)).toBeCloseTo(INHALE.dampEnd, 10);
  });
});

describe('inhaleAcc（開場吸氣：往中心的加速度，含少量旋轉）', () => {
  it('在 +x 的光點被往 −x 拉（x 分量 < 0）；在 −x 的光點被往 +x 拉', () => {
    expect(inhaleAcc([2, 0, 0], 0.5)[0]).toBeLessThan(0);
    expect(inhaleAcc([-2, 0, 0], 0.5)[0]).toBeGreaterThan(0);
  });

  it('上下前後也往中心：y、z 分量的正負與位置相反', () => {
    expect(inhaleAcc([0, 2, 0], 0.5)[1]).toBeLessThan(0);
    expect(inhaleAcc([0, -2, 0], 0.5)[1]).toBeGreaterThan(0);
    expect(inhaleAcc([0, 0, 2], 0.5)[2]).toBeLessThan(0);
  });

  it('正好在中心：有限且接近 0（不會除以零）', () => {
    const a = inhaleAcc([0, 0, 0], 0.5);
    for (const v of a) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThan(1e-6);
    }
  });

  it('|p| 越遠越強（向心分量）', () => {
    const at = (r: number) => -inhaleAcc([r, 0, 0], 0.5)[0];
    expect(at(0.5)).toBeLessThan(at(1));
    expect(at(1)).toBeLessThan(at(2));
    expect(at(2)).toBeLessThan(at(3));
  });

  it('含少量旋轉：繞 y 軸的切向分量不為 0，但比向心分量小得多', () => {
    const [ax, , az] = inhaleAcc([2, 0, 0], 0.5);
    expect(Math.abs(az)).toBeGreaterThan(0);
    expect(Math.abs(az)).toBeLessThan(Math.abs(ax) * 0.5);
  });

  it('進度 t 為 0 或 1（吸氣的頭尾）強度為 0，前段（INHALE.peak）最強、後段收掉；夾在 0–1', () => {
    const mag = (t: number) => Math.hypot(...inhaleAcc([2, 0, 0], t));
    expect(mag(0)).toBe(0);
    expect(mag(1)).toBeLessThan(1e-9);
    expect(mag(INHALE.peak)).toBeGreaterThan(mag(0.1));
    expect(mag(INHALE.peak)).toBeGreaterThan(mag(0.6));
    expect(mag(0.9), '後段不再往中心拉').toBeLessThan(mag(INHALE.peak) * 0.3);
    expect(mag(-1)).toBe(0);
    expect(mag(7)).toBeLessThan(1e-9);
  });

  it('常數：向心強度基準與旋轉比例集中在 INHALE', () => {
    expect(INHALE.pull).toBeGreaterThan(0);
    expect(INHALE.swirl).toBeGreaterThan(0);
    expect(INHALE.swirl).toBeLessThan(INHALE.pull);
  });
});

describe('著色器與這裡的公式同步（GLSL 是字串，改了常數要連同著色器一起走）', () => {
  it('速度著色器的吸氣公式用的是 INHALE 的常數與包絡指數', () => {
    const f = (n: number) => n.toFixed(3);
    expect(velocityShader).toContain(`${f(INHALE.pull)}*(${f(INHALE.floor)}+(1.0-${f(INHALE.floor)})*smoothstep(0.0,${f(INHALE.reach)},r))`);
    expect(velocityShader).toContain(`${f(INHALE.swirl)}*env/(r+${f(INHALE.softening)})`);
    expect(velocityShader).toContain(`pow(t,${INHALE_EXPONENT.toFixed(4)})`);
    expect(velocityShader).toContain('if(uInhale>0.0&&!ambient)'); // 環境煙不吸（彈簧太鬆，吸進去要很久才飄得回來）
  });

  it('包絡指數讓進度 INHALE.peak 剛好是頂點（peak ^ 指數 = 0.5）', () => {
    expect(INHALE.peak ** INHALE_EXPONENT).toBeCloseTo(0.5, 10);
  });

  it('點著色器的拖尾用 STREAK 的常數（速度尺 0.25、倍數 2.6、長寬比）並受 uStreak 限制；片段著色器依 vDir 畫橢圓', () => {
    const f = (n: number) => n.toFixed(3);
    expect(pointsVertex).toContain(`length(vel)*${f(STREAK.speedScale)}`);
    expect(pointsVertex).toContain(`min(1.0+speed*${f(STREAK.gain)},max(uStreak,1.0))`);
    expect(pointsVertex).toContain(`(stretch-1.0)*${f(STREAK.aspect)}`);
    expect(pointsFragment).toContain('dot(q,vDir)');
    expect(pointsFragment).toContain('vAspect');
  });

  it('顆粒（GRAIN）只對非 CREST 生效：館徽（kind > 8.5）的顆粒是 CREST_GRAIN（0），kind 在算位置之前就讀好（Task 25 審查：館徽被抖散會糊成一片）', () => {
    expect(GRAIN).toBe(0.02);
    expect(CREST_GRAIN).toBe(0);
    expect(pointsVertex).toContain(`float grain=kind>8.5?${CREST_GRAIN.toFixed(4)}:${GRAIN.toFixed(4)};`);
    expect(pointsVertex).toContain('(hash32(ref*613.7+seed)-0.5)*grain');
    // kind 在 pos 之前宣告（pos 要用 grain，grain 要用 kind），而且只宣告一次
    expect(pointsVertex.indexOf('float kind=p.w;')).toBeGreaterThan(-1);
    expect(pointsVertex.indexOf('float kind=p.w;')).toBeLessThan(pointsVertex.indexOf('vec3 pos='));
    expect(pointsVertex.split('float kind=').length - 1).toBe(1);
  });

  it('地面著色器用 SHOCK.amp0 把圈的亮度換算成 0–1，並輸出共用片段著色器要的 vDir、vAspect', () => {
    expect(groundVertex).toContain(`ring/${SHOCK.amp0.toFixed(3)}`);
    expect(groundVertex).toContain('vDir=vec2(1.0,0.0)');
    expect(groundVertex).toContain('vAspect=1.0');
  });

  it('吐氣：力道是 BURSTS.lift 的倍數，大於 1（散得夠遠，吸氣才有一段流回來的路）', () => {
    expect(EXHALE.gain).toBeGreaterThan(1);
  });
});

describe('coverageOf／denseFade（密集的兵器點依「點數 × 點面積 / 兵器的螢幕面積」調淡）', () => {
  const REF = COVERAGE_REFERENCE_PX_PER_UNIT;
  // 取景（stage.ts fit）：橫向 visibleH = max(3.4, 5.9 / aspect)，直向 max(3.4, 2.75 / aspect)；px／單位 = CSS 高 / visibleH
  const pxPerUnit = (w: number, h: number) => h / (w >= h ? Math.max(3.4, 5.9 / (w / h)) : Math.max(3.4, 2.75 / (w / h)));

  it('對照視窗（1280×720）的高階桌機是 4（就是形體檔重複的倍數）', () => {
    expect(REF).toBeCloseTo(pxPerUnit(1280, 720), 6);
    expect(coverageOf(256 * 256, POINT_PX.rich, pxPerUnit(1280, 720))).toBeCloseTo(4, 10);
  });

  it('點徑大、點數少的手機 low 比只看點數（1.27）高；直向取景小，同一件兵器佔的螢幕面積小，重疊更多', () => {
    const byCount = (144 * 144) / 16384;
    const lowPhone = coverageOf(144 * 144, POINT_PX.lite, pxPerUnit(390, 844));
    expect(pxPerUnit(390, 844)).toBeCloseTo(141.8, 0);
    expect(lowPhone).toBeGreaterThan(byCount * (POINT_PX.lite / POINT_PX.rich) ** 2); // 連點徑都算進去還要高：取景也算
    expect(lowPhone).toBeGreaterThan(3.5); // 約 4，和對照視窗的高階桌機差不多
  });

  it('同一個 tier 與點徑：螢幕上每單位的像素愈少（取景愈遠）覆蓋密度愈高', () => {
    expect(coverageOf(10000, 2.2, 100)).toBeGreaterThan(coverageOf(10000, 2.2, 200));
  });

  it('denseFade：覆蓋密度越高越淡、上限 1（不加亮）；高階桌機約 0.38', () => {
    expect(denseFade(0.5)).toBe(1);
    expect(denseFade(1)).toBe(1);
    expect(denseFade(4)).toBeCloseTo(4 ** -DENSE_POWER, 10);
    expect(denseFade(4)).toBeCloseTo(0.38, 2);
    expect(denseFade(2)).toBeGreaterThan(denseFade(4));
  });

  it('手機 low 比只看點數時淡很多（Task 16 審查：手機槍頭燒白），和高階桌機差不多（約 0.38）；min 桌機不變（1）', () => {
    const lowByCount = denseFade((144 * 144) / 16384);
    const low = denseFade(coverageOf(144 * 144, POINT_PX.lite, pxPerUnit(390, 844)));
    expect(lowByCount).toBeGreaterThan(0.8);
    expect(low).toBeLessThan(0.45);
    expect(denseFade(coverageOf(112 * 112, POINT_PX.lite, pxPerUnit(1440, 900)))).toBe(1);
  });

  it('著色器用 uCoverage 與同一個 DENSE_POWER', () => {
    expect(pointsVertex).toContain('uniform float uCoverage;');
    expect(pointsVertex).toContain(`pow(max(uCoverage,0.01),-${DENSE_POWER.toFixed(3)})`);
  });
});
