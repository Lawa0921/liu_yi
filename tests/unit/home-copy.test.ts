import { describe, expect, it } from 'vitest';
import { BEAT_NO, COPY } from '../../src/qi/config/copy';

/** 把 COPY 裡所有字串攤平（含巢狀物件與陣列）。 */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

const ALL = strings(COPY);

/** 設計 §4 反目標：不得出現的語彙。 */
const FORBIDDEN = /太極|八卦|卦|龍|鳳|袴|和服|忍者|日式|書法|水墨/;

describe('首頁文案（設計 §4 閘門）', () => {
  it('有掃到字串（防止攤平邏輯壞了而空過）', () => {
    expect(ALL.length).toBeGreaterThan(15);
  });

  it('沒有任何反目標語彙', () => {
    expect(ALL.filter((text) => FORBIDDEN.test(text))).toEqual([]);
  });

  it('每行不超過 18 個字', () => {
    expect(ALL.filter((text) => [...text].length > 18).map((text) => `${[...text].length}字：${text}`)).toEqual([]);
  });

  it('沒有空字串與頭尾空白', () => {
    expect(ALL.filter((text) => text.trim() === '' || text !== text.trim())).toEqual([]);
  });

  it('文案沒有金額與時段（課表只有海報，不轉成文字；收費方案不公開）', () => {
    expect(ALL.filter((text) => /NT|\$|元|\d{3,}/.test(text))).toEqual([]);
  });

  it('課表段不提收費方案，改引導用 LINE 詢問費用', () => {
    expect(COPY.pricing.lead).toBe('大人、兒童分班，各班時段請看課表。');
    expect(COPY.pricing.ask).toBe('費用與方案，歡迎用 LINE 詢問。');
    expect(ALL.filter((text) => /收費|月繳|堂數/.test(text))).toEqual([]);
  });
});

describe('首頁文案的結構', () => {
  it('moves 涵蓋 dingzhou、chengchui、kao，每式有序號、名稱與至少一行', () => {
    for (const key of ['dingzhou', 'chengchui', 'kao']) {
      const move = COPY.moves[key];
      expect(move, key).toBeDefined();
      expect(move!.no, key).not.toBe('');
      expect(move!.name, key).not.toBe('');
      expect(move!.lines[0], key).not.toBe('');
    }
  });

  it('小孩的四式也有文案（備用，課程內文缺首句時用）', () => {
    for (const key of ['kid-wushu', 'kid-defense-a', 'kid-defense-b', 'kid-weapon', 'kid-miaodao', 'kid-spear']) {
      expect(COPY.moves[key]?.lines[0], key).toBeTruthy();
    }
  });

  it('weapons 三件齊全，每件有一行', () => {
    expect(Object.keys(COPY.weapons).sort()).toEqual(['jian', 'miaodao', 'spear']);
    for (const line of Object.values(COPY.weapons)) expect(line.length).toBeGreaterThan(0);
  });

  it('opening、pricing、booking、others 的欄位都在', () => {
    expect(COPY.opening.sub).toContain('八極拳・兵器・格鬥');
    expect(COPY.opening.hint).toBe('往下捲');
    expect(COPY.pricing.lead).toBeTruthy();
    expect(COPY.pricing.facility).toBeTruthy();
    expect(COPY.pricing.ask).toBeTruthy();
    expect(COPY.booking.lead).toBeTruthy();
    expect(COPY.others.lead).toBeTruthy();
    expect(COPY.others.all).toBe('所有課程');
  });

  it('招式序號與 beat 序號一致（六個 beat 依序一到六）', () => {
    expect(Object.values(BEAT_NO)).toEqual(['一', '二', '三', '四', '五', '六']);
    expect(COPY.moves.dingzhou!.no).toBe(BEAT_NO.fist);
    expect(COPY.moves.chengchui!.no).toBe(BEAT_NO['combat-a']);
    expect(COPY.moves.kao!.no).toBe(BEAT_NO['combat-b']);
    expect(COPY.moves['kid-wushu']!.no).toBe(BEAT_NO.fist);
    expect(COPY.moves['kid-defense-a']!.no).toBe(BEAT_NO['combat-a']);
    expect(COPY.moves['kid-defense-b']!.no).toBe(BEAT_NO['combat-b']);
    expect(COPY.moves['kid-weapon']!.no).toBe(BEAT_NO['weapon-a']);
    expect(COPY.moves['kid-miaodao']!.no).toBe(BEAT_NO['weapon-b']);
    expect(COPY.moves['kid-spear']!.no).toBe(BEAT_NO['weapon-c']);
  });
});
