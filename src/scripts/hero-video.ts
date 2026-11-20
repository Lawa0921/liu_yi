// 課程內頁首屏的影片格（見 src/pages/courses/[slug].astro）。
//
//   [data-hero-video]          影片格；裡面一個 <video controls playsinline preload="none">
//   [data-hero-cover]          蓋在影片上的封面（圖或分類字牌）；data-requires-js：沒有 JS 時不顯示，就是原生 video＋poster
//   [data-hero-play]           封面左上角的播放鈕（封面裡唯一可聚焦的元素）
//   data-hero-started（加在影片格上）  封面收起、影片顯示（樣式在 [slug].astro）
//
// 有 JS 時從第一次繪製就是封面、影片隱藏（CSS 以 html.js 判斷，不等這支腳本）。
// 點封面任何位置或播放鈕（按鈕在封面裡，點擊冒泡上來；鍵盤 Enter／Space 也是 click）→ 封面收起、影片顯示並取得焦點、開始播放（使用者手勢，有聲）。
// 只要影片開始播放（play 事件，不論從哪裡觸發），封面也收起。收起之後不會再蓋回去：
// play() 被拒（瀏覽器擋下、格式不支援，或 play 事件先觸發、promise 之後才被拒）時，影片維持顯示＋原生控制列，訪客可以自己按播放。
// 每次載入頁面都會執行（站內換頁是整頁載入＋轉場）；同一個影片格只綁一次。
// 這支會被打包到瀏覽器端：字串只放英文，中文標籤寫在 .astro。

export function initHeroVideos(): void {
  for (const root of document.querySelectorAll<HTMLElement>('[data-hero-video]')) {
    if (root.dataset.heroVideoBound !== undefined) continue;
    const video = root.querySelector('video');
    const cover = root.querySelector<HTMLElement>('[data-hero-cover]');
    if (!video || !cover) continue;
    root.dataset.heroVideoBound = '';

    const reveal = () => {
      root.dataset.heroStarted = '';
    };
    if (!video.paused) reveal();
    video.addEventListener('play', reveal);

    cover.addEventListener('click', () => {
      reveal();
      video.focus();
      video.play()?.catch(() => undefined);
    });
  }
}
