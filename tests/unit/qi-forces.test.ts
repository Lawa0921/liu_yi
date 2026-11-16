import { describe, expect, it } from 'vitest';
import { forcesFor, SPRING, switchScatter } from '../../src/qi/engine/forces';

/** 靜止的基準輸入：沒散開、沒捲動、衝量早已過去、沒有 snap、沒有開場。 */
const REST = { scatter: 0, scrollSpeed: 0, sinceBurst: 99, burstHold: 1, snap: false } as const;

describe('SPRING', () => {
  it('試作的 26', () => {
    expect(SPRING).toBe(26);
  });
});

describe('forcesFor：spring', () => {
  it('靜止：spring 就是 SPRING', () => {
    expect(forcesFor(REST).spring).toBeCloseTo(SPRING, 10);
  });

  it('scatter = 1：彈簧只剩 18%（SPRING·(1−0.82) = 4.68）', () => {
    expect(forcesFor({ ...REST, scatter: 1 }).spring).toBeCloseTo(SPRING * (1 - 0.82), 10);
    expect(forcesFor({ ...REST, scatter: 1 }).spring).toBeCloseTo(4.68, 10);
  });

  it('scatter 在 0 與 1 之間線性內插', () => {
    expect(forcesFor({ ...REST, scatter: 0.5 }).spring).toBeCloseTo(SPRING * (1 - 0.41), 10);
  });

  it('scatter 超出 [0, 1] 時夾住（不產生負彈簧）', () => {
    expect(forcesFor({ ...REST, scatter: 3 }).spring).toBeCloseTo(4.68, 10);
    expect(forcesFor({ ...REST, scatter: -2 }).spring).toBeCloseTo(SPRING, 10);
  });

  it('snap：spring 乘 2.2（落地「啪」一下就定住）', () => {
    expect(forcesFor({ ...REST, snap: true }).spring).toBeCloseTo(SPRING * 2.2, 10);
  });

  it('衝量剛發生（sinceBurst = 0、burstHold = 1）：spring 為基準的 0.1 倍', () => {
    expect(forcesFor({ ...REST, sinceBurst: 0, burstHold: 1 }).spring).toBeCloseTo(SPRING * 0.1, 10);
  });

  it('衝量之後的彈簧恢復：0.25·hold 前維持 0.1、1.2·hold 後回到 1，之間單調', () => {
    const at = (t: number) => forcesFor({ ...REST, sinceBurst: t, burstHold: 1 }).spring;
    expect(at(0.25)).toBeCloseTo(SPRING * 0.1, 10);
    expect(at(1.2)).toBeCloseTo(SPRING, 10);
    expect(at(5)).toBeCloseTo(SPRING, 10);
    let prev = at(0);
    for (let t = 0.01; t <= 1.3; t += 0.01) {
      const v = at(t);
      expect(v, `t=${t}`).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('burstHold 放大時間尺度：hold = 0.5（lift）恢復得比 hold = 1 快', () => {
    const quick = forcesFor({ ...REST, sinceBurst: 0.4, burstHold: 0.5 }).spring;
    const slow = forcesFor({ ...REST, sinceBurst: 0.4, burstHold: 1 }).spring;
    expect(quick).toBeGreaterThan(slow);
  });

  it('burstHold = 0（落地）：衝量不鬆彈簧', () => {
    expect(forcesFor({ ...REST, sinceBurst: 0, burstHold: 0 }).spring).toBeCloseTo(SPRING, 10);
  });

  it('各因子相乘：散開 × 衝量 × snap', () => {
    const f = forcesFor({ scatter: 1, scrollSpeed: 0, sinceBurst: 0, burstHold: 1, snap: true });
    expect(f.spring).toBeCloseTo(SPRING * (1 - 0.82) * 0.1 * 2.2, 10);
  });

  it('開場：spring 乘 intro.springScale（handoff 1、exhale 0.1）', () => {
    expect(forcesFor({ ...REST, intro: { springScale: 1 } }).spring).toBeCloseTo(SPRING, 10);
    expect(forcesFor({ ...REST, intro: { springScale: 0.1 } }).spring).toBeCloseTo(SPRING * 0.1, 10);
    expect(forcesFor({ ...REST, intro: { springScale: 0.55 } }).spring).toBeCloseTo(SPRING * 0.55, 10);
  });

  it('沒有 intro 與 intro.springScale = 1 結果相同', () => {
    expect(forcesFor(REST).spring).toBe(forcesFor({ ...REST, intro: { springScale: 1 } }).spring);
  });
});

describe('forcesFor：curl', () => {
  it('靜止：0.32', () => {
    expect(forcesFor(REST).curl).toBeCloseTo(0.32, 10);
  });

  it('scatter = 1：0.32 + 1.3', () => {
    expect(forcesFor({ ...REST, scatter: 1 }).curl).toBeCloseTo(0.32 + 1.3, 10);
  });

  it('scatter = 0、scrollSpeed = 3：0.32 + 3·0.35', () => {
    expect(forcesFor({ ...REST, scrollSpeed: 3 }).curl).toBeCloseTo(0.32 + 3 * 0.35, 10);
  });

  it('捲動速度最多算到 3：速度 10 與 3 相同；負速度不減少旋渦', () => {
    expect(forcesFor({ ...REST, scrollSpeed: 10 }).curl).toBeCloseTo(0.32 + 3 * 0.35, 10);
    expect(forcesFor({ ...REST, scrollSpeed: -5 }).curl).toBeCloseTo(0.32, 10);
  });

  it('散開與捲動速度疊加', () => {
    expect(forcesFor({ ...REST, scatter: 0.5, scrollSpeed: 2 }).curl).toBeCloseTo(0.32 + 0.5 * 1.3 + 2 * 0.35, 10);
  });
});

describe('forcesFor：damp', () => {
  it('平時 5.5', () => {
    expect(forcesFor(REST).damp).toBe(5.5);
    expect(forcesFor({ ...REST, scatter: 1, scrollSpeed: 3, snap: true }).damp).toBe(5.5);
  });

  it('開場彈簧還沒回滿（exhale、inhale）：阻尼降到 3，光點才飄得開、吸得進來', () => {
    expect(forcesFor({ ...REST, intro: { springScale: 0.1 } }).damp).toBe(3);
    expect(forcesFor({ ...REST, intro: { springScale: 0.7 } }).damp).toBe(3);
  });

  it('開場彈簧回滿（handoff、hold 之後）：阻尼回到 5.5', () => {
    expect(forcesFor({ ...REST, intro: { springScale: 1 } }).damp).toBe(5.5);
  });
});

describe('switchScatter（切換大人／小孩）', () => {
  it('一切換就全散（t=0 → 1），900 ms 線性收回', () => {
    expect(switchScatter(0)).toBe(1);
    expect(switchScatter(450)).toBeCloseTo(0.5, 10);
    expect(switchScatter(900)).toBe(0);
  });

  it('超過 900 ms 為 0', () => {
    expect(switchScatter(2000)).toBe(0);
    expect(switchScatter(1e9)).toBe(0);
  });

  it('負時間（時脈抖動）夾在 1，不超過 1', () => {
    expect(switchScatter(-50)).toBe(1);
  });

  it('單調遞減', () => {
    let prev = switchScatter(0);
    for (let t = 10; t <= 1000; t += 10) {
      const v = switchScatter(t);
      expect(v, `t=${t}`).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('有效 scatter = max(捲動 scatter, 切換 scatter)：兩者互補而不相加', () => {
    // 呼叫端的組合方式：切換後 450 ms 又恰好捲到轉場帶中央
    const effective = Math.max(0.3, switchScatter(450));
    expect(effective).toBeCloseTo(0.5, 10);
    expect(forcesFor({ ...REST, scatter: effective }).spring).toBeCloseTo(SPRING * (1 - 0.82 * 0.5), 10);
  });
});
