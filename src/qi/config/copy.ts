/**
 * 首頁文案（設計 §7、決定 D24）。
 *
 * 這些是「提案」：課程名、教練、職稱來自內容集合，這裡只放首頁特有的短句——
 * 每一式的名稱與一行註解、三件兵器各一行、收費課表與預約的導引句。
 * 交付清單標「待業主確認」，八極招式名稱與說法尤其要業主看過。
 *
 * 守則（tests/unit/home-copy.test.ts 把關）：
 *   - 每行 ≤ 18 個字。
 *   - 不出現設計 §4 的反目標語彙。
 *   - 不放金額與時段（收費、課表只有海報，不轉成文字，避免抄錯）。
 */
import type { BeatId } from './poses';

/** 課程段六個 beat 的序號（六藝，一路數到六）。 */
export const BEAT_NO: Record<Extract<BeatId, 'fist' | 'combat-a' | 'combat-b' | 'weapon-a' | 'weapon-b' | 'weapon-c'>, string> = {
  fist: '一',
  'combat-a': '二',
  'combat-b': '三',
  'weapon-a': '四',
  'weapon-b': '五',
  'weapon-c': '六',
};

export interface MoveCopy {
  /** 序號（與 BEAT_NO 一致）。 */
  no: string;
  /** 這一式的名稱。 */
  name: string;
  /** 一行註解，必要時第二行。 */
  lines: [string, string?];
}

export const COPY: {
  opening: { sub: string; hint: string };
  /** 鍵是姿勢 id（config/poses.ts 的 PoseId）。 */
  moves: Record<string, MoveCopy>;
  weapons: Record<'jian' | 'miaodao' | 'spear', string>;
  pricing: { lead: string; facility: string };
  booking: { lead: string };
  others: { lead: string; all: string };
} = {
  opening: {
    sub: '八極拳・兵器・格鬥',
    hint: '往下捲',
  },

  moves: {
    // 大人
    dingzhou: { no: '一', name: '頂肘', lines: ['沉身擰腰，肘尖向前頂出。'] },
    chengchui: { no: '二', name: '撐捶', lines: ['一臂撐出，一臂護頭。'] },
    kao: { no: '三', name: '貼山靠', lines: ['沉肩貼身，整個人靠過去。'] },
    // 小孩：課程內文有首句時，頁面優先用首句（src/lib/home.ts 的 firstSentence），這裡是備用與名稱
    'kid-wushu': { no: '一', name: '起手', lines: ['雙拳護身，站穩再出手。'] },
    'kid-defense-a': { no: '二', name: '推掌', lines: ['一掌推出，守住自己的空間。'] },
    'kid-defense-b': { no: '三', name: '出拳', lines: ['拳送出去，也要收得回來。'] },
    'kid-weapon': { no: '四', name: '持劍', lines: ['雙手握穩，劍尖向前。'] },
  },

  weapons: {
    jian: '劍走輕靈，點、刺、削、撩。',
    miaodao: '雙手長刀，一刀一式，直來直往。',
    spear: '大槍丈二，扎、攔、拿，步步進身。',
  },

  pricing: {
    lead: '大人、兒童分班，月繳與堂數方案。',
    facility: '寬敞明亮的訓練場地，鏡面牆與地墊。',
  },

  booking: {
    lead: '先來上一堂，用 LINE 說一聲。',
  },

  others: {
    lead: '武術之外，也有這些課。',
    all: '所有課程',
  },
};
