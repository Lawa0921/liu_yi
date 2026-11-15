// 程式產生的貼圖（canvas）：鋼的拉絲與研磨帶、銅件的舊化與回紋浮雕、纏繩、木紋。不載任何外部圖檔。
// 亂數用固定種子，每次產生的結果都一樣（截圖比對與除錯才穩定）。

import { CanvasTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return [element, element.getContext('2d', { willReadFrequently: true })!];
}

function finish(element: HTMLCanvasElement, color: boolean, repeatU = 1, repeatV = 1): Texture {
  const texture = new CanvasTexture(element);
  texture.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeatU, repeatV);
  texture.anisotropy = 4;
  return texture;
}

const grey = (value: number) => {
  const v = Math.max(0, Math.min(255, Math.round(value)));
  return `rgb(${v},${v},${v})`;
};

/** 把一個 CSS 顏色讀成 0–255 的 RGB（省得自己解析）。 */
function rgbOf(css: string): [number, number, number] {
  const [, ctx] = canvas(1, 1);
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!];
}

/** 繞剖面一周（貼圖的 V，0–1）裡的一段。 */
export type Band = [from: number, to: number];

/**
 * 刃的粗糙度貼圖（three 取 G 色版）。U 沿刃、V 繞剖面一周。三層：
 *   1. 順刃方向的細拉絲（橫的長線），絲與絲之間粗糙度略有起伏；
 *   2. 極淡的鍛紋：沿刃緩緩起伏的流線；
 *   3. 研磨帶：刃口小斜面（edges 指定的 V 區段）是磨石留下的霧面，比刃面粗糙——
 *      所以刃面是深色的鏡面，刃口卻是一條細細的亮線。
 * base 是刃面的平均粗糙度（0–1），ground 是研磨帶的粗糙度。
 */
export function bladeRoughness(base: number, ground: number, edges: Band[], seed = 7): Texture {
  const width = 1024;
  const height = 256;
  const [element, ctx] = canvas(width, height);
  const random = seeded(seed);
  ctx.fillStyle = grey(base * 255);
  ctx.fillRect(0, 0, width, height);

  // 鍛紋：幾條很寬、很淡、沿刃起伏的流線。
  for (let i = 0; i < 14; i++) {
    const y = random() * height;
    const amplitude = 3 + random() * 9;
    const phase = random() * Math.PI * 2;
    const waves = 2 + Math.floor(random() * 3);
    ctx.strokeStyle = grey((base + (random() - 0.5) * 0.16) * 255);
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 2 + random() * 5;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 16) {
      const yy = y + Math.sin((x / width) * Math.PI * 2 * waves + phase) * amplitude;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  // 拉絲。
  for (let i = 0; i < 1800; i++) {
    const y = random() * height;
    const x = random() * width;
    const length = 120 + random() * 700;
    ctx.strokeStyle = grey((base + (random() - 0.5) * 0.5 * base * 2) * 255);
    ctx.globalAlpha = 0.2 + random() * 0.4;
    ctx.lineWidth = 0.5 + random();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y + (random() - 0.5) * 1.2);
    // 接到貼圖另一端，重複時才沒有接縫。
    ctx.moveTo(x - width, y);
    ctx.lineTo(x - width + length, y);
    ctx.stroke();
  }

  // 研磨帶：霧面，帶一點垂直於刃的磨痕。
  ctx.globalAlpha = 1;
  for (const [from, to] of edges) {
    const top = Math.floor(from * height);
    const size = Math.max(1, Math.ceil((to - from) * height));
    ctx.fillStyle = grey(ground * 255);
    ctx.fillRect(0, top, width, size);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = grey((ground + (random() - 0.5) * 0.2) * 255);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(random() * width, top, 1 + random() * 2, size);
    }
    ctx.globalAlpha = 1;
  }
  return finish(element, false);
}

/** 沒有分區的拉絲（槍庫這類車出來的零件）。 */
export function brushedRoughness(base: number, seed = 13): Texture {
  return bladeRoughness(base, base, [], seed);
}

/**
 * 手工研磨的刃面不是絕對的平面：沿著刃有極緩的起伏。這張切線空間的法線貼圖只在 U（沿刃）方向
 * 讓法線前後擺幾度——刃面上映出的燈條因此不是整面一個亮度，而是沿著刃分成好幾段光帶，兵器一轉就流動。
 * tilt 是法線最大的傾角（弧度）。
 */
export function rippleNormal(tilt: number, seed = 11): Texture {
  const width = 512;
  const [element, ctx] = canvas(width, 4);
  const random = seeded(seed);
  // 幾個整數倍頻的正弦疊起來（首尾相接），相位隨機。
  const waves = [2, 3, 5, 8].map((frequency, index) => ({
    frequency,
    phase: random() * Math.PI * 2,
    weight: [0.5, 0.3, 0.14, 0.06][index]!,
  }));
  const image = ctx.createImageData(width, 4);
  for (let x = 0; x < width; x++) {
    let slope = 0;
    for (const wave of waves) slope += Math.sin((x / width) * Math.PI * 2 * wave.frequency + wave.phase) * wave.weight;
    const angle = slope * tilt;
    const nx = Math.sin(angle);
    const nz = Math.cos(angle);
    for (let y = 0; y < 4; y++) {
      const offset = (y * width + x) * 4;
      image.data[offset] = Math.round((nx * 0.5 + 0.5) * 255);
      image.data[offset + 1] = 128;
      image.data[offset + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return finish(element, false);
}

export interface MetalMaps {
  /** 顏色（金屬的反射色）。 */
  map: Texture;
  roughness: Texture;
  /** 高度（給 bumpMap）；沒有浮雕的是 undefined。 */
  bump?: Texture;
}

/**
 * 舊化的銅：底色上有深淺不一的斑（氧化發暗的地方比較粗糙），不是一整塊亮黃。
 * brass 是亮處的顏色（CSS），dark 是氧化處壓暗的比例（0–1，越小越暗）。
 */
export function agedBrass(brass: string, dark = 0.42, seed = 23): MetalMaps {
  const size = 256;
  const [r, g, b] = rgbOf(brass);
  const [colorElement, colorCtx] = canvas(size, size);
  const [roughElement, roughCtx] = canvas(size, size);
  const random = seeded(seed);
  colorCtx.fillStyle = brass;
  colorCtx.fillRect(0, 0, size, size);
  roughCtx.fillStyle = grey(0.36 * 255);
  roughCtx.fillRect(0, 0, size, size);
  const tone = (k: number) => `rgb(${Math.round(r * k)},${Math.round(g * k * 0.96)},${Math.round(b * k * 0.86)})`;
  for (let i = 0; i < 520; i++) {
    const x = random() * size;
    const y = random() * size;
    const radius = 2 + random() * 16;
    const k = dark + random() * (1 - dark) * 0.7;
    const alpha = 0.1 + random() * 0.22;
    for (const [dx, dy] of [
      [0, 0],
      [-size, 0],
      [0, -size],
    ] as const) {
      colorCtx.globalAlpha = alpha;
      colorCtx.fillStyle = tone(k);
      colorCtx.beginPath();
      colorCtx.ellipse(x + dx, y + dy, radius, radius * (0.5 + random()), random() * Math.PI, 0, Math.PI * 2);
      colorCtx.fill();
      roughCtx.globalAlpha = alpha;
      roughCtx.fillStyle = grey((0.3 + (1 - k) * 0.75) * 255);
      roughCtx.beginPath();
      roughCtx.arc(x + dx, y + dy, radius, 0, Math.PI * 2);
      roughCtx.fill();
    }
  }
  colorCtx.globalAlpha = 1;
  roughCtx.globalAlpha = 1;
  return { map: finish(colorElement, true, 2, 2), roughness: finish(roughElement, false, 2, 2) };
}

/**
 * 回紋浮雕的銅件（劍格、盤護）：一格一個回紋。凸起的線被手磨亮（顏色亮、粗糙度低），
 * 凹下去的底積了氧化的暗色（顏色暗、粗糙）。一張貼圖是一格，重複幾次由幾何的 UV 決定。
 */
export function fretBrass(brass: string, seed = 29): Required<MetalMaps> {
  const size = 128;
  const [r, g, b] = rgbOf(brass);
  const [bumpElement, bumpCtx] = canvas(size, size);
  // 回紋：由外往內轉的方折線，線寬與間隔相等。
  const step = size / 8;
  bumpCtx.fillStyle = grey(0);
  bumpCtx.fillRect(0, 0, size, size);
  bumpCtx.strokeStyle = grey(255);
  bumpCtx.lineWidth = step * 0.9;
  bumpCtx.lineCap = 'square';
  bumpCtx.lineJoin = 'miter';
  bumpCtx.beginPath();
  const points: [number, number][] = [
    [0, 7],
    [1, 7],
    [1, 1],
    [7, 1],
    [7, 7],
    [3, 7],
    [3, 3],
    [5, 3],
    [5, 5],
  ];
  points.forEach(([x, y], index) => {
    if (index === 0) bumpCtx.moveTo(x * step, y * step);
    else bumpCtx.lineTo(x * step, y * step);
  });
  // 接到右邊那一格。
  bumpCtx.moveTo(7 * step, 7 * step);
  bumpCtx.lineTo(8 * step, 7 * step);
  bumpCtx.stroke();
  // 稍微糊一下：浮雕的邊是圓的，不是刀切的。
  bumpCtx.filter = 'blur(1.2px)';
  bumpCtx.drawImage(bumpElement, 0, 0);
  bumpCtx.filter = 'none';

  const heights = bumpCtx.getImageData(0, 0, size, size).data;
  const [colorElement, colorCtx] = canvas(size, size);
  const [roughElement, roughCtx] = canvas(size, size);
  const color = colorCtx.createImageData(size, size);
  const rough = roughCtx.createImageData(size, size);
  const random = seeded(seed);
  for (let i = 0; i < size * size; i++) {
    const h = heights[i * 4]! / 255;
    const grain = (random() - 0.5) * 0.08;
    // 凹處 0.42（積垢發暗）→ 凸處 1.0（磨亮）。
    const k = 0.42 + 0.58 * h + grain;
    color.data[i * 4] = r * k;
    color.data[i * 4 + 1] = g * k * (0.9 + 0.1 * h);
    color.data[i * 4 + 2] = b * k * (0.75 + 0.25 * h);
    color.data[i * 4 + 3] = 255;
    const roughness = (0.78 - 0.5 * h + grain) * 255;
    rough.data[i * 4] = rough.data[i * 4 + 1] = rough.data[i * 4 + 2] = roughness;
    rough.data[i * 4 + 3] = 255;
  }
  colorCtx.putImageData(color, 0, 0);
  roughCtx.putImageData(rough, 0, 0);
  return { map: finish(colorElement, true), roughness: finish(roughElement, false), bump: finish(bumpElement, false) };
}

/**
 * 纏繩：一張貼圖是一圈繩。繩是幾股搓成的，所以每一圈上有斜斜的股紋；圈與圈之間的縫是深色的陰影。
 * 回傳顏色與凹凸兩張貼圖。U 沿柄方向（turns 圈），V 繞柄一周。
 */
export function cordWrap(cord: string, turns: number, seed = 31): { map: Texture; bump: Texture } {
  const size = 128;
  const [colorElement, colorCtx] = canvas(size, size);
  const [bumpElement, bumpCtx] = canvas(size, size);
  const random = seeded(seed);
  const colorImage = colorCtx.createImageData(size, size);
  const bumpImage = bumpCtx.createImageData(size, size);
  const [r, g, b] = rgbOf(cord);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const across = x / size;
      // 繩的截面是圓的：中間高，兩側陷進縫裡。
      const round = Math.pow(Math.sin(across * Math.PI), 0.55);
      // 搓繩的股：沿繩（V）每周 14 股，斜著走。
      const strand = 0.5 + 0.5 * Math.sin((y / size) * Math.PI * 2 * 14 + across * Math.PI * 2 * 1.5);
      const height = round * (0.7 + 0.3 * strand);
      // 縫裡幾乎全黑，股與股之間也暗一點。
      const shade = 0.1 + 0.9 * Math.pow(round, 1.6) * (0.62 + 0.38 * strand) + (random() - 0.5) * 0.07;
      const offset = (y * size + x) * 4;
      colorImage.data[offset] = r * shade * 1.9;
      colorImage.data[offset + 1] = g * shade * 1.9;
      colorImage.data[offset + 2] = b * shade * 1.9;
      colorImage.data[offset + 3] = 255;
      bumpImage.data[offset] = bumpImage.data[offset + 1] = bumpImage.data[offset + 2] = height * 255;
      bumpImage.data[offset + 3] = 255;
    }
  }
  colorCtx.putImageData(colorImage, 0, 0);
  bumpCtx.putImageData(bumpImage, 0, 0);
  return { map: finish(colorElement, true, turns, 1), bump: finish(bumpElement, false, turns, 1) };
}

/** 木紋：沿長軸方向的細長紋理與年輪帶，加幾個節。light／dark 是 CSS 顏色。 */
export function woodGrain(light: string, dark: string, seed = 43, knots = 3): Texture {
  const width = 1024;
  const height = 128;
  const [element, ctx] = canvas(width, height);
  const random = seeded(seed);
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, width, height);
  // 年輪帶：幾條寬而淡的深色帶，繞著桿子。
  ctx.fillStyle = dark;
  for (let i = 0; i < 9; i++) {
    ctx.globalAlpha = 0.1 + random() * 0.16;
    ctx.fillRect(0, random() * height, width, 3 + random() * 12);
  }
  // 細紋。
  ctx.strokeStyle = dark;
  for (let i = 0; i < 420; i++) {
    const y = random() * height;
    const x = random() * width;
    const length = 150 + random() * 600;
    const drift = (random() - 0.5) * 5;
    ctx.globalAlpha = 0.2 + random() * 0.5;
    ctx.lineWidth = 0.5 + random() * 1.8;
    for (const shift of [0, -width]) {
      ctx.beginPath();
      ctx.moveTo(x + shift, y);
      ctx.bezierCurveTo(x + shift + length * 0.3, y + drift, x + shift + length * 0.7, y - drift, x + shift + length, y + drift * 0.5);
      ctx.stroke();
    }
  }
  // 節：一圈圈繞開的紋。
  for (let i = 0; i < knots; i++) {
    const x = 80 + random() * 860;
    const y = 20 + random() * 88;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(x, y, 4, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let ring = 0; ring < 5; ring++) {
      ctx.globalAlpha = 0.4 - ring * 0.06;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(x, y, 7 + ring * 6, 3 + ring * 2.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  return finish(element, true);
}
