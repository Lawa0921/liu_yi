import { describe, expect, it } from 'vitest';
import { heroCover, videoEmbed } from '../../src/lib/video';

describe('videoEmbed', () => {
  it('returns null when there is no URL, so the video section is not rendered', () => {
    expect(videoEmbed(undefined)).toBeNull();
    expect(videoEmbed(null)).toBeNull();
    expect(videoEmbed('')).toBeNull();
    expect(videoEmbed('   ')).toBeNull();
  });

  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?t=10',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
  ])('recognises YouTube URL %s', (url) => {
    expect(videoEmbed(url)).toEqual({
      kind: 'youtube',
      id: 'dQw4w9WgXcQ',
      url,
      embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1',
    });
  });

  it('falls back to a plain link for other http(s) URLs', () => {
    expect(videoEmbed('https://vimeo.com/123')).toEqual({ kind: 'link', url: 'https://vimeo.com/123' });
    expect(videoEmbed('https://www.youtube.com/watch?v=tooshort')).toEqual({
      kind: 'link',
      url: 'https://www.youtube.com/watch?v=tooshort',
    });
  });

  it('rejects things that are not http(s) URLs', () => {
    expect(videoEmbed('javascript:alert(1)')).toBeNull();
    expect(videoEmbed('not a url')).toBeNull();
  });
});

describe('heroCover（首屏影片格一開始顯示的封面）', () => {
  const file = { src: '/videos/bajiquan.mp4', poster: 'poster', width: 720, height: 720 };

  it('video 有 cover 時用那張圖（不是影片畫格的 poster）', () => {
    expect(heroCover({ ...file, cover: 'cover-image' })).toEqual({ kind: 'image', src: 'cover-image' });
  });

  it('沒有 cover 時用分類字牌', () => {
    expect(heroCover(file)).toEqual({ kind: 'plate' });
    expect(heroCover({ ...file, cover: undefined })).toEqual({ kind: 'plate' });
  });

  it('沒有站內影片就沒有封面', () => {
    expect(heroCover(undefined)).toBeNull();
  });
});
