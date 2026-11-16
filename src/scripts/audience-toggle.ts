// 「大人｜小孩」切換的 DOM 接線。狀態邏輯在 src/lib/audience.ts。
//
// 標記約定（見 src/components/AudienceCards.astro）：
//   <html data-audience="adult|kid">           目前的對象；CSS 依它隱藏另一組卡片
//   [data-audience-option="adult|kid"]         切換按鈕（aria-pressed 反映狀態）
//   [data-audience-panel="adult|kid"]          各對象的卡片組
// 首次繪製前，BaseLayout 的行內腳本會先依 localStorage 設好 <html data-audience>，避免閃一下。

import { createAudienceState } from '../lib/audience';
import { createDoors, type DoorController } from './audience-doors';
import type { Audience } from '../lib/courses';

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 按鈕的狀態馬上換；卡片組（<html data-audience>）由門扇在合上的那一刻換（src/scripts/audience-doors.ts）。 */
function pressed(audience: Audience): void {
  for (const button of document.querySelectorAll<HTMLElement>('[data-audience-option]')) {
    button.setAttribute('aria-pressed', String(button.dataset.audienceOption === audience));
  }
}

function show(audience: Audience): void {
  document.documentElement.dataset.audience = audience;
}

export function initAudienceToggle(): void {
  const buttons = document.querySelectorAll<HTMLElement>('[data-audience-option]');
  if (buttons.length === 0) return;

  let doors: DoorController | null = null;
  const state = createAudienceState({
    storage: safeLocalStorage(),
    onChange: (audience) => {
      pressed(audience);
      doors?.request(audience);
    },
  });
  show(state.get());
  pressed(state.get());
  doors = createDoors(state.get(), show);

  for (const button of buttons) {
    button.addEventListener('click', () => {
      state.set(button.dataset.audienceOption as Audience);
    });
  }
}
