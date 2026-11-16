import { describe, expect, it } from 'vitest';
import { FIGURES, SCENES, heroBreath, pointerParallax, resolveScene, scrollParallax, splitFrame, type SceneLayer } from '../../src/lib/scene/layers';
import { DOOR, advanceDoor, createDoor, doorOpenness, requestDoor } from '../../src/lib/doors';
import { ATMOS, atmosFrameDue } from '../../src/lib/scene/atmos';

// 第四輪：整個首頁都有前後景；大人／小孩切換是門扇開合；首屏的體積光著色器。

// 目前資料夾裡真的有的素材（第二批還沒到）。
const NOW = new Set([
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
const HOME = ['hero', 'weapon', 'fist', 'combat', 'courses', 'coaches', 'facility', 'contact'] as const;

describe('整個首頁的分層', () => {
  it('首頁每一幕、每個區塊都有遠景（或窗櫺）與前景，即使第二批素材還沒到', () => {
    for (const name of HOME) {
      const layers = resolveScene(SCENES[name], NOW, { mobile: false });
      const roles = new Set(layers.map((layer) => layer.role));
      expect(roles.has('fore'), `${name} 前景`).toBe(true);
      expect(roles.has('far') || roles.has('mid'), `${name} 遠景`).toBe(true);
    }
  });

  it('缺件時用指定的替代素材；連替代都沒有就略過，不留空層', () => {
    const rack = SCENES.weapon.find((layer) => layer.id === 'fore-rack')!;
    expect(rack.asset).toBe('fg-rack-close');
    expect(rack.fallback).toBe('bg-mid-rack');
    const resolved = resolveScene(SCENES.weapon, NOW, { mobile: false }).find((layer) => layer.id === 'fore-rack')!;
    expect(resolved.asset).toBe('bg-mid-rack');
    // 第二批到了就用正式的。
    const later = resolveScene(SCENES.weapon, new Set([...NOW, 'fg-rack-close']), { mobile: false }).find((layer) => layer.id === 'fore-rack')!;
    expect(later.asset).toBe('fg-rack-close');
    // 沒有替代的（簷角、旗幡）缺件就整層略過。
    expect(resolveScene(SCENES.hero, NOW, { mobile: false }).some((layer) => layer.id === 'fore-eave')).toBe(false);
    expect(resolveScene(SCENES.hero, new Set([...NOW, 'fg-eave']), { mobile: false }).some((layer) => layer.id === 'fore-eave')).toBe(true);
  });

  it('第二批素材都有地方放', () => {
    const wanted = new Set(Object.values(SCENES).flatMap((scene: readonly SceneLayer[]) => scene.map((layer) => layer.asset)));
    // mid-stonelock 近看像提包，依指示不用。
    for (const asset of ['mid-drum', 'mid-dummy', 'mid-banner', 'fg-eave', 'fg-rack-close', 'fg-steps']) {
      expect(wanted.has(asset), asset).toBe(true);
    }
    expect(FIGURES.kao.asset).toBe('fig-kao');
    expect(FIGURES.land.asset).toBe('fig-zhenjiao-land');
  });

  it('手機層數減半（景物層：不算霧、人形、地面、體積光）', () => {
    for (const name of HOME) {
      const scenery = (layer: SceneLayer) => !['fog', 'figure', 'ground', 'atmos'].includes(layer.role);
      const all = resolveScene(SCENES[name], NOW, { mobile: false }).filter(scenery);
      const phone = resolveScene(SCENES[name], NOW, { mobile: true }).filter(scenery);
      expect(phone.length, name).toBeLessThanOrEqual(Math.ceil(all.length / 2) + 1);
    }
  });
});

describe('捲動視差', () => {
  it('遠慢近快：越近每單位捲動位移越大；最近的前景快到能從畫面掃過', () => {
    let last = -1;
    for (const depth of [0, 0.2, 0.5, 0.8, 1]) {
      const speed = scrollParallax(depth);
      expect(speed).toBeGreaterThan(last);
      last = speed;
    }
    expect(scrollParallax(0)).toBeLessThan(30);
    expect(scrollParallax(1)).toBeGreaterThanOrEqual(220);
    expect(scrollParallax(1, { mobile: true })).toBeLessThan(scrollParallax(1));
  });
});

describe('立柱拆成左右兩根（框只包住柱子本身）', () => {
  it('左柱的框在畫面最左一成，右柱在最右一成', () => {
    const [left, right] = splitFrame();
    expect(left.from).toBeLessThan(0.02);
    expect(left.to).toBeLessThanOrEqual(0.09);
    expect(right.from).toBeGreaterThanOrEqual(0.92);
    expect(right.to).toBeGreaterThan(0.98);
  });
});

describe('門扇開合', () => {
  it('合上、換組、再打開，整段不超過 900ms', () => {
    expect(DOOR.closeMs + DOOR.openMs).toBeLessThanOrEqual(900);
    let door = requestDoor(createDoor('adult'), 'kid');
    expect(door.phase).toBe('closing');
    expect(door.shown).toBe('adult');
    door = advanceDoor(door, DOOR.closeMs);
    expect(door.phase).toBe('opening');
    expect(door.shown).toBe('kid');
    expect(doorOpenness(door)).toBe(0);
    door = advanceDoor(door, DOOR.openMs);
    expect(door.phase).toBe('idle');
    expect(doorOpenness(door)).toBe(1);
  });

  it('連點：打開途中又要換回去，從目前的開度反向合上；不會兩組同時顯示', () => {
    let door = advanceDoor(requestDoor(createDoor('adult'), 'kid'), DOOR.closeMs + DOOR.openMs / 2);
    expect(door.phase).toBe('opening');
    const open = doorOpenness(door);
    door = requestDoor(door, 'adult');
    expect(door.phase).toBe('closing');
    expect(doorOpenness(door)).toBeCloseTo(open, 5);
    expect(door.shown).toBe('kid');
    door = advanceDoor(door, DOOR.closeMs);
    expect(door.shown).toBe('adult');
    // 合上途中改主意：繼續合，目標換成最後一次點的。
    door = requestDoor(requestDoor(createDoor('adult'), 'kid'), 'adult');
    door = requestDoor(door, 'kid');
    door = advanceDoor(door, DOOR.closeMs + DOOR.openMs);
    expect(door).toMatchObject({ phase: 'idle', shown: 'kid' });
  });

  it('點目前顯示的那一組：沒事；減少動態：直接換', () => {
    expect(requestDoor(createDoor('adult'), 'adult').phase).toBe('idle');
    expect(requestDoor(createDoor('adult'), 'kid', { instant: true })).toMatchObject({ phase: 'idle', shown: 'kid' });
  });
});

describe('體積光著色器的節流', () => {
  it('最多 30fps；畫面外或減少動態只畫一格', () => {
    expect(ATMOS.fps).toBeLessThanOrEqual(30);
    expect(atmosFrameDue({ sinceLast: 10, visible: true, reducedMotion: false, drawn: 5 })).toBe(false);
    expect(atmosFrameDue({ sinceLast: 40, visible: true, reducedMotion: false, drawn: 5 })).toBe(true);
    expect(atmosFrameDue({ sinceLast: 400, visible: false, reducedMotion: false, drawn: 5 })).toBe(false);
    expect(atmosFrameDue({ sinceLast: 400, visible: true, reducedMotion: true, drawn: 1 })).toBe(false);
    expect(atmosFrameDue({ sinceLast: 0, visible: true, reducedMotion: true, drawn: 0 })).toBe(true);
  });
});

describe('首屏鏡頭的呼吸', () => {
  it('從 0 開始，一直在變，但幅度很小（不超過 70px）', () => {
    expect(heroBreath(0)).toBe(0);
    expect(heroBreath(3000)).not.toBe(heroBreath(6000));
    for (let t = 0; t < 60_000; t += 250) {
      expect(heroBreath(t)).toBeGreaterThanOrEqual(0);
      expect(heroBreath(t)).toBeLessThanOrEqual(70);
    }
  });
});

describe('指標視差', () => {
  it('遠層幾乎不動、前景走得多（至少遠層的十倍）', () => {
    expect(pointerParallax(0.05)).toBeLessThan(10);
    expect(pointerParallax(1)).toBeGreaterThanOrEqual(pointerParallax(0.05) * 10);
    expect(pointerParallax(0.55)).toBeGreaterThan(pointerParallax(0.28));
  });
});

describe('右柱讓開右下角固定的「預約體驗」鈕', () => {
  it('右柱的左緣在畫面寬 0.945 以外（1280–1920 寬時鈕的右緣約在 0.93–0.95）', () => {
    expect(splitFrame()[1].from).toBeGreaterThanOrEqual(0.955);
  });
});

describe('體積光的強度', () => {
  it('呼吸的最暗時刻仍有七成以上；光柱裡有一層不會消失的底光', () => {
    expect(ATMOS.breatheFloor).toBeGreaterThanOrEqual(0.7);
    expect(ATMOS.rayFloor).toBeGreaterThanOrEqual(0.25);
  });
  it('手機光柱只當背景：強度減半以下、不透明度上限低', () => {
    expect(ATMOS.mobileShaft).toBeLessThanOrEqual(0.5);
    expect(ATMOS.mobileAlpha).toBeLessThanOrEqual(0.5);
    expect(ATMOS.mobileAlpha).toBeLessThan(ATMOS.desktopAlpha);
  });
});
