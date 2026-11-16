import { describe, expect, it } from 'vitest';
import {
  FIGURES,
  PERSPECTIVE,
  SCENES,
  driftPointer,
  figureBox,
  layerPlacement,
  parallaxOrigin,
  pointerMode,
  pushDepth,
  resolveScene,
  revealDelay,
  tiltPointer,
  type SceneLayer,
} from '../../src/lib/scene/layers';

const ALL = new Set([
  'fig-dingzhou',
  'fig-zhenjiao',
  'fig-chengchui',
  'fig-jian',
  'fig-miaodao',
  'fig-daqiang',
  'bg-far-roofs',
  'bg-mid-rack',
  'bg-mid-gate',
  'fg-pillars',
  'fg-lattice',
]);

describe('場景的層設定', () => {
  it('首屏由遠到近至少五層：遠景、中景、人形、塵粒、前景', () => {
    const layers = resolveScene(SCENES.hero, ALL, { mobile: false });
    const roles = new Set(layers.map((layer) => layer.role));
    for (const role of ['far', 'mid', 'ground', 'figure', 'dust', 'fore']) expect(roles.has(role as SceneLayer['role']), role).toBe(true);
    // 依景深由遠到近排好。
    const depths = layers.map((layer) => layer.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    expect(new Set(layers.map((layer) => layer.id)).size).toBe(layers.length);
  });

  it('景深都在 0（最遠）到 1（最近）之間；前景最近、遠景最遠', () => {
    for (const scene of Object.values(SCENES)) {
      for (const layer of scene) {
        expect(layer.depth).toBeGreaterThanOrEqual(0);
        expect(layer.depth).toBeLessThanOrEqual(1);
      }
    }
    const hero = SCENES.hero;
    const depthOf = (role: string) => hero.filter((layer) => layer.role === role).map((layer) => layer.depth);
    expect(Math.max(...depthOf('far'))).toBeLessThan(Math.min(...depthOf('figure')));
    expect(Math.max(...depthOf('figure'))).toBeLessThan(Math.min(...depthOf('fore')));
  });

  it('人形清單集中在一處：每個人形可單獨抽換，場景只用代號指到它', () => {
    expect(Object.keys(FIGURES).sort()).toEqual(['fist', 'hero', 'jian', 'kao', 'land', 'miaodao', 'spear', 'stomp']);
    expect(FIGURES.stomp.asset).toBe('fig-zhenjiao');
    expect(FIGURES.jian.asset).toBe('fig-jian');
    expect(FIGURES.miaodao.asset).toBe('fig-miaodao');
    expect(FIGURES.spear.asset).toBe('fig-daqiang');
    for (const scene of Object.values(SCENES)) {
      for (const layer of scene) {
        if (layer.role !== 'figure') continue;
        expect(layer.figure && FIGURES[layer.figure], layer.id).toBeTruthy();
        expect(layer.asset).toBe(FIGURES[layer.figure!].asset);
      }
    }
  });

  it('兵器幕：劍、苗刀、槍各有一個持械人形，放在比兵器遠的景深、低對比', () => {
    const figures = SCENES.weapon.filter((layer) => layer.role === 'figure');
    expect(figures.map((layer) => layer.figure).sort()).toEqual(['jian', 'miaodao', 'spear']);
    for (const figure of figures) {
      expect(figure.depth).toBeLessThan(0.5);
      expect(figure.opacity).toBeLessThanOrEqual(0.6);
    }
    // 苗刀人形的刀看起來仍像日本刀：比另外兩個更遠、更暗。
    const of = (key: string) => figures.find((layer) => layer.figure === key)!;
    expect(of('miaodao').depth).toBeLessThan(of('jian').depth);
    expect(of('miaodao').opacity).toBeLessThan(of('jian').opacity);
  });
});

describe('人形的比例與腳底對齊', () => {
  // 各張原圖的尺寸（人的縮放各不相同）。
  const IMAGES = {
    stomp: { width: 638, height: 1120 },
    hero: { width: 866, height: 695 },
    fist: { width: 906, height: 785 },
    jian: { width: 1021, height: 663 },
    miaodao: { width: 771, height: 1002 },
    spear: { width: 968, height: 406 },
    land: { width: 688, height: 1177 },
    kao: { width: 926, height: 645 },
  } as const;

  it('畫面上每個人的頭一樣大（身高一致），不管原圖裡的人縮放多少', () => {
    const heads = (Object.keys(FIGURES) as (keyof typeof FIGURES)[]).map((key) => {
      const box = figureBox(FIGURES[key], IMAGES[key]);
      // 頭在畫面上的高度 = 圖在畫面上的高度 × 頭佔圖高的比例。
      return (box.height * FIGURES[key].head) / IMAGES[key].height;
    });
    for (const head of heads) expect(head).toBeCloseTo(heads[0]!, 6);
    // 一個站直的人是 1，頭是它的七分之一上下。
    expect(heads[0]!).toBeGreaterThan(0.1);
    expect(heads[0]!).toBeLessThan(0.16);
  });

  it('腳底：扣掉圖下緣的透明邊，腳踩在同一條地平線上', () => {
    for (const key of Object.keys(FIGURES) as (keyof typeof FIGURES)[]) {
      const box = figureBox(FIGURES[key], IMAGES[key]);
      expect(box.foot).toBeCloseTo(9 / IMAGES[key].height, 6);
      expect(box.centre).toBeGreaterThan(0.3);
      expect(box.centre).toBeLessThan(0.8);
    }
  });

  it('圖的尺寸讀不到（0）也不會除以零', () => {
    const box = figureBox(FIGURES.hero, { width: 0, height: 0 });
    expect(Number.isFinite(box.height) && Number.isFinite(box.foot)).toBe(true);
  });
});

describe('缺件略過', () => {
  it('石階的素材不合格、沒有這張：地面是不靠素材的一層（CSS 畫的地平線與石板線），場景照常', () => {
    expect(SCENES.hero.some((layer) => layer.asset === 'fg-steps')).toBe(false);
    const layers = resolveScene(SCENES.hero, ALL, { mobile: false });
    const ground = layers.find((layer) => layer.role === 'ground');
    expect(ground).toBeDefined();
    expect(ground!.asset).toBeNull();
  });

  it('素材沒到的層直接略過，其餘照常', () => {
    const available = new Set(ALL);
    available.delete('bg-mid-gate');
    available.delete('fig-dingzhou');
    const layers = resolveScene(SCENES.hero, available, { mobile: false });
    expect(layers.some((layer) => layer.asset === 'bg-mid-gate')).toBe(false);
    expect(layers.some((layer) => layer.asset === 'fig-dingzhou')).toBe(false);
    expect(layers.some((layer) => layer.asset === 'bg-far-roofs')).toBe(true);
  });

  it('一張素材都沒有：只剩不需要素材的層（霧、光束、塵粒），不報錯', () => {
    const layers = resolveScene(SCENES.hero, new Set(), { mobile: false });
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) expect(layer.asset).toBeNull();
  });

  it('手機：層數減少，但遠景、人形、前景都還在', () => {
    const desktop = resolveScene(SCENES.hero, ALL, { mobile: false });
    const mobile = resolveScene(SCENES.hero, ALL, { mobile: true });
    expect(mobile.length).toBeLessThan(desktop.length);
    const roles = new Set(mobile.map((layer) => layer.role));
    for (const role of ['far', 'figure', 'fore']) expect(roles.has(role as SceneLayer['role']), role).toBe(true);
  });
});

describe('景深 → 3D 位置', () => {
  it('遠的在鏡頭後方深處（Z 為負）、近的靠近鏡頭（Z 為正）；越近 Z 越大', () => {
    expect(layerPlacement(0).z).toBeLessThan(0);
    expect(layerPlacement(1).z).toBeGreaterThan(0);
    let last = -Infinity;
    for (let depth = 0; depth <= 1; depth += 0.1) {
      expect(layerPlacement(depth).z).toBeGreaterThan(last);
      last = layerPlacement(depth).z;
    }
  });

  it('縮放剛好抵銷透視：靜止時每一層看起來都是原本的大小', () => {
    for (const depth of [0, 0.3, 0.55, 0.9, 1]) {
      const { z, scale } = layerPlacement(depth);
      expect(scale * (PERSPECTIVE / (PERSPECTIVE - z))).toBeCloseTo(1, 6);
    }
  });

  it('最近的層也還在鏡頭前面（Z 小於透視距離）', () => {
    expect(layerPlacement(1).z).toBeLessThan(PERSPECTIVE * 0.6);
  });
});

describe('視差：指標位置 → 透視原點', () => {
  it('指標在正中央：原點在正中央', () => {
    expect(parallaxOrigin({ x: 0, y: 0 })).toEqual({ x: 50, y: 50 });
  });

  it('指標往右，原點往右（近的層因此往左移得比遠的多）；上下同理', () => {
    expect(parallaxOrigin({ x: 1, y: 0 }).x).toBeGreaterThan(50);
    expect(parallaxOrigin({ x: -1, y: 0 }).x).toBeLessThan(50);
    expect(parallaxOrigin({ x: 0, y: 1 }).y).toBeGreaterThan(50);
  });

  it('幅度有上限：指標給再大也不會把構圖甩出去；NaN 當 0', () => {
    const far = parallaxOrigin({ x: 99, y: -99 });
    expect(far).toEqual(parallaxOrigin({ x: 1, y: -1 }));
    // 第四輪加大視差（近層位移要明顯大於遠層），上限放寬到 16。
    expect(Math.abs(far.x - 50)).toBeLessThanOrEqual(16);
    expect(Math.abs(far.y - 50)).toBeLessThanOrEqual(16);
    expect(parallaxOrigin({ x: Number.NaN, y: Number.NaN })).toEqual({ x: 50, y: 50 });
  });
});

describe('捲動推進：鏡頭往前穿過前景', () => {
  it('還沒捲：鏡頭在原位；捲到底：往前推進一段，足以穿過最近的前景層', () => {
    expect(pushDepth(0)).toBe(0);
    expect(pushDepth(1)).toBeGreaterThan(PERSPECTIVE - layerPlacement(1).z);
    expect(pushDepth(5)).toBe(pushDepth(1));
    expect(pushDepth(-1)).toBe(0);
  });

  it('推進是單調的', () => {
    let last = -1;
    for (let p = 0; p <= 1; p += 0.05) {
      expect(pushDepth(p)).toBeGreaterThan(last);
      last = pushDepth(p);
    }
  });
});

describe('各層次第亮起', () => {
  it('由遠到近：越近越晚亮；整段不拖過一秒', () => {
    expect(revealDelay(0)).toBeLessThan(revealDelay(0.5));
    expect(revealDelay(0.5)).toBeLessThan(revealDelay(1));
    expect(revealDelay(0)).toBeGreaterThanOrEqual(0);
    expect(revealDelay(1)).toBeLessThanOrEqual(1000);
  });
});

describe('視差的來源', () => {
  it('減少動態：靜態，什麼都不動', () => {
    expect(pointerMode({ reducedMotion: true, hover: true, tilt: 'available' })).toBe('static');
  });

  it('有滑鼠：跟滑鼠', () => {
    expect(pointerMode({ reducedMotion: false, hover: true, tilt: 'none' })).toBe('mouse');
  });

  it('沒有滑鼠：陀螺儀不需要權限就用；要權限就不強求，改成緩慢自動漂移', () => {
    expect(pointerMode({ reducedMotion: false, hover: false, tilt: 'available' })).toBe('tilt');
    expect(pointerMode({ reducedMotion: false, hover: false, tilt: 'needs-permission' })).toBe('drift');
    expect(pointerMode({ reducedMotion: false, hover: false, tilt: 'none' })).toBe('drift');
  });

  it('裝置傾斜換成指標位置：平拿在手上（前傾約 45°）是正中央，幅度夾在 ±1', () => {
    expect(tiltPointer(45, 0)).toEqual({ x: 0, y: 0 });
    expect(tiltPointer(45, 20).x).toBeGreaterThan(0);
    expect(tiltPointer(45, -20).x).toBeLessThan(0);
    expect(tiltPointer(70, 0).y).toBeGreaterThan(0);
    expect(tiltPointer(45, 500)).toEqual({ x: 1, y: 0 });
    expect(tiltPointer(null, null)).toEqual({ x: 0, y: 0 });
  });

  it('自動漂移：很慢、幅度小，而且一直在動', () => {
    const a = driftPointer(0);
    const b = driftPointer(4000);
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThan(0.01);
    for (let t = 0; t < 60_000; t += 700) {
      const p = driftPointer(t);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(0.4);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.4);
    }
  });
});
