// 「大人｜小孩」切換的狀態邏輯（純邏輯，不碰 DOM，可單元測試）。
// DOM 接線在 src/scripts/audience-toggle.ts。

import type { Audience } from './courses';

export const AUDIENCE_STORAGE_KEY = 'liuyi:audience';
export const DEFAULT_AUDIENCE: Audience = 'adult';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

export function parseAudience(raw: unknown): Audience {
  return raw === 'adult' || raw === 'kid' ? raw : DEFAULT_AUDIENCE;
}

/** 讀不到、值不合法、或 storage 被瀏覽器擋掉時，一律回預設（大人）。 */
export function readAudience(storage: ReadableStorage | null | undefined): Audience {
  try {
    return parseAudience(storage?.getItem(AUDIENCE_STORAGE_KEY));
  } catch {
    return DEFAULT_AUDIENCE;
  }
}

export function writeAudience(storage: WritableStorage | null | undefined, audience: Audience): void {
  try {
    storage?.setItem(AUDIENCE_STORAGE_KEY, parseAudience(audience));
  } catch {
    // 隱私模式等情況寫不進去：這次瀏覽仍可切換，只是不會記住。
  }
}

export interface AudienceState {
  get(): Audience;
  set(audience: Audience): void;
}

export function createAudienceState(options: {
  storage?: (ReadableStorage & WritableStorage) | null;
  onChange?: (audience: Audience) => void;
}): AudienceState {
  const { storage, onChange } = options;
  let current = readAudience(storage);

  return {
    get: () => current,
    set(audience) {
      const next = parseAudience(audience);
      if (next === current) return;
      current = next;
      writeAudience(storage, next);
      onChange?.(next);
    },
  };
}
