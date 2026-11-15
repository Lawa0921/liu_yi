// 海報站內放大（見 src/components/PosterFigure.astro、PosterDialog.astro）。
//
//   a[data-poster]           海報連結；href 是原尺寸圖檔（沒有 JS 時就直接開圖檔）
//     data-poster-alt        放大後圖片的替代文字
//     data-poster-width/height  原尺寸（先給定比例，載入時版面不跳）
//   #poster-dialog           <dialog>，裡面的 [data-poster-image] 是放大的圖
//
// 開啟：點擊或鍵盤 Enter（連結的預設行為被攔下）。
// 關閉：關閉鈕、Esc（<dialog> 原生）、點圖以外的地方。關閉後焦點由瀏覽器還給原本的連結。

export function initPosterLightbox(): void {
  const dialog = document.getElementById('poster-dialog');
  if (!(dialog instanceof HTMLDialogElement) || typeof dialog.showModal !== 'function') return;
  const image = dialog.querySelector<HTMLImageElement>('[data-poster-image]');
  if (!image) return;

  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-poster]')) {
    link.addEventListener('click', (event) => {
      // 使用者要另開分頁（Ctrl／⌘／中鍵）時不攔。
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();

      const { posterAlt, posterWidth, posterHeight } = link.dataset;
      if (posterWidth && posterHeight) {
        image.width = Number(posterWidth);
        image.height = Number(posterHeight);
      }
      image.alt = posterAlt ?? '';
      image.src = link.href;
      if (!dialog.open) dialog.showModal();
      dialog.scrollTop = 0;
    });
  }

  // 點到視窗本身（圖與關閉鈕以外的留白）就關閉。
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}
