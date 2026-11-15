// 進場效果：元素進入視窗時加上 .is-in，樣式（淡入、遮罩擦出、畫線）在 src/styles/ornament.css。
// 用瀏覽器原生的 IntersectionObserver，不載入動畫函式庫（設計文件 §6「動態的規矩」）。
//
//   [data-reveal]           淡入並微微上移
//   [data-reveal="wipe"]    遮罩擦出（照片）
//   [data-reveal="line"]    線條由左畫出
//   style="--reveal-i: n"   同一組裡的先後順序
//
// 「減少動態」時樣式本來就不會把內容藏起來，這裡也就不用做事；沒有 JS 時同理。

export function initReveal(): void {
  const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
  if (targets.length === 0) return;

  const showAll = () => {
    for (const target of targets) target.classList.add('is-in');
  };

  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    showAll();
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    },
    // 進到視窗底部往上 8% 才算，避免剛露出一條邊就播完。
    { rootMargin: '0px 0px -8% 0px' },
  );
  for (const target of targets) observer.observe(target);

  // 列印或瀏覽器找字跳到的內容不能是透明的。
  window.addEventListener('beforeprint', showAll);
}
