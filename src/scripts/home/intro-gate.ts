// 開場閘門（D18）：每個工作階段只在第一次進站演開場。記在 sessionStorage 的 `liuyi:qi-intro`。
// 隱私模式或瀏覽器封鎖 storage 時，讀寫都可能丟例外（RF3）：一律吞掉——讀不到就當沒看過（照演），寫不進去就不記。

export const INTRO_STORAGE_KEY = 'liuyi:qi-intro';

export function introSeen(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(INTRO_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markIntroSeen(storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(INTRO_STORAGE_KEY, '1');
  } catch {
    // 寫不進去：這次照演、下次也照演，只是不記住。
  }
}
