// 課程內頁首屏影片的播放鈕（見 src/pages/courses/[slug].astro）。
//
//   [data-hero-video]   影片格；裡面一個 <video controls playsinline preload="none">
//   [data-hero-play]    蓋在封面中央的 <button>（data-requires-js：沒有 JS 時不顯示，原生控制列照常可用）
//
// 按播放鈕 → 影片取得焦點並開始播放（使用者手勢觸發，有聲）。只要影片開始播放（play 事件，
// 不論是按這顆鈕還是直接用原生控制列），播放鈕就收起來，之後都用原生控制列操作。
// 每次載入頁面都會執行（站內換頁是整頁載入＋轉場）；同一個影片格只綁一次。
// 這支會被打包到瀏覽器端：字串只放英文，中文標籤寫在 .astro。

export function initHeroVideos(): void {
  for (const root of document.querySelectorAll<HTMLElement>('[data-hero-video]')) {
    if (root.dataset.heroVideoBound !== undefined) continue;
    const video = root.querySelector('video');
    const button = root.querySelector<HTMLButtonElement>('[data-hero-play]');
    if (!video || !button) continue;
    root.dataset.heroVideoBound = '';

    const hide = () => {
      button.hidden = true;
    };
    if (!video.paused) hide();
    video.addEventListener('play', hide);

    button.addEventListener('click', () => {
      video.focus();
      // 瀏覽器擋下或不支援這個格式時，影片仍是暫停的：把播放鈕放回來，訪客可再試或用控制列。
      video.play()?.catch(() => {
        if (video.paused) button.hidden = false;
      });
    });
  }
}
