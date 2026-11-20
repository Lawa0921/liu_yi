import { describe, expect, it } from 'vitest';
import { courseVideo, videoEmbed } from '../../src/lib/video';

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

describe('courseVideo（課程影片區要顯示什麼）', () => {
  const file = { src: '/videos/bajiquan.mp4', poster: 'poster', width: 720, height: 720 };

  it('有站內影片時用站內影片，優先於 YouTube 網址', () => {
    expect(courseVideo(file, 'https://youtu.be/dQw4w9WgXcQ')).toEqual({ kind: 'file', file });
    expect(courseVideo(file, undefined)).toEqual({ kind: 'file', file });
  });

  it('沒有站內影片時照舊看 videoUrl', () => {
    expect(courseVideo(undefined, 'https://youtu.be/dQw4w9WgXcQ')).toEqual(videoEmbed('https://youtu.be/dQw4w9WgXcQ'));
    expect(courseVideo(undefined, 'https://vimeo.com/123')).toEqual({ kind: 'link', url: 'https://vimeo.com/123' });
  });

  it('兩者都沒有時回傳 null（整個影片區不輸出）', () => {
    expect(courseVideo(undefined, undefined)).toBeNull();
    expect(courseVideo(undefined, '  ')).toBeNull();
  });
});
