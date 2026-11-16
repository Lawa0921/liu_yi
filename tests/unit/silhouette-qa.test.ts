import { describe, expect, it } from 'vitest';
import { checkSilhouette } from '../../scripts/qi/silhouette-qa';

/** 合成 RGBA：只用 alpha 通道，RGB 全 0。 */
interface Canvas {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const blank = (width: number, height: number): Canvas => ({ width, height, rgba: new Uint8Array(width * height * 4) });

const alphaAt = (c: Canvas, x: number, y: number) => c.rgba[(y * c.width + x) * 4 + 3]!;

function setAlpha(c: Canvas, x: number, y: number, alpha: number) {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
  c.rgba[(y * c.width + x) * 4 + 3] = alpha;
}

/** 實心矩形，[x0, x1) × [y0, y1)。 */
function rect(c: Canvas, x0: number, y0: number, x1: number, y1: number, alpha = 255) {
  for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) setAlpha(c, x, y, alpha);
}

/** 粗線段（兩端圓頭），距線段 ≤ r 的點都填滿。 */
function capsule(c: Canvas, ax: number, ay: number, bx: number, by: number, r: number, alpha = 255) {
  const x0 = Math.floor(Math.min(ax, bx) - r);
  const x1 = Math.ceil(Math.max(ax, bx) + r);
  const y0 = Math.floor(Math.min(ay, by) - r);
  const y1 = Math.ceil(Math.max(ay, by) + r);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const px = ax + t * dx - x;
      const py = ay + t * dy - y;
      if (px * px + py * py <= r * r) setAlpha(c, x, y, alpha);
    }
  }
}

interface FigureOptions {
  margin?: number;
  dx?: number;
  dy?: number;
}

/**
 * 人形：圓頭＋軀幹＋雙臂＋雙腿，全部相連。設計座標 880×1280 的方框，等比縮放進 `margin` 內縮的畫布並置中；
 * 預設（1000×1400、邊距 60）時外框剛好貼著邊距 60、遮罩約占整張 30%。`dx`／`dy` 平移整個人形。
 */
function figure(width: number, height: number, { margin = 60, dx = 0, dy = 0 }: FigureOptions = {}): Canvas {
  const c = blank(width, height);
  const bw = width - 2 * margin;
  const bh = height - 2 * margin;
  const s = Math.min(bw / 880, bh / 1280);
  const ox = margin + (bw - 880 * s) / 2 + dx;
  const oy = margin + (bh - 1280 * s) / 2 + dy;
  const X = (x: number) => ox + x * s;
  const Y = (y: number) => oy + y * s;
  capsule(c, X(440), Y(95), X(440), Y(95), 95 * s); // 頭
  capsule(c, X(440), Y(180), X(440), Y(280), 45 * s); // 頸
  rect(c, X(290), Y(250), X(590), Y(760)); // 軀幹
  capsule(c, X(300), Y(300), X(50), Y(600), 50 * s); // 左臂
  capsule(c, X(580), Y(300), X(830), Y(600), 50 * s); // 右臂
  capsule(c, X(350), Y(740), X(330), Y(1210), 70 * s); // 左腿
  capsule(c, X(530), Y(740), X(550), Y(1210), 70 * s); // 右腿
  return c;
}

/** 把「離任何遮罩像素歐氏距離 ≤ radius 的背景像素」設成 alpha（二值邊緣外的光暈）。 */
function halo(c: Canvas, radius: number, alpha: number) {
  const offsets: Array<[number, number]> = [];
  for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) if (ox * ox + oy * oy <= radius * radius) offsets.push([ox, oy]);
  const edge: Array<[number, number]> = [];
  for (let y = 1; y < c.height - 1; y++) {
    for (let x = 1; x < c.width - 1; x++) {
      if (alphaAt(c, x, y) <= 127) continue;
      if (alphaAt(c, x - 1, y) <= 127 || alphaAt(c, x + 1, y) <= 127 || alphaAt(c, x, y - 1) <= 127 || alphaAt(c, x, y + 1) <= 127) edge.push([x, y]);
    }
  }
  const targets: Array<[number, number]> = [];
  for (const [x, y] of edge) for (const [ox, oy] of offsets) if (alphaAt(c, x + ox, y + oy) <= 127) targets.push([x + ox, y + oy]);
  for (const [x, y] of targets) setAlpha(c, x, y, alpha);
}

const check = (c: Canvas) => checkSilhouette(c.rgba, c.width, c.height);

describe('checkSilhouette：合格的剪影', () => {
  it('1000×1400、邊距 60 的人形：ok 且沒有任何失敗項', () => {
    expect(check(figure(1000, 1400))).toEqual({ ok: true, failures: [] });
  });

  it('邊緣 2 px 內的半透明抗鋸齒不算光暈', () => {
    const c = figure(1000, 1400);
    halo(c, 2, 60);
    expect(check(c)).toEqual({ ok: true, failures: [] });
  });

  it('alpha 在 (8, 247) 開區間之外（alpha = 8）的遠處低值不算光暈', () => {
    const c = figure(1000, 1400);
    halo(c, 5, 8);
    expect(check(c)).toEqual({ ok: true, failures: [] });
  });

  it('離主體 ≤ 40 px 的小碎塊（< 3%）可以接受', () => {
    const c = figure(1000, 1400);
    rect(c, 615, 150, 627, 162); // 頭右緣外約 20 px
    expect(check(c)).toEqual({ ok: true, failures: [] });
  });

  it('只以對角相接的兩塊算同一個 8 連通元件（4 連通會被誤判成雜點）', () => {
    const c = blank(1000, 1400);
    rect(c, 60, 60, 500, 660); // A：264 000 px
    rect(c, 500, 660, 600, 760); // B：10 000 px（> 3%），只與 A 的右下角對角相接
    expect(check(c)).toEqual({ ok: true, failures: [] });
  });
});

describe('checkSilhouette：size（寬高皆 ≥ 500）', () => {
  it('400×400 → size', () => {
    expect(check(figure(400, 400, { margin: 24 }))).toEqual({ ok: false, failures: ['size'] });
  });

  it('邊界：500×700 通過；寬 499 或高 499 不通過', () => {
    expect(check(figure(500, 700, { margin: 30 })).ok).toBe(true);
    expect(check(figure(499, 700, { margin: 30 })).failures).toEqual(['size']);
    expect(check(figure(700, 499, { margin: 30 })).failures).toEqual(['size']);
  });
});

describe('checkSilhouette：edge（alpha > 127 的外框離四邊 ≥ 6 px）', () => {
  it('貼邊 3 px → edge', () => {
    // 預設外框離左邊 60，向左平移 57 → 剩 3
    expect(check(figure(1000, 1400, { dx: -57 }))).toEqual({ ok: false, failures: ['edge'] });
  });

  it.each([
    ['左', { dx: -57 }],
    ['右', { dx: 57 }],
    ['上', { dy: -57 }],
    ['下', { dy: 57 }],
  ] as const)('四邊都檢查：%s邊 3 px', (_side, shift) => {
    expect(check(figure(1000, 1400, shift)).failures).toEqual(['edge']);
  });

  it('邊界：離邊 5 px 不通過、6 px 通過', () => {
    expect(check(figure(1000, 1400, { dx: -55 })).failures).toEqual(['edge']);
    expect(check(figure(1000, 1400, { dx: -54 }))).toEqual({ ok: true, failures: [] });
  });
});

describe('checkSilhouette：stray（最大 8 連通元件 ≥ 遮罩面積 97%，且沒有遠處的小雜點）', () => {
  it('遠處 12 px 的雜點（< 3%、離主體 > 40 px）→ stray', () => {
    const c = figure(1000, 1400);
    rect(c, 70, 70, 82, 82); // 左上角空地，離最近的人形部位 > 80 px
    expect(check(c)).toEqual({ ok: false, failures: ['stray'] });
  });

  it('大於 3% 的獨立塊（最大元件 < 97%）→ stray', () => {
    const c = figure(1000, 1400);
    rect(c, 60, 60, 260, 260); // 40 000 px、離主體 > 80 px
    expect(check(c)).toEqual({ ok: false, failures: ['stray'] });
  });

  it('邊界：離主體 20 px 的獨立塊，3.65% → stray、2.2% 可接受', () => {
    const big = blank(1000, 1400);
    rect(big, 60, 60, 500, 660); // 264 000 px
    rect(big, 520, 60, 620, 160); // 10 000 px，占 3.65%，距離 20 px
    expect(check(big)).toEqual({ ok: false, failures: ['stray'] });

    const small = blank(1000, 1400);
    rect(small, 60, 60, 500, 660);
    rect(small, 520, 60, 580, 160); // 6 000 px，占 2.2%，距離 20 px
    expect(check(small)).toEqual({ ok: true, failures: [] });
  });

  it('邊界：小碎塊離主體 > 40 px → stray、恰好 40 px 可接受', () => {
    const far = blank(1000, 1400);
    rect(far, 60, 60, 500, 660); // 最右一欄是 x = 499
    rect(far, 540, 60, 560, 80); // 第一欄 x = 540：相距 41 px
    expect(check(far)).toEqual({ ok: false, failures: ['stray'] });

    const near = blank(1000, 1400);
    rect(near, 60, 60, 500, 660);
    rect(near, 539, 60, 559, 80); // 相距恰好 40 px
    expect(check(near)).toEqual({ ok: true, failures: [] });
  });

  it('邊界：最大元件恰好占 97%（另一塊近處的 3%）通過', () => {
    const c = blank(1000, 1400);
    rect(c, 60, 60, 460, 545); // 400 × 485 = 194 000
    rect(c, 480, 60, 540, 160); // 60 × 100 = 6 000，相距 21 px；合計 200 000
    expect(check(c)).toEqual({ ok: true, failures: [] });
  });
});

describe('checkSilhouette：haze（alpha 在 (8, 247) 且離二值邊緣 > 2 px 的像素數 = 0）', () => {
  it('主體外圍加一圈 alpha = 100、寬 5 px 的光暈 → haze', () => {
    const c = figure(1000, 1400);
    halo(c, 5, 100);
    expect(check(c)).toEqual({ ok: false, failures: ['haze'] });
  });

  it('光暈寬 3 px（超出 2 px 的容許帶）→ haze', () => {
    const c = figure(1000, 1400);
    halo(c, 3, 100);
    expect(check(c)).toEqual({ ok: false, failures: ['haze'] });
  });

  it('邊界：alpha = 9 的遠處低值 → haze', () => {
    const c = figure(1000, 1400);
    halo(c, 5, 9);
    expect(check(c)).toEqual({ ok: false, failures: ['haze'] });
  });

  it('邊界：主體內部 alpha = 247 不算半透明、alpha = 246 算', () => {
    const solid = figure(1000, 1400);
    rect(solid, 400, 400, 440, 440, 247);
    expect(check(solid)).toEqual({ ok: true, failures: [] });
    const soft = figure(1000, 1400);
    rect(soft, 400, 400, 440, 440, 246);
    expect(check(soft)).toEqual({ ok: false, failures: ['haze'] });
  });

  it('遮罩門檻：alpha = 127 的細條不算遮罩（只算光暈）、alpha = 128 算遮罩（貼邊且是遠處雜點）', () => {
    const faint = figure(1000, 1400);
    rect(faint, 3, 600, 4, 800, 127);
    expect(check(faint)).toEqual({ ok: false, failures: ['haze'] });
    const mask = figure(1000, 1400);
    rect(mask, 3, 600, 4, 800, 128);
    expect(check(mask)).toEqual({ ok: false, failures: ['edge', 'stray'] });
  });

  it('主體內部的半透明孔洞（遠離邊緣）→ haze', () => {
    const c = figure(1000, 1400);
    rect(c, 400, 400, 440, 440, 100); // 軀幹中央、離邊緣 > 2 px
    expect(check(c)).toEqual({ ok: false, failures: ['haze'] });
  });
});

describe('checkSilhouette：area（遮罩占整張 0.12–0.55）', () => {
  it('遮罩占 80% → area', () => {
    const c = blank(1000, 1400);
    rect(c, 60, 60, 940, 1333); // 880 × 1273 / 1 400 000 ≈ 0.80
    expect(check(c)).toEqual({ ok: false, failures: ['area'] });
  });

  it('邊界：0.1194 不通過、0.12006 通過', () => {
    const lo = blank(1000, 1400);
    rect(lo, 60, 60, 940, 250); // 880 × 190 = 167 200
    expect(check(lo).failures).toEqual(['area']);
    const ok = blank(1000, 1400);
    rect(ok, 60, 60, 940, 251); // 880 × 191 = 168 080
    expect(check(ok)).toEqual({ ok: true, failures: [] });
  });

  it('邊界：恰好 0.55 通過、超過一列不通過', () => {
    const ok = blank(1000, 1400);
    rect(ok, 60, 60, 940, 935); // 880 × 875 = 770 000
    expect(check(ok)).toEqual({ ok: true, failures: [] });
    const hi = blank(1000, 1400);
    rect(hi, 60, 60, 940, 936);
    expect(check(hi).failures).toEqual(['area']);
  });

  it('全透明（沒有主體）→ 不通過', () => {
    const result = check(blank(1000, 1400));
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('area');
  });
});

describe('checkSilhouette：影像邊界', () => {
  it('影像外視為背景：貼著影像右緣的半透明遮罩像素在容許帶內，不算光暈', () => {
    const c = blank(1000, 1400);
    rect(c, 60, 60, 500, 660);
    rect(c, 900, 700, 1000, 800); // 貼右邊的 10 000 px 塊
    rect(c, 999, 700, 1000, 800, 200); // 最右一欄是半透明的遮罩像素
    expect(check(c)).toEqual({ ok: false, failures: ['edge', 'stray'] });
  });
});

describe('checkSilhouette：各項互不影響', () => {
  it('貼邊 + 光暈 → 恰好 edge 與 haze（依 size、edge、stray、haze、area 的固定順序）', () => {
    const c = figure(1000, 1400, { dx: -57 });
    halo(c, 5, 100);
    expect(check(c)).toEqual({ ok: false, failures: ['edge', 'haze'] });
  });

  it('尺寸過小 + 遠處雜點 → 恰好 size 與 stray', () => {
    const c = figure(400, 400, { margin: 24 });
    rect(c, 30, 30, 36, 36); // 左上空地，離人形 > 40 px
    expect(check(c)).toEqual({ ok: false, failures: ['size', 'stray'] });
  });

  it('光暈不改變 edge／area 的判定（只看 alpha > 127 的遮罩）', () => {
    const plain = figure(1000, 1400, { dx: -57 });
    const hazy = figure(1000, 1400, { dx: -57 });
    halo(hazy, 5, 100);
    expect(check(plain).failures).toEqual(['edge']);
    expect(check(hazy).failures).toEqual(expect.arrayContaining(['edge']));
    expect(check(hazy).failures).not.toContain('area');
  });
});

describe('checkSilhouette：輸入檢查', () => {
  it('rgba 長度與寬高不符 → 丟錯', () => {
    expect(() => checkSilhouette(new Uint8Array(10), 1000, 1400)).toThrow(/長度/);
  });
});
