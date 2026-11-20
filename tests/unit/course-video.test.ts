import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 六門主課的課程簡介影片（業主提供、已壓成 720p H.264）。
// 內容層：每門課的 md 有 video: { src, poster, width, height }，src 指到 public/videos/ 裡真的存在的檔案。

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const EXPECTED = [
  { id: 'chinese-weapons', width: 1280, height: 720 },
  { id: 'bajiquan', width: 720, height: 720 },
  { id: 'sanshou', width: 1280, height: 720 },
  { id: 'kids-weapons', width: 720, height: 1280 },
  { id: 'kids-martial-arts', width: 1280, height: 720 },
  { id: 'kids-self-defense', width: 1280, height: 720 },
];

const MAX_BYTES = 6 * 1024 * 1024;

interface VideoField {
  src: string;
  poster: string;
  width: number;
  height: number;
}

function videoField(md: string): VideoField | undefined {
  const match = /^video:\r?\n\s+src: (\S+)\r?\n\s+poster: (\S+)\r?\n\s+width: (\d+)\r?\n\s+height: (\d+)\s*$/m.exec(md);
  if (!match) return undefined;
  return { src: match[1]!, poster: match[2]!, width: Number(match[3]), height: Number(match[4]) };
}

/** 讀 MP4 視訊軌的 tkhd（寬高是 16.16 定點數）；音軌的寬高是 0，跳過。 */
function mp4Size(path: string): { width: number; height: number } | undefined {
  const buffer = readFileSync(path);
  let at = buffer.indexOf('tkhd');
  while (at !== -1) {
    const version = buffer[at + 4];
    const offset = at + 4 + (version === 1 ? 88 : 76);
    const width = buffer.readUInt32BE(offset) / 65536;
    const height = buffer.readUInt32BE(offset + 4) / 65536;
    if (width > 0 && height > 0) return { width, height };
    at = buffer.indexOf('tkhd', at + 4);
  }
  return undefined;
}

describe('六門主課的課程影片（內容層）', () => {
  for (const { id, width, height } of EXPECTED) {
    describe(id, () => {
      const mdPath = `src/content/courses/${id}.md`;
      const video = videoField(read(mdPath));

      it('md 有 video 欄位，src 是 /videos/<課程 id>.mp4', () => {
        expect(video, `${mdPath} 的 video 欄位`).toBeDefined();
        expect(video!.src).toBe(`/videos/${id}.mp4`);
      });

      it('影片檔存在於 public/videos/，小於 6 MB', () => {
        const file = join(root, 'public', video!.src);
        expect(existsSync(file), file).toBe(true);
        expect(statSync(file).size).toBeLessThan(MAX_BYTES);
      });

      it(`寬高是 ${width}×${height}，與影片檔本身一致`, () => {
        expect({ width: video!.width, height: video!.height }).toEqual({ width, height });
        expect(mp4Size(join(root, 'public', video!.src))).toEqual({ width, height });
      });

      it('封面是同課程的 *-poster.jpg，檔案存在', () => {
        expect(video!.poster).toBe(`../../assets/images/video/${id}-poster.jpg`);
        expect(existsSync(resolve(dirname(join(root, mdPath)), video!.poster))).toBe(true);
      });
    });
  }
});

describe('八極專修、散手技擊的課程卡改用乾淨裁切的照片', () => {
  it.each([
    ['bajiquan', '兩位學員在教室裡面對面練習對練'],
    ['sanshou', '兩位學員戴著拳套與手靶對練'],
  ])('%s：photos 第一張是 *-card.jpg，alt 照規格', (id, alt) => {
    const md = read(`src/content/courses/${id}.md`);
    expect(md).toMatch(new RegExp(`^photos:\\r?\\n\\s+- src: \\.\\./\\.\\./assets/images/video/${id}-card\\.jpg\\r?\\n\\s+alt: ${alt}\\s*$`, 'm'));
  });

  it.each(['bajiquan', 'sanshou'])('%s：*-card.jpg 是影片截圖，標 cardOnly: true（課程內頁的照片區不顯示）', (id) => {
    const md = read(`src/content/courses/${id}.md`);
    expect(md).toMatch(new RegExp(`^\\s+- src: \\.\\./\\.\\./assets/images/video/${id}-card\\.jpg\\r?\\n\\s+alt: .+\\r?\\n\\s+cardOnly: true\\s*$`, 'm'));
  });

  it('其他課程的照片都不是 cardOnly（內頁照片區照常顯示）', () => {
    for (const id of ['chinese-weapons', 'kids-weapons', 'kids-martial-arts', 'kids-self-defense', 'bjj', 'core-yoga']) {
      expect(read(`src/content/courses/${id}.md`), id).not.toMatch(/cardOnly: true/);
    }
  });

  it('schema：photo 有可選的 cardOnly 布林，預設 false', () => {
    expect(read('src/content.config.ts')).toMatch(/cardOnly: z\.boolean\(\)\.default\(false\)/);
  });

  it('八極專修不再標註「待業主補：實拍照、影片」', () => {
    expect(read('src/content/courses/bajiquan.md')).not.toContain('待業主補：實拍照、影片');
  });

  it('中式兵器仍然沒有照片（課程卡維持 3D 兵器字牌）', () => {
    expect(read('src/content/courses/chinese-weapons.md')).toMatch(/^photos: \[\]/m);
  });
});
