// 輕量影片嵌入：點擊後才載入播放器（見 src/components/VideoSection.astro）。
//   [data-lite-video]  是一個 <a href="影片網址" data-embed-url="…">；沒有 JS 時就是普通連結。

export function initLiteVideos(): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-lite-video]')) {
    link.addEventListener('click', (event) => {
      const embedUrl = link.dataset.embedUrl;
      if (!embedUrl) return;
      event.preventDefault();

      const iframe = document.createElement('iframe');
      iframe.src = embedUrl;
      iframe.title = link.dataset.title ?? '課程影片';
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      iframe.allowFullscreen = true;
      iframe.loading = 'lazy';
      iframe.className = 'lite-video__frame';
      link.replaceWith(iframe);
      iframe.focus();
    });
  }
}
