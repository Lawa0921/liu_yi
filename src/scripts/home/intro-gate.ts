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

/**
 * 入館閘門要不要顯示（Task 25）。只有「首次進站、而且開場演得起來」的訪客才擋：
 *   - `reducedMotion`：偏好減少動態——不演開場，也就不需要閘門；
 *   - `noWebgl`：取不到 WebGL2（含引擎掛不上）——光點不會動，閘門沒有意義；
 *   - `visited`：這個工作階段進過館（`introSeen`；再訪、按上一頁回來）；
 *   - `hasHash`：網址帶 `#錨點`（例如 `#booking`）——直接前往某一段，不擋；
 *   - `fromSite`：從站內其他頁進來（`document.referrer` 在本站的 base 底下）——已經在站內，不擋。
 * 純函式；<head> 的行內腳本（BaseLayout）在首繪前用同一條判斷，單元測試以 vm 跑那段腳本對照這個函式。
 */
export interface GateEnv {
  reducedMotion: boolean;
  noWebgl: boolean;
  visited: boolean;
  hasHash: boolean;
  fromSite: boolean;
}

export function shouldShowGate(env: GateEnv): boolean {
  return !env.reducedMotion && !env.noWebgl && !env.visited && !env.hasHash && !env.fromSite;
}
