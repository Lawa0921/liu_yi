import { describe, expect, it } from 'vitest';
import { crackRibbon, crackWidth, generateCracks, projectGround } from '../../src/lib/impact/cracks';
import { spawnDebris, spawnDustWall } from '../../src/lib/impact/particles';
import { SINK_MS, sinkScale } from '../../src/lib/impact/shake';
import { CLEAVE, cleaveShift } from '../../src/lib/impact/cleave';
import { OPENING } from '../../src/lib/impact/opening';
import { forgeBand, forgeMagnify } from '../../src/lib/arsenal/forge';
import { FIGURES, PERSPECTIVE, heroPush, landingOffset, layerPlacement, pushDepth } from '../../src/lib/scene/layers';

// 修正輪：一擊要重。裂紋貼在地面上（透視）、由粗到細；塵牆與碎石；下沉帶一點縮放；破幅錯位夠大；
// 淬火的火星沿燃燒邊緣；捲動頭六成就推進到前景出框。

describe('裂紋貼在地面上（透視）', () => {
  const ground = { rise: 40, depth: 300 };

  it('落點就是腳下：原點不動', () => {
    expect(projectGround({ x: 0, y: 0 }, ground)).toEqual({ x: 0, y: 0 });
  });

  it('往遠處裂的被壓扁、收向地平線，但不會越過地平線跑到天上', () => {
    for (const far of [50, 200, 800, 5000]) {
      const p = projectGround({ x: 0, y: -far }, ground);
      expect(p.y).toBeLessThan(0);
      expect(p.y).toBeGreaterThan(-ground.rise);
    }
    // 越遠壓得越扁：同樣多走 100，畫面上走得越來越少。
    const step = (from: number) => projectGround({ x: 0, y: -from - 100 }, ground).y - projectGround({ x: 0, y: -from }, ground).y;
    expect(Math.abs(step(400))).toBeLessThan(Math.abs(step(0)));
  });

  it('往近處裂的越來越大：衝向畫面下緣與兩側', () => {
    const near = projectGround({ x: 100, y: 150 }, ground);
    // 越近放得越大：走兩倍遠，畫面上往下不只兩倍。
    expect(near.y).toBeGreaterThan(projectGround({ x: 100, y: 75 }, ground).y * 2);
    expect(near.x).toBeGreaterThan(100);
    // 再近也不會爆成無限大。
    const closest = projectGround({ x: 100, y: 99999 }, ground);
    expect(Number.isFinite(closest.x) && Number.isFinite(closest.y)).toBe(true);
  });

  it('橫向的裂線：遠近不變，只是位置照樣', () => {
    expect(projectGround({ x: 250, y: 0 }, ground)).toEqual({ x: 250, y: 0 });
  });

  it('線寬由粗到細：根部最粗、尖端最細但不是 0', () => {
    expect(crackWidth(0, 6)).toBe(6);
    expect(crackWidth(0.5, 6)).toBeLessThan(6);
    expect(crackWidth(1, 6)).toBeLessThan(crackWidth(0.5, 6));
    expect(crackWidth(1, 6)).toBeGreaterThan(0);
  });

  it('主裂線有分岔：支裂至少和主裂線一樣多', () => {
    const cracks = generateCracks({ seed: 7, radius: 400 });
    expect(cracks.filter((crack) => !crack.main).length).toBeGreaterThanOrEqual(8);
  });
});

describe('落點揚起的碎石', () => {
  it('往上噴再掉下來：一開始幾乎都往上，有大有小，會翻', () => {
    const debris = spawnDebris({ count: 40, seed: 2, speed: 0.6 });
    expect(debris).toHaveLength(40);
    expect(debris.filter((piece) => piece.vy < 0).length).toBeGreaterThanOrEqual(36);
    expect(Math.max(...debris.map((piece) => piece.size))).toBeGreaterThan(Math.min(...debris.map((piece) => piece.size)) * 1.8);
    expect(debris.some((piece) => piece.spin !== 0)).toBe(true);
  });
});

describe('下沉配合輕微縮放', () => {
  it('1.0 → 約 1.015 → 1.0，幅度很小', () => {
    expect(sinkScale(0)).toBe(1);
    expect(sinkScale(SINK_MS)).toBe(1);
    let peak = 1;
    for (let t = 0; t <= SINK_MS; t += 4) peak = Math.max(peak, sinkScale(t));
    expect(peak).toBeGreaterThanOrEqual(1.01);
    expect(peak).toBeLessThanOrEqual(1.02);
  });
});

describe('破幅：兩半錯位', () => {
  it('錯位量是視窗高的 6–8%', () => {
    expect(CLEAVE.shift).toBeGreaterThanOrEqual(0.06);
    expect(CLEAVE.shift).toBeLessThanOrEqual(0.08);
  });

  it('上半往右上、下半往左下，距離就是錯位量', () => {
    const { upper, lower } = cleaveShift(900);
    expect(upper.x).toBeGreaterThan(0);
    expect(upper.y).toBeLessThan(0);
    expect(lower.x).toBeLessThan(0);
    expect(lower.y).toBeGreaterThan(0);
    expect(Math.hypot(upper.x, upper.y)).toBeCloseTo(900 * CLEAVE.shift, 3);
    expect(Math.hypot(lower.x, lower.y)).toBeCloseTo(900 * CLEAVE.shift, 3);
  });
});

describe('淬火：正在燒的那一段', () => {
  it('成形時是長軸上很窄的一段，隨進度由尖端（0）往柄（1）走', () => {
    const early = forgeBand(0.2, 0.85);
    const late = forgeBand(0.8, 0.85);
    expect(early.to - early.from).toBeLessThanOrEqual(0.2);
    expect(late.from).toBeGreaterThan(early.from);
    for (const band of [early, late]) {
      expect(band.from).toBeGreaterThanOrEqual(0);
      expect(band.to).toBeLessThanOrEqual(1);
      expect(band.to).toBeGreaterThan(band.from);
    }
  });

  it('燃盡時沿噪聲邊界到處燒：那一段很寬', () => {
    const band = forgeBand(0.5, 0.25);
    expect(band.to - band.from).toBeGreaterThan(0.6);
  });
});

describe('捲動推進', () => {
  it('捲動頭六成就推進到底：鏡頭已經穿過最近的前景立柱', () => {
    expect(heroPush(0, 800)).toBe(0);
    expect(heroPush(0.6 * 800, 800)).toBe(1);
    expect(heroPush(2000, 800)).toBe(1);
    expect(heroPush(0.3 * 800, 800)).toBeCloseTo(0.5, 5);
    expect(heroPush(100, 0)).toBe(0);
    expect(pushDepth(1)).toBeGreaterThan(PERSPECTIVE - layerPlacement(1).z);
  });

  it('推到一半時前景已經明顯放大（至少 1.4 倍）', () => {
    const { z } = layerPlacement(1);
    const magnify = (PERSPECTIVE - z) / (PERSPECTIVE - z - pushDepth(0.5));
    expect(magnify).toBeGreaterThanOrEqual(1.4);
  });
});

// ── 修正輪（續）：截圖複查後補的 ─────────────────────────────────────────

describe('往觀者裂的主裂線：先衝出畫面下緣，不會在半路被壓成一條橫線', () => {
  const ground = { rise: 40, depth: 200 };

  it('一路往下、越來越快，走到 0.95 個 depth 時已經在十倍 rise 之外（畫面外）', () => {
    let last = -Infinity;
    for (let y = 0; y <= ground.depth * 0.95; y += ground.depth / 40) {
      const p = projectGround({ x: 0, y }, ground);
      expect(p.y).toBeGreaterThan(last);
      last = p.y;
    }
    expect(last).toBeGreaterThan(ground.rise * 10);
  });
});

describe('裂線畫成由粗到細的一條帶子（尖端收成一點）', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 200, y: 0 },
  ];

  it('左右兩側各一排點：根部寬就是 base，尖端幾乎是 0', () => {
    const ribbon = crackRibbon(points, (t) => crackWidth(t, 6));
    expect(ribbon).toHaveLength(points.length * 2);
    const widthAt = (i: number) => Math.hypot(ribbon[i]!.x - ribbon[ribbon.length - 1 - i]!.x, ribbon[i]!.y - ribbon[ribbon.length - 1 - i]!.y);
    expect(widthAt(0)).toBeCloseTo(6, 5);
    expect(widthAt(1)).toBeLessThan(widthAt(0));
    expect(widthAt(2)).toBeLessThan(6 * 0.2);
  });

  it('帶子沿著裂線走：中線就是原本的點', () => {
    const ribbon = crackRibbon(points, () => 4);
    for (let i = 0; i < points.length; i++) {
      const a = ribbon[i]!;
      const b = ribbon[ribbon.length - 1 - i]!;
      expect((a.x + b.x) / 2).toBeCloseTo(points[i]!.x, 5);
      expect((a.y + b.y) / 2).toBeCloseTo(points[i]!.y, 5);
    }
  });
});

describe('貼地的塵牆', () => {
  const wall = spawnDustWall({ count: 300, seed: 4, speed: 1.2 });

  it('貼著地面往兩側推：垂直速度遠小於水平速度', () => {
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(wall.map((p) => Math.abs(p.vy)))).toBeLessThan(mean(wall.map((p) => Math.abs(p.vx))) * 0.3);
  });

  it('近大遠小：往觀者這邊的顆粒比往遠處的大', () => {
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const near = wall.filter((p) => p.vy > 0).map((p) => p.size);
    const far = wall.filter((p) => p.vy < 0).map((p) => p.size);
    expect(near.length).toBeGreaterThan(20);
    expect(far.length).toBeGreaterThan(20);
    expect(mean(near)).toBeGreaterThan(mean(far) * 1.5);
  });
});

describe('擊中瞬間定格兩三幀', () => {
  it('定格 33–50ms（60fps 的兩到三幀）', () => {
    expect(OPENING.freezeMs).toBeGreaterThanOrEqual(33);
    expect(OPENING.freezeMs).toBeLessThanOrEqual(50);
  });
});

describe('裂紋中心在落下的那隻腳下', () => {
  it('震腳的人：落腳在身體中心的左邊（抬起的那隻腳），落點往左偏', () => {
    expect(FIGURES.stomp.landing).toBeLessThan(FIGURES.stomp.centre - 0.2);
    // 以人形框的寬度為 1：落點相對於身體中心的偏移。
    expect(landingOffset(FIGURES.stomp)).toBeCloseTo(FIGURES.stomp.landing - FIGURES.stomp.centre, 5);
    // 沒有指定落腳的人形：就在身體中心。
    expect(landingOffset(FIGURES.hero)).toBe(0);
  });
});

describe('淬火時兵器放大（主角）', () => {
  it('平常 1；燒的時候放大到 1.15 以上；燒完收回 1；過程連續', () => {
    expect(forgeMagnify({ current: 'jian', next: null, phase: 'idle', t: 0 })).toBe(1);
    expect(forgeMagnify({ current: 'jian', next: 'miaodao', phase: 'leaving', t: 0 })).toBeCloseTo(1, 5);
    expect(forgeMagnify({ current: 'jian', next: 'miaodao', phase: 'leaving', t: 0.6 })).toBeGreaterThanOrEqual(1.15);
    expect(forgeMagnify({ current: 'miaodao', next: null, phase: 'entering', t: 0.4 })).toBeGreaterThanOrEqual(1.15);
    expect(forgeMagnify({ current: 'miaodao', next: null, phase: 'entering', t: 1 })).toBeCloseTo(1, 5);
    const end = forgeMagnify({ current: 'jian', next: 'miaodao', phase: 'leaving', t: 1 });
    const start = forgeMagnify({ current: 'miaodao', next: null, phase: 'entering', t: 0 });
    expect(Math.abs(end - start)).toBeLessThan(0.01);
    for (let t = 0; t <= 1; t += 0.05) {
      expect(forgeMagnify({ current: 'miaodao', next: null, phase: 'entering', t })).toBeLessThanOrEqual(1.25);
    }
  });
});
