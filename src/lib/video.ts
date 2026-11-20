// 課程影片相關的純邏輯（不依賴 Astro，可單元測試）。
//   videoEmbed：外連影片網址（videoUrl）→ 要怎麼顯示；回傳 null 代表「整個影片區不要出現」（VideoSection.astro）。
//   heroCover：站內影片（video）在課程內頁首屏一開始顯示的封面（src/pages/courses/[slug].astro）。

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

export type HeroCover<Image = unknown> = { kind: 'image'; src: Image } | { kind: 'plate' };

/**
 * 課程內頁首屏影片格一開始顯示的封面（點了才換成影片）：video.cover 有圖就用圖，沒有就用該課分類的字牌。
 * 沒有站內影片回傳 null（首屏右側是照片或字牌本身，不是影片格）。
 */
export function heroCover<Image>(video: { src: string; cover?: Image | undefined } | undefined): HeroCover<Image> | null {
  if (!video) return null;
  return video.cover ? { kind: 'image', src: video.cover } : { kind: 'plate' };
}
