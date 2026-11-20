// 課程影片網址 → 要怎麼顯示。回傳 null 代表「整個影片區不要出現」。

export type VideoEmbed =
  | { kind: 'youtube'; id: string; url: string; embedUrl: string }
  | { kind: 'link'; url: string };

const YOUTUBE_ID = /^[\w-]{11}$/;

function youtubeId(parsed: URL): string | undefined {
  const host = parsed.hostname.replace(/^(www\.|m\.)/, '');
  let candidate: string | null | undefined;

  if (host === 'youtu.be') {
    candidate = parsed.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, first, second] = parsed.pathname.split('/');
    candidate = first === 'watch' ? parsed.searchParams.get('v') : first === 'shorts' || first === 'embed' ? second : undefined;
  }

  return candidate && YOUTUBE_ID.test(candidate) ? candidate : undefined;
}

export function videoEmbed(rawUrl: string | null | undefined): VideoEmbed | null {
  const url = rawUrl?.trim();
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  const id = youtubeId(parsed);
  if (id) {
    return { kind: 'youtube', id, url, embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1` };
  }
  return { kind: 'link', url };
}

/** 站內影片檔（public/ 底下）：src 是站內路徑（渲染時經過 url() 加 base），width／height 是影片像素尺寸。 */
export interface VideoFile<Poster = unknown> {
  src: string;
  poster: Poster;
  width: number;
  height: number;
}

export type CourseVideo<Poster = unknown> = { kind: 'file'; file: VideoFile<Poster> } | VideoEmbed;

/** 課程影片區要顯示什麼：站內影片優先於 videoUrl；兩者都沒有回傳 null（整個影片區不輸出）。 */
export function courseVideo<Poster>(file: VideoFile<Poster> | undefined, videoUrl: string | null | undefined): CourseVideo<Poster> | null {
  if (file) return { kind: 'file', file };
  return videoEmbed(videoUrl);
}
