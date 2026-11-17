// 剪影場景的素材載入（只給 Astro 元件用：`components/Scene.astro`、`components/home/Depth.astro`；單元測試不 import 這個檔案）。
// 素材是 src/assets/silhouettes/<名稱>.webp（黑色加透明）；用原檔的網址（不經過圖片服務重新編碼）。找不到就在建置時直接失敗，不輸出破圖。

const files = import.meta.glob<{ default: ImageMetadata }>('../../assets/silhouettes/*.webp', { eager: true });

export interface SceneImage {
  asset: string;
  src: string;
  width: number;
  height: number;
}

export function sceneImage(asset: string): SceneImage {
  const found = files[`../../assets/silhouettes/${asset}.webp`];
  if (!found) throw new Error(`Scene asset "${asset}" is missing from src/assets/silhouettes`);
  const { src, width, height } = found.default;
  return { asset, src, width, height };
}
