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
