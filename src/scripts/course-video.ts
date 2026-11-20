// 課程卡的影片播放鈕 → 站內影片視窗（見 src/components/CourseCard.astro、CourseVideoDialog.astro）。
//
//   a[data-course-video]        播放鈕；href 是 mp4（沒有 JS 時就直接開影片檔）
//     data-video-title          課程名稱（視窗標題）
//     data-video-poster         封面網址
//     data-video-width/height   影片像素尺寸（視窗依它保持原比例）
//   #course-video-dialog        <dialog>，裡面一個 <video controls playsinline preload="none">（平常沒有 src）
//     data-label-suffix         視窗的無障礙名稱 = 課程名稱 + 這段字
//
// 開啟：點擊（Ctrl／⌘／Shift／中鍵照瀏覽器預設，另開影片檔）→ 設定 src 與 poster、開視窗、開始播放（有聲，使用者手勢觸發）。
// 關閉：關閉鈕、Esc（<dialog> 原生）、點影片以外的留白 → 暫停、釋放來源，焦點回到剛才按的播放鈕。
// 這支會被打包到瀏覽器端：字串只放英文，中文標籤由 .astro 以 data-* 帶進來。

export function initCourseVideoDialog(): void {
  const dialog = document.getElementById('course-video-dialog');
  if (!(dialog instanceof HTMLDialogElement) || typeof dialog.showModal !== 'function') return;
  const video = dialog.querySelector('video');
  if (!video) return;
  const title = dialog.querySelector<HTMLElement>('[data-course-video-title]');
  const suffix = dialog.dataset.labelSuffix ?? '';
  let opener: HTMLElement | null = null;

  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-course-video]')) {
    link.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();

      const { videoTitle = '', videoPoster, videoWidth, videoHeight } = link.dataset;
      const width = Number(videoWidth);
      const height = Number(videoHeight);
      if (width > 0 && height > 0) {
        dialog.style.setProperty('--video-w', String(width));
        dialog.style.setProperty('--video-h', String(height));
        video.width = width;
        video.height = height;
      }
      if (videoPoster) video.poster = videoPoster;
      else video.removeAttribute('poster');
      if (title) title.textContent = videoTitle;
      dialog.setAttribute('aria-label', `${videoTitle}${suffix}`);

      opener = link;
      video.src = link.getAttribute('href') ?? link.href;
      if (!dialog.open) dialog.showModal();
      // 瀏覽器不支援這個格式、或被擋時就留在暫停狀態，訪客可再按播放器的播放鍵。
      video.play()?.catch(() => undefined);
    });
  }

  // 點到視窗本身（影片與關閉鈕以外的留白）就關閉。
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener('close', () => {
    video.pause();
    video.removeAttribute('src');
    video.load(); // 釋放已下載的緩衝與連線
    opener?.focus();
    opener = null;
  });
}
