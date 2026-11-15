// 每頁都有的互動：手機選單開關、「預約體驗」開 LINE QR 視窗。
//
// 標記約定（見 Header.astro、LineDialog.astro）：
//   [data-nav-toggle]   選單按鈕（aria-expanded、aria-controls 指向選單）
//   [data-line-open]    任何「預約體驗」連結；href="#line" 是沒有 JS 時的退路（跳到頁尾 QR）
//   #line-dialog        <dialog>，內含 QR code

export function initNavMenu(): void {
  const toggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
  const menuId = toggle?.getAttribute('aria-controls');
  const menu = menuId ? document.getElementById(menuId) : null;
  if (!toggle || !menu) return;

  const setOpen = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '關閉選單' : '開啟選單');
    menu.classList.toggle('is-open', open);
    // 手機的全螢幕選單展開時鎖住底下的捲動（樣式在 src/styles/chrome.css）。
    document.documentElement.classList.toggle('nav-open', open);
  };
  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';

  toggle.addEventListener('click', () => setOpen(!isOpen()));
  menu.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      setOpen(false);
      toggle.focus();
    }
  });
}

export function initLineDialog(): void {
  const dialog = document.getElementById('line-dialog');
  if (!(dialog instanceof HTMLDialogElement) || typeof dialog.showModal !== 'function') return;

  for (const opener of document.querySelectorAll<HTMLElement>('[data-line-open]')) {
    opener.addEventListener('click', (event) => {
      event.preventDefault();
      if (!dialog.open) dialog.showModal();
    });
  }

  // 點視窗外的暗色背景關閉。
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}
