import { describe, expect, it } from 'vitest';
import { SHAPES } from '../../src/qi/config/shapes';
import {
  BEATS,
  BURSTS,
  POSE_BY_BEAT,
  poseFor,
  type Audience,
  type BeatId,
  type PoseId,
} from '../../src/qi/config/poses';

const AUDIENCES: Audience[] = ['adult', 'kid'];

/** 十八個姿勢（依型別宣告順序）：計畫的十六個，加上 Task 25 的 scroll（竹簡）與 crest（光點館徽）。 */
const ALL_POSES: PoseId[] = [
  'lift',
  'land',
  'dingzhou',
  'chengchui',
  'kao',
  'jian',
  'miaodao',
  'spear',
  'others',
  'salute',
  'flow',
  'seal',
  'scroll',
  'crest',
  'kid-wushu',
  'kid-defense-a',
  'kid-defense-b',
  'kid-weapon',
  'kid-miaodao',
  'kid-spear',
];

describe('BEATS', () => {
  it('恰有 11 個，依序為開場、拳、格鬥×2、兵器×3、其他、師資、收費、預約', () => {
    expect(BEATS).toEqual([
      'opening',
      'fist',
      'combat-a',
      'combat-b',
      'weapon-a',
      'weapon-b',
      'weapon-c',
      'others',
      'coaches',
      'pricing',
      'booking',
    ]);
    expect(BEATS).toHaveLength(11);
    expect(new Set(BEATS).size).toBe(11);
  });
});

describe('POSE_BY_BEAT', () => {
  it.each(AUDIENCES)('%s：涵蓋全部 beat，且沒有多餘的鍵', (audience) => {
    expect(Object.keys(POSE_BY_BEAT[audience]).sort()).toEqual([...BEATS].sort());
  });

  it('大人：依計畫的對應表', () => {
    expect(POSE_BY_BEAT.adult).toEqual({
      opening: 'land',
      fist: 'dingzhou',
      'combat-a': 'chengchui',
      'combat-b': 'kao',
      'weapon-a': 'jian',
      'weapon-b': 'miaodao',
      'weapon-c': 'spear',
      others: 'others',
      coaches: 'salute',
      pricing: 'scroll',
      booking: 'crest',
    });
  });

  it('小孩：拳、格鬥與兵器三段都換成小孩姿勢（持劍、持刀、持槍），其餘同大人', () => {
    expect(POSE_BY_BEAT.kid.fist).toBe('kid-wushu');
    expect(POSE_BY_BEAT.kid['combat-a']).toBe('kid-defense-a');
    expect(POSE_BY_BEAT.kid['combat-b']).toBe('kid-defense-b');
    expect(POSE_BY_BEAT.kid['weapon-a']).toBe('kid-weapon');
    expect(POSE_BY_BEAT.kid['weapon-b']).toBe('kid-miaodao');
    expect(POSE_BY_BEAT.kid['weapon-c']).toBe('kid-spear');
    const swapped: BeatId[] = ['fist', 'combat-a', 'combat-b', 'weapon-a', 'weapon-b', 'weapon-c'];
    for (const beat of BEATS) {
      if (swapped.includes(beat)) continue;
      expect(POSE_BY_BEAT.kid[beat], beat).toBe(POSE_BY_BEAT.adult[beat]);
    }
  });

  it('每個出現的 PoseId 都有 SHAPES 配方；flow（程序化、無配方）已不屬於任何 beat，只給入館閘門當背景', () => {
    for (const audience of AUDIENCES) {
      for (const beat of BEATS) {
        const pose = POSE_BY_BEAT[audience][beat];
        expect(pose, `${audience}/${beat} 不該是 flow`).not.toBe('flow');
        expect(SHAPES[pose], `${audience}/${beat} → ${pose}`).toBeDefined();
      }
    }
    expect(SHAPES.flow, 'flow 不該有配方').toBeUndefined();
    expect(BURSTS.flow, 'flow 仍是合法姿勢（setPose 需要衝量表）').toBeDefined();
  });

  it('收費課表是竹簡（scroll）、預約是光點館徽（crest）；朱印（seal）不再屬於任何 beat', () => {
    for (const audience of AUDIENCES) {
      expect(POSE_BY_BEAT[audience].pricing).toBe('scroll');
      expect(POSE_BY_BEAT[audience].booking).toBe('crest');
      expect(Object.values(POSE_BY_BEAT[audience])).not.toContain('seal');
    }
  });

  it('開場落在 land，且 lift 不在任何 beat 上（它只屬於開場時間軸）', () => {
    for (const audience of AUDIENCES) {
      expect(POSE_BY_BEAT[audience].opening).toBe('land');
      expect(Object.values(POSE_BY_BEAT[audience])).not.toContain('lift');
    }
  });
});

describe('poseFor', () => {
  it('等同查表，兩種對象、全部 beat 都有姿勢', () => {
    for (const audience of AUDIENCES) {
      for (const beat of BEATS) {
        expect(poseFor(beat, audience)).toBe(POSE_BY_BEAT[audience][beat]);
      }
    }
  });

  it('同一個 beat 在大人與小孩可以給不同姿勢', () => {
    expect(poseFor('fist', 'adult')).toBe('dingzhou');
    expect(poseFor('fist', 'kid')).toBe('kid-wushu');
    expect(poseFor('booking', 'kid')).toBe('crest');
  });
});

describe('BURSTS', () => {
  it('涵蓋全部 18 個 PoseId，且沒有多餘的鍵', () => {
    expect(Object.keys(BURSTS).sort()).toEqual([...ALL_POSES].sort());
  });

  it('每筆都合法：方向有限且非零向量、力道為正、mode 屬 0–3', () => {
    for (const pose of ALL_POSES) {
      const b = BURSTS[pose];
      expect(b.dir, pose).toHaveLength(3);
      expect(b.dir.every(Number.isFinite), pose).toBe(true);
      expect(Math.hypot(...b.dir), `${pose} 方向不可為零向量（引擎會 normalize）`).toBeGreaterThan(0);
      expect(b.power, pose).toBeGreaterThan(0);
      expect([0, 1, 2, 3], pose).toContain(b.mode);
      if (b.hold !== undefined) expect(b.hold, pose).toBeGreaterThan(0);
    }
  });

  it('試作 STEPS 的值原樣搬入', () => {
    expect(BURSTS.dingzhou).toEqual({ dir: [1, 0.15, 0.1], power: 3.2, mode: 0 });
    expect(BURSTS.chengchui).toEqual({ dir: [1, 0.1, 0], power: 3.0, mode: 1 });
    expect(BURSTS.kao).toEqual({ dir: [1, 0.35, 0.15], power: 3.4, mode: 0 });
    expect(BURSTS.jian).toEqual({ dir: [1, 0.25, 0], power: 3.0, mode: 0 });
    expect(BURSTS.miaodao).toEqual({ dir: [0.6, -0.8, 0], power: 3.2, mode: 0 });
    expect(BURSTS.spear).toEqual({ dir: [1, 0, 0], power: 3.6, mode: 0 });
    expect(BURSTS.land).toEqual({ dir: [0, -1, 0], power: 2.2, mode: 2 });
    expect(BURSTS.lift).toEqual({ dir: [0, 1, 0], power: 1.8, mode: 2, hold: 0.5 });
  });

  it('新姿勢：others／salute 用 mode 2 且力道 1.4–1.8；flow 輕緩；seal 向內收（mode 3）', () => {
    for (const pose of ['others', 'salute'] as const) {
      expect(BURSTS[pose].mode, pose).toBe(2);
      expect(BURSTS[pose].power, pose).toBeGreaterThanOrEqual(1.4);
      expect(BURSTS[pose].power, pose).toBeLessThanOrEqual(1.8);
    }
    expect(BURSTS.flow).toEqual({ dir: [1, 0, 0], power: 1.0, mode: 0 });
    expect(BURSTS.seal).toEqual({ dir: [0, -1, 0], power: 2.0, mode: 3 });
  });

  it('Task 25：scroll 攤開（左右分開 mode 1、力道輕）；crest 與朱印一樣向內收（mode 3）', () => {
    expect(BURSTS.scroll.mode).toBe(1);
    expect(BURSTS.scroll.power).toBeLessThanOrEqual(2);
    expect(BURSTS.crest).toEqual({ dir: [0, -1, 0], power: 2.0, mode: 3 });
  });

  it('kid-* 沿用 chengchui 的 mode 1／力道 3.0', () => {
    for (const pose of ['kid-wushu', 'kid-defense-a', 'kid-defense-b', 'kid-weapon', 'kid-miaodao', 'kid-spear'] as const) {
      expect(BURSTS[pose].mode, pose).toBe(1);
      expect(BURSTS[pose].power, pose).toBe(3.0);
    }
  });

  it('只有 lift 帶 hold（試作那一式「抬腳」鬆彈簧的時長）', () => {
    for (const pose of ALL_POSES) {
      if (pose === 'lift') expect(BURSTS[pose].hold).toBe(0.5);
      else expect(BURSTS[pose].hold, pose).toBeUndefined();
    }
  });
});
