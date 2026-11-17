import sharp from 'sharp';

/**
 * 燙金獅子館徽的素材轉換（Task 24）：`logo_large.jpg` 是黑底、米白線條的點陣圖，這裡把它轉成
 * 「透明底、金色」的 PNG——黑變透明（亮度當不透明度）、米白換成一條斜向的古金色帶（高光與暗部交錯，像燙金箔的反光）。
 *
 * 為什麼不用混色模式（mix-blend-mode: lighten）讓黑底融進頁面：開場區是獨立的堆疊環境，混色只和它自己裡面的東西比，
 * 比不到後面的光點畫布；黑底會變成一塊不透明的方塊，把散開的光點蓋住。真正的透明底在任何背景上都乾淨。
 *
 * 顏色取自 tokens.css 的古金（--gold-400 #c9a866、--gold-500 #b3924f），高光與暗部是同一色相的明暗，不另開色。
 * 只用 Node 與 sharp；成品入庫（`npm run crest:build` 重建），CI 與一般建置不跑這個程式。
 */

export const CREST_SOURCE = 'src/assets/images/logo_large.jpg';
export const CREST_OUTPUT = 'src/assets/images/crest-lion.png';
/** 成品寬度（px）；<Image> 再依裝置切出更小的 webp，所以這裡留足夠的解析度即可。 */
export const CREST_WIDTH = 960;

/** 色帶：沿斜向（CSS 角度 115°）由 0 到 1。深色段不低於 #b08c48：館徽在手機上只有 80–110px，細線條縮小後本來就會變暗，色帶不能再暗。 */
const STOPS: readonly (readonly [number, string])[] = [
  [0.0, '#f4e6b8'],
  [0.14, '#ecd493'],
  [0.3, '#d9b870'],
  [0.46, '#c09a52'],
  [0.58, '#b08c48'],
  [0.72, '#d9b870'],
  [0.86, '#f0dca4'],
  [1.0, '#c9a866'],
];
const ANGLE_DEG = 115;

/** 亮度（0–255）低於 LOW 全透明、高於 HIGH 全不透明，中間平滑過渡（保留反鋸齒邊緣，濾掉 JPEG 的雜訊）。 */
const ALPHA_LOW = 18;
const ALPHA_HIGH = 200;
/** 找外框時，亮度超過這個值才算線條。 */
const BOX_THRESHOLD = 40;
/** 外框四周留白，占外框寬的比例。 */
const PAD = 0.04;

const hex = (value: string): [number, number, number] => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];
const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smoothstep = (a: number, b: number, x: number): number => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** 色帶在 t（0–1）處的顏色。 */
function ramp(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i]!;
    const [t0, c0] = STOPS[i - 1]!;
    if (clamped <= t1) {
      const u = (clamped - t0) / (t1 - t0);
      const a = hex(c0);
      const b = hex(c1);
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
  }
  return hex(STOPS[STOPS.length - 1]![1]);
}

export interface CrestResult {
  /** RGBA PNG。 */
  png: Buffer;
  width: number;
  height: number;
}

export async function renderCrest(options: { input: Buffer | string; width: number }): Promise<CrestResult> {
  const { data, info } = await sharp(options.input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width;
  let x1 = -1;
  let y0 = info.height;
  let y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const o = (y * info.width + x) * 3;
      if (luma(data[o]!, data[o + 1]!, data[o + 2]!) <= BOX_THRESHOLD) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error('The source image has no bright pixels to build a crest from.');

  const pad = Math.round((x1 - x0 + 1) * PAD);
  const left = Math.max(0, x0 - pad);
  const top = Math.max(0, y0 - pad);
  const cropW = Math.min(info.width, x1 + pad + 1) - left;
  const cropH = Math.min(info.height, y1 + pad + 1) - top;
  const width = options.width;
  const height = Math.round((cropH * width) / cropW);

  const scaled = await sharp(options.input)
    .removeAlpha()
    .extract({ left, top, width: cropW, height: cropH })
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();

  const angle = (ANGLE_DEG * Math.PI) / 180;
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  // 投影的範圍：四個角在斜向軸上的最小與最大值，色帶剛好鋪滿整張圖
  const corners = [0, width].flatMap((x) => [0, height].map((y) => x * dx + y * dy));
  const lo = Math.min(...corners);
  const span = Math.max(...corners) - lo;

  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const [r, g, b] = ramp((x * dx + y * dy - lo) / span);
      const alpha = smoothstep(ALPHA_LOW, ALPHA_HIGH, luma(scaled[i * 3]!, scaled[i * 3 + 1]!, scaled[i * 3 + 2]!));
      out[i * 4] = Math.round(r);
      out[i * 4 + 1] = Math.round(g);
      out[i * 4 + 2] = Math.round(b);
      out[i * 4 + 3] = Math.round(alpha * 255);
    }
  }
  const png = await sharp(out, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { png, width, height };
}
