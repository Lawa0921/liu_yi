// 引擎端的「大人｜小孩」同步（D21）：不改 audience-toggle.ts，只用 MutationObserver 看 `<html data-audience>`。
// 初始載入不算變動（BaseLayout 的行內腳本與 audience-toggle 開機時會寫同一個值）；
// 寫入相同的值也不算（`render()` 每次都會重寫屬性）。

import type { Audience } from '../../qi/config/poses';

export function currentAudience(root: HTMLElement = document.documentElement): Audience {
  return root.dataset.audience === 'kid' ? 'kid' : 'adult';
}

/** 對象真的變了才呼叫 `onChange`。回傳停止觀察的函式。 */
export function observeAudience(onChange: (audience: Audience) => void, root: HTMLElement = document.documentElement): () => void {
  let last = currentAudience(root);
  const observer = new MutationObserver(() => {
    const next = currentAudience(root);
    if (next === last) return;
    last = next;
    onChange(next);
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-audience'] });
  return () => observer.disconnect();
}
