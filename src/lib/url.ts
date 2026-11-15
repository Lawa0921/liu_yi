import { joinBase } from './base';

/**
 * 全站唯一的 base 輔助函式：所有站內連結與 public 資源都經過它。
 *   url('/courses/')  ->  '/liu_yi/courses/'（或根路徑建置時的 '/courses/'）
 */
export function url(path: string): string {
  return joinBase(import.meta.env.BASE_URL, path);
}

/** 站內路徑的完整網址（canonical、Open Graph 用）。 */
export function absoluteUrl(path: string, site: URL | string | undefined): string {
  return new URL(url(path), site ?? 'http://localhost').href;
}
