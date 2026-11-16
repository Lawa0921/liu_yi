// 首頁靜態圖（建置時由 integrations/qi-assets.ts 產生在 src/assets/generated/qi/stills/）的網址與尺寸。
// 圖檔與 stills.json 都是建置產物；找不到就在建置時直接失敗，不輸出破圖。
import stillMeta from '../assets/generated/qi/stills/stills.json';

const urls = import.meta.glob<string>('../assets/generated/qi/stills/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

export interface StillInfo {
  src: string;
  width: number;
  height: number;
}

const meta: Record<string, { width: number; height: number } | undefined> = stillMeta;

export function stillInfo(name: string): StillInfo {
  const src = urls[`../assets/generated/qi/stills/${name}.webp`];
  const size = meta[name];
  if (!src || !size) throw new Error(`Still "${name}" is missing: run the build once so integrations/qi-assets.ts generates it`);
  return { src, width: size.width, height: size.height };
}
