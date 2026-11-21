import { describe, expect, it } from 'vitest';
import { buildHomeModel, firstSentence, type CourseLike } from '../../src/lib/home';

type Data = CourseLike['data'];

function course(id: string, audience: string, category: string, extra: Partial<Data> = {}): CourseLike {
  return {
    id,
    data: {
      title: `課-${id}`,
      summary: `摘要-${id}`,
      audience,
      category,
      subItems: [],
      published: true,
      order: 0,
      coaches: [],
      ...extra,
    },
  };
}

interface Coach {
  id: string;
  data: { name: string; role: string; published: boolean; order: number };
}

function coach(id: string, order: number, published = true): Coach {
  return { id, data: { name: `教練-${id}`, role: `職稱-${id}`, published, order } };
}

/** 現有內容的形狀：六門主課＋兩門其他課，另有幾門未發布。 */
const ALL: CourseLike[] = [
  course('kids-self-defense', 'kid', 'combat', { order: 6, coaches: [{ id: 'monkey' }] }),
  course('bjj', 'all', 'other', { order: 10, coaches: [{ id: 'owen' }] }),
  course('sanshou', 'adult', 'combat', { order: 3, coaches: [{ id: 'chan' }] }),
  course('bajiquan', 'adult', 'fist', { order: 2, coaches: [{ id: 'chan' }] }),
  course('kids-weapons', 'kid', 'weapon', { order: 4, coaches: [{ id: 'monkey' }] }),
  course('chinese-weapons', 'adult', 'weapon', { order: 1, coaches: [{ id: 'chan' }] }),
  course('kids-martial-arts', 'kid', 'fist', { order: 5, coaches: [{ id: 'monkey' }] }),
  course('core-yoga', 'all', 'other', { order: 11, coaches: [{ id: 'lisa' }] }),
  course('internal-arts', 'all', 'other', { order: 20, published: false, coaches: [{ id: 'xiaoxiao' }] }),
  course('youth-combat', 'kid', 'other', { order: 22, published: false }),
];

const COACHES: Coach[] = [
  coach('owen', 4),
  coach('chan', 1),
  coach('xiaoxiao', 5, false),
  coach('monkey', 2),
  coach('lisa', 3),
];

const ids = (list: { id: string }[]) => list.map((item) => item.id);

describe('buildHomeModel：steps', () => {
  it('依序是 fist、combat、weapon，每步帶各自的 beat', () => {
    const { steps } = buildHomeModel(ALL, COACHES);
    expect(steps.map((s) => s.category)).toEqual(['fist', 'combat', 'weapon']);
    expect(steps.map((s) => s.beats)).toEqual([
      ['fist'],
      ['combat-a', 'combat-b'],
      ['weapon-a', 'weapon-b', 'weapon-c'],
    ]);
  });

  it('大人與小孩各取該分類 order 最小且已發布的課', () => {
    const { steps } = buildHomeModel(ALL, COACHES);
    expect(steps.map((s) => [s.adult?.id, s.kid?.id])).toEqual([
      ['bajiquan', 'kids-martial-arts'],
      ['sanshou', 'kids-self-defense'],
      ['chinese-weapons', 'kids-weapons'],
    ]);
  });

  it('同分類有多門時取 order 最小者；order 相同取 id 較小者', () => {
    const more = [
      ...ALL,
      course('bajiquan-advanced', 'adult', 'fist', { order: 9 }),
      course('a-first', 'adult', 'fist', { order: 2 }),
      course('earlier', 'adult', 'fist', { order: 0, published: false }),
    ];
    const fist = buildHomeModel(more, COACHES).steps.find((s) => s.category === 'fist');
    expect(fist?.adult?.id).toBe('a-first');
  });

  it('未發布的課不出現在 steps', () => {
    const only = [
      course('x', 'adult', 'fist', { order: 1, published: false }),
      course('y', 'adult', 'fist', { order: 2 }),
    ];
    const { steps } = buildHomeModel(only, []);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.adult?.id).toBe('y');
  });

  it('RF4：整組沒有 combat 課，steps 不含 combat（不留空殼段落）', () => {
    const noCombat = ALL.filter((c) => c.data.category !== 'combat');
    const { steps } = buildHomeModel(noCombat, COACHES);
    expect(steps.map((s) => s.category)).toEqual(['fist', 'weapon']);
  });

  it('RF4：只有大人缺 weapon，該步 adult 為 undefined、kid 仍在', () => {
    const noAdultWeapon = ALL.filter((c) => !(c.data.category === 'weapon' && c.data.audience === 'adult'));
    const weapon = buildHomeModel(noAdultWeapon, COACHES).steps.find((s) => s.category === 'weapon');
    expect(weapon).toBeDefined();
    expect(weapon?.adult).toBeUndefined();
    expect(weapon?.kid?.id).toBe('kids-weapons');
  });

  it('RF4：完全沒有課程時，steps、others、coaches 都是空陣列', () => {
    expect(buildHomeModel([], [])).toEqual({ steps: [], others: [], coaches: [] });
  });

  it('不改動傳入的陣列', () => {
    const input = [...ALL];
    buildHomeModel(input, COACHES);
    expect(ids(input)).toEqual(ids(ALL));
  });
});

describe('buildHomeModel：others', () => {
  it('只含已發布且 category 為 other 的課，依 order 排', () => {
    const { others } = buildHomeModel(ALL, COACHES);
    expect(ids(others)).toEqual(['bjj', 'core-yoga']);
  });

  it('RF4：沒有其他課程時為空陣列', () => {
    const { others } = buildHomeModel(
      ALL.filter((c) => c.data.category !== 'other'),
      COACHES,
    );
    expect(others).toEqual([]);
  });

  it('只給單一對象的「其他」課（例如小孩的幼兒武術）不進 others，與課程總覽一致（放在該對象的卡片裡）', () => {
    const { others, steps } = buildHomeModel([...ALL, course('toddler', 'kid', 'other', { order: 23 })], COACHES);
    expect(ids(others)).toEqual(['bjj', 'core-yoga']);
    expect(steps.map((s) => s.kid?.id)).not.toContain('toddler');
  });

  it('主分類的課不會混進 others', () => {
    const { others } = buildHomeModel(ALL, COACHES);
    expect(others.every((c) => c.data.category === 'other')).toBe(true);
  });
});

describe('buildHomeModel：coaches', () => {
  it('只含已發布的教練，依 order 排', () => {
    const { coaches } = buildHomeModel(ALL, COACHES);
    expect(ids(coaches)).toEqual(['chan', 'monkey', 'lisa', 'owen']);
  });

  it('teaches 是該教練任教的已發布課程名（依課程 order）', () => {
    const { coaches } = buildHomeModel(ALL, COACHES);
    const byId = Object.fromEntries(coaches.map((c) => [c.id, c.teaches]));
    expect(byId.chan).toEqual(['課-chinese-weapons', '課-bajiquan', '課-sanshou']);
    expect(byId.monkey).toEqual(['課-kids-weapons', '課-kids-martial-arts', '課-kids-self-defense']);
    expect(byId.lisa).toEqual(['課-core-yoga']);
    expect(byId.owen).toEqual(['課-bjj']);
  });

  it('未發布的課不算進 teaches；教練只教未發布的課時 teaches 為空', () => {
    const { coaches } = buildHomeModel(ALL, [coach('xiaoxiao', 1)]);
    expect(coaches[0]?.teaches).toEqual([]);
  });

  it('保留教練原本的欄位', () => {
    const { coaches } = buildHomeModel(ALL, COACHES);
    expect(coaches[0]).toMatchObject({ id: 'chan', data: { name: '教練-chan', role: '職稱-chan' } });
  });

  it('RF4：沒有教練時為空陣列', () => {
    expect(buildHomeModel(ALL, []).coaches).toEqual([]);
    expect(buildHomeModel(ALL, [coach('xiaoxiao', 1, false)]).coaches).toEqual([]);
  });
});

describe('firstSentence：小孩招式註解取課程內文首句', () => {
  it('取第一段的第一個句子，含句號', () => {
    expect(firstSentence('戴上拳套，學會出手，也學會收手。\n\n這是給孩子的散打課。')).toBe('戴上拳套，學會出手，也學會收手。');
  });

  it('第一段有兩句時只取第一句', () => {
    expect(firstSentence('一招一式，慢慢站穩。課程以套路為主。')).toBe('一招一式，慢慢站穩。');
  });

  it('略過開頭的空行與 Markdown 標題符號', () => {
    expect(firstSentence('\n\n## 孩子第一次握住兵器的地方。\n\n其餘')).toBe('孩子第一次握住兵器的地方。');
  });

  it('沒有句號就整段回傳；空字串回空字串', () => {
    expect(firstSentence('只有一段沒有句號')).toBe('只有一段沒有句號');
    expect(firstSentence('')).toBe('');
    expect(firstSentence(undefined)).toBe('');
  });

  it('問號與驚嘆號也算句尾', () => {
    expect(firstSentence('準備好了嗎？開始。')).toBe('準備好了嗎？');
  });
});
