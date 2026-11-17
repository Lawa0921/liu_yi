import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { BEATS, type BeatId } from '../../src/qi/config/poses';
import type { QiDebug } from '../../src/qi/engine/qi-stage';

// 首頁的截圖驗收（Task 23；設計 §11）：headless 截圖存到 test-results/visual/，再用 sharp 對像素做數值檢查。
// 每個姿勢量兩件事：
//   - 「亮點外框」：把 DOM 全部藏起來、只留 canvas 的截圖（`captureCanvas`）裡「亮度 > 100 或朱紅」的像素的外框，換算成視窗座標；
//   - 「DOM 文字矩形」：該段文字節點的矩形（Range.getClientRects）。
// 合格標準是計畫 Task 23 Step 2 的表（見各測試）；那些門檻是起始值，調整要有 commit 說明並經 fresh-context 驗收簽核，這裡不得放寬。
// headless 的 WebGL 是軟體繪製：引擎的截圖用 ?qi-tier=…&qi-debug=1（tier 見下），時間用停住的假時鐘；只用 page.* 驅動，不碰 OS 層級的滑鼠鍵盤。
// 注意：Playwright 每次執行都會清掉 test-results/，所以這個資料夾只留最後一次執行的截圖。

// 預設 min tier（與其他引擎 e2e 一致：軟體繪製下快而穩，而且沒有光暈與地面倒影——外框量到的就是光點本身）。
// 兩個例外：槍桿的亮寬量該裝置的真實起始 tier（桌機 high、手機 low；min tier 的光點稀疏又暗，量到的不是使用者看到的槍桿）；
// QI_VISUAL_TIER=real 時全部改用真實 tier，截圖檔名加 `real-` 前綴，只供人工比對（高階 tier 有光暈與地面倒影，亮點外框會連倒影一起算）。
const REAL_TIER = process.env.QI_VISUAL_TIER === 'real';
const TIER_OF = { desktop: 'high', mobile: 'low' } as const;
const homeUrl = (device: Device, real = false) => `./?qi-tier=${real || REAL_TIER ? TIER_OF[device.slug] : 'min'}&qi-debug=1`;
const shotName = (name: string) => (REAL_TIER ? `real-${name}` : name);

test.describe.configure({ mode: 'default', timeout: REAL_TIER ? 300_000 : 120_000 });

const T0 = new Date('2026-01-01T08:00:00');
const T1 = new Date('2026-01-01T09:00:00');
const READY = { timeout: 30_000 };
const OUT_DIR = fileURLToPath(new URL('../../test-results/visual/', import.meta.url));

interface Device {
  name: string;
  slug: 'desktop' | 'mobile';
  viewport: { width: number; height: number };
  /** 截圖檔名用的標記（預設用 slug）：同一個 slug 有兩種尺寸時區分檔名。 */
  tag?: string;
}
const DEVICES: Device[] = [
  { name: '桌機 1440×900', slug: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: '手機 390×844', slug: 'mobile', viewport: { width: 390, height: 844 } },
];
/** 控制者裁定（Task 23 修正 R1）：手機直向的 others 另外在這個較矮的尺寸也要完整在畫布內、不壓文字。 */
const SMALL_PHONE: Device = { name: '手機 360×740', slug: 'mobile', viewport: { width: 360, height: 740 }, tag: 'mobile-360' };

type W = { __qi: { ready: boolean; mode: string; debug: QiDebug } };
interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 軟體 GL（SwiftShader）在讀回像素時印的效能提示；已知的雜訊，其餘 warning 一律不允許。 */
const KNOWN_WARNING = /GPU stall due to ReadPixels/;
const seen = new WeakMap<Page, { errors: string[]; warnings: string[] }>();

function watch(page: Page): void {
  const log = { errors: [] as string[], warnings: [] as string[] };
  seen.set(page, log);
  page.on('pageerror', (error) => log.errors.push(`pageerror: ${error}`));
  page.on('console', (message) => {
    if (message.type() === 'error') log.errors.push(`console.error: ${message.text()}`);
    if (message.type() === 'warning') log.warnings.push(`console.warning: ${message.text()}`);
  });
}

test.afterEach(async ({ page }) => {
  const log = seen.get(page);
  if (!log) return;
  expect(log.errors, '頁面全程不得有 pageerror 或 console.error').toEqual([]);
  expect(log.warnings.filter((w) => !KNOWN_WARNING.test(w)), '頁面全程不得有 console.warning').toEqual([]);
});

const html = (page: Page) => page.locator('html');
const run = (page: Page, ms: number) => page.clock.runFor(ms);

/** 開首頁、等引擎 ready、再把時鐘停住（之後只有 `run` 會推進）。預設先標記看過開場（跳過）；'fresh' 讓開場照演。 */
async function open(page: Page, device: Device, intro: 'seen' | 'fresh' = 'seen', realTier = false): Promise<void> {
  watch(page);
  if (intro === 'seen') await page.addInitScript(() => sessionStorage.setItem('liuyi:qi-intro', '1'));
  await page.clock.install({ time: T0 });
  await page.goto(homeUrl(device, realTier));
  await expect(html(page)).toHaveAttribute('data-qi-ready', 'true', READY);
  await page.clock.pauseAt(T1);
}

const scrollToBeat = (page: Page, beat: BeatId) =>
  page.evaluate((id) => {
    const rect = document.querySelector(`[data-beat="${id}"]`)!.getBoundingClientRect();
    window.scrollTo(0, Math.round(rect.top + window.scrollY + rect.height / 2 - window.innerHeight / 2));
  }, beat);

/**
 * 捲到該段、等姿勢的形體載完並套上、再讓光點聚合（作法同 screen-polish.spec 的 settlePose）：形體是真的 fetch（不受假時鐘控制），
 * 所以先讓時鐘走一小段、等 `data-qi-pose` 換成目標，再推進 3.5 秒；之後確認光點真的聚合了（量到的才是姿勢本身，不是飛行中的光點）。
 */
async function settlePose(page: Page, beat: BeatId, pose: string): Promise<void> {
  await scrollToBeat(page, beat);
  await run(page, 200);
  await expect(html(page)).toHaveAttribute('data-qi-pose', pose, READY);
  await run(page, 3500);
  expect(await page.evaluate(() => (window as unknown as W).__qi.debug.meanError()), `${pose} 已聚合`).toBeLessThan(0.05);
}

// ── 截圖與像素分析 ────────────────────────────────────────────────

function save(name: string, png: Buffer): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}${name}.png`, png);
}

interface CanvasShot {
  png: Buffer;
  /** canvas 在視窗中的位置與大小（CSS 像素）。 */
  rect: { left: number; top: number; width: number; height: number };
}

/** 只含 canvas 的截圖：DOM 其餘部分整個 `visibility:hidden`（版面不變），裁成 canvas 的範圍。 */
async function captureCanvas(page: Page): Promise<CanvasShot> {
  const rect = await page.evaluate(() => {
    const r = document.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]')!.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = 'visual-canvas-only';
    style.textContent = 'html { visibility: hidden !important; } canvas[data-qi-canvas] { visibility: visible !important; }';
    document.head.append(style);
  });
  try {
    const png = await page.screenshot({ clip: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } });
    return { png, rect };
  } finally {
    await page.evaluate(() => document.getElementById('visual-canvas-only')?.remove());
  }
}

interface Analysis {
  width: number;
  height: number;
  /** 亮度 > 100 的像素占全圖的比例。 */
  bright: number;
  /** 最大通道 > 30 的像素（畫面上有東西）占全圖的比例。 */
  covered: number;
  /** R>150、G<90、B<90 的像素數。 */
  red: number;
  /**
   * 主體（光點聚成的形體）的外框，canvas 本地座標（像素）；沒有任何亮點是 null。
   * 亮點＝亮度 > 100 或朱紅；環境煙會散落一些孤立的亮點，所以先把亮點膨脹 `JOIN_PX` 讓同一個形體連成一片，
   * 只留「亮點數 ≥ 最大一片的 5%」的那些片（四個小人形各占一片，孤立的煙點不算），外框取這些片的聯集。
   */
  lit: Box | null;
  /** 朱紅像素（全圖）的外框；沒有是 null。 */
  redBox: Box | null;
  /**
   * 主體在 x 方向 [from, to]（占外框寬的比例）這一帶的縱向亮寬：每一欄先把相距 ≤ `CLOSE_PX` 的亮點連起來
   * （光點是一顆一顆的，不連起來量到的是點與點之間的縫），取「最長連續亮段」，再取各欄的中位數。
   */
  runMedian(from: number, to: number): number;
}

/** 形體內相鄰亮點的連接距離（px）：兩點相距不超過它就算同一個形體。 */
const JOIN_PX = 8;
/** 量縱向亮寬時，欄內相距不超過這麼多 px 的亮點視為連續。 */
const CLOSE_PX = 2;
/** 一片的亮點數至少是最大一片的這個比例，才算形體（其餘當環境煙）。 */
const MAIN_SHARE = 0.05;

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const isRed = (r: number, g: number, b: number) => r > 150 && g < 90 && b < 90;

/** 把遮罩的 true 往四周膨脹 r px（方形，分成橫、縱兩次掃描）。 */
function dilate(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    let last = -Infinity; // 最近一個亮點的 x
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) last = x;
      if (x - last <= r) horizontal[y * width + x] = 1;
    }
    last = Infinity;
    for (let x = width - 1; x >= 0; x--) {
      if (mask[y * width + x]) last = x;
      if (last - x <= r) horizontal[y * width + x] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    let last = -Infinity;
    for (let y = 0; y < height; y++) {
      if (horizontal[y * width + x]) last = y;
      if (y - last <= r) out[y * width + x] = 1;
    }
    last = Infinity;
    for (let y = height - 1; y >= 0; y--) {
      if (horizontal[y * width + x]) last = y;
      if (last - y <= r) out[y * width + x] = 1;
    }
  }
  return out;
}

/** `litThreshold`：算「亮點」（形體外框的依據）的亮度門檻，預設 100；很淡的形體（竹簡）改用較低的值，否則量到的是零星的亮環境煙。`bright` 欄位永遠是亮度 > 100 的占比。 */
async function analyze(png: Buffer, litThreshold = 100): Promise<Analysis> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const lit = new Uint8Array(width * height);
  let bright = 0;
  let covered = 0;
  let red = 0;
  const redBox: Box = { left: width, right: -1, top: height, bottom: -1 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      const r = data[o]!;
      const g = data[o + 1]!;
      const b = data[o + 2]!;
      const isBright = luma(r, g, b) > 100;
      const redPixel = isRed(r, g, b);
      if (isBright) bright++;
      if (Math.max(r, g, b) > 30) covered++;
      if (redPixel) {
        red++;
        redBox.left = Math.min(redBox.left, x);
        redBox.right = Math.max(redBox.right, x + 1);
        redBox.top = Math.min(redBox.top, y);
        redBox.bottom = Math.max(redBox.bottom, y + 1);
      }
      if (luma(r, g, b) > litThreshold || redPixel) lit[y * width + x] = 1;
    }
  }

  // 連通片（膨脹後 4 連通）：每片記亮點數與外框
  const joined = dilate(lit, width, height, JOIN_PX);
  const label = new Int32Array(width * height).fill(-1);
  const parts: { count: number; box: Box }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < joined.length; start++) {
    if (!joined[start] || label[start] !== -1) continue;
    const part = { count: 0, box: { left: width, right: -1, top: height, bottom: -1 } };
    const id = parts.length;
    label[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const at = stack.pop()!;
      const x = at % width;
      const y = (at - x) / width;
      if (lit[at]) {
        part.count++;
        part.box.left = Math.min(part.box.left, x);
        part.box.right = Math.max(part.box.right, x + 1);
        part.box.top = Math.min(part.box.top, y);
        part.box.bottom = Math.max(part.box.bottom, y + 1);
      }
      for (const next of [x > 0 ? at - 1 : -1, x < width - 1 ? at + 1 : -1, y > 0 ? at - width : -1, y < height - 1 ? at + width : -1]) {
        if (next >= 0 && joined[next] && label[next] === -1) {
          label[next] = id;
          stack.push(next);
        }
      }
    }
    parts.push(part);
  }
  const largest = Math.max(0, ...parts.map((part) => part.count));
  const kept = parts.map((part, id) => ({ ...part, id })).filter((part) => part.count > 0 && part.count >= largest * MAIN_SHARE);
  const box: Box | null =
    kept.length === 0
      ? null
      : {
          left: Math.min(...kept.map((part) => part.box.left)),
          right: Math.max(...kept.map((part) => part.box.right)),
          top: Math.min(...kept.map((part) => part.box.top)),
          bottom: Math.max(...kept.map((part) => part.box.bottom)),
        };
  const keptIds = new Set(kept.map((part) => part.id));

  return {
    width,
    height,
    bright: bright / (width * height),
    covered: covered / (width * height),
    red,
    lit: box,
    redBox: redBox.right >= 0 ? redBox : null,
    runMedian(from, to) {
      if (!box) return 0;
      const w = box.right - box.left;
      const x0 = Math.floor(box.left + w * from);
      const x1 = Math.max(x0 + 1, Math.ceil(box.left + w * to));
      const runs: number[] = [];
      for (let x = x0; x < x1; x++) {
        let best = 0;
        let start = -1; // 目前這一段亮段的起點
        let lastLit = -Infinity;
        for (let y = box.top; y < box.bottom; y++) {
          const index = y * width + x;
          if (lit[index] && keptIds.has(label[index]!)) {
            if (start < 0 || y - lastLit > CLOSE_PX + 1) start = y;
            lastLit = y;
            best = Math.max(best, y - start + 1);
          }
        }
        runs.push(best);
      }
      runs.sort((a, b) => a - b);
      return runs[Math.floor(runs.length / 2)] ?? 0;
    },
  };
}

/** 截圖的亮度統計：亮度 > 100 的像素占比。 */
async function brightFraction(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let bright = 0;
  for (let i = 0; i < info.width * info.height; i++) if (luma(data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!) > 100) bright++;
  return bright / (info.width * info.height);
}

/** 該範圍內可見文字節點的矩形（視窗座標）：藏起來的（display:none、visibility:hidden、aria-hidden）不算。 */
const textRects = (page: Page, scope: string): Promise<Box[]> =>
  page.evaluate((selector) => {
    const out: { left: number; right: number; top: number; bottom: number }[] = [];
    for (const root of document.querySelectorAll(selector)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const parent = node.parentElement!;
        if (parent.closest('[aria-hidden="true"], [hidden]')) continue;
        if (getComputedStyle(parent).visibility === 'hidden') continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width > 0 && r.height > 0) out.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        }
      }
    }
    return out;
  }, scope);

/** 兩個矩形的重疊面積（不重疊是 0）。 */
function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

const area = (b: Box) => (b.right - b.left) * (b.bottom - b.top);

interface Measured {
  analysis: Analysis;
  rect: CanvasShot['rect'];
  /** 亮點外框，視窗座標。 */
  figure: Box;
}

/** 截圖（完整視窗存證、canvas 單獨存證並分析），回傳亮點外框（視窗座標）。 */
async function shoot(page: Page, name: string, litThreshold = 100): Promise<Measured> {
  save(shotName(name), await page.screenshot());
  const { png, rect } = await captureCanvas(page);
  save(`${shotName(name)}-canvas`, png);
  const analysis = await analyze(png, litThreshold);
  expect(analysis.lit, `${name}：canvas 上有亮點（不是空畫面）`).not.toBeNull();
  const lit = analysis.lit!;
  const figure = { left: rect.left + lit.left, right: rect.left + lit.right, top: rect.top + lit.top, bottom: rect.top + lit.bottom };
  return { analysis, rect, figure };
}

const f = (n: number) => n.toFixed(1);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

interface Metrics {
  heightRatio: number;
  cx: number;
  cy: number;
  bottom: number;
  margins: { left: number; top: number; right: number; bottom: number };
  overlapRatio: number;
  note: string;
}

/** 人形的各項量測值（也寫進測試註記，報告引用）。 */
function metricsOf(m: Measured, device: Device, texts: Box[], label: string): Metrics {
  const { analysis, rect, figure } = m;
  const lit = analysis.lit!;
  const { width: W, height: H } = device.viewport;
  const heightRatio = (lit.bottom - lit.top) / rect.height;
  const cx = (figure.left + figure.right) / 2;
  const cy = (figure.top + figure.bottom) / 2;
  const margins = { left: lit.left, top: lit.top, right: analysis.width - lit.right, bottom: analysis.height - lit.bottom };
  const textArea = texts.reduce((sum, t) => sum + area(t), 0);
  const overlap = texts.reduce((sum, t) => sum + overlapArea(figure, t), 0);
  const overlapRatio = textArea > 0 ? overlap / textArea : 0;
  test.info().annotations.push({
    type: label,
    description:
      `外框 x ${f(figure.left)}–${f(figure.right)}、y ${f(figure.top)}–${f(figure.bottom)}；高占 canvas ${pct(heightRatio)}；` +
      `中心 (${pct(cx / W)}W, ${pct(cy / H)}H)；底 ${pct(figure.bottom / H)}H；四邊留 ${margins.left}/${margins.top}/${margins.right}/${margins.bottom} px；與文字重疊 ${pct(overlapRatio)}（${texts.length} 個文字矩形）`,
  });
  return { heightRatio, cx, cy, bottom: figure.bottom, margins, overlapRatio, note: `${label} 外框 ${JSON.stringify(figure)}、canvas ${JSON.stringify(rect)}` };
}

/**
 * 人形亮點外框高占 canvas 高的下限，依架勢與裝置分（依控制者裁定，取代計畫表的單一 45%–90%）：
 *   - 桌機：站姿（land、salute）45%–90%；蹲低架勢（dingzhou、kao、kid-*）與 others（四個小人形）25%–90%。
 *   - 手機直向：站姿 35%–90%、蹲低架勢與 others 20%–90%。直向要讓位給下方的文字，取景（`engine/framing.ts`：可視寬固定 2.75 世界單位）
 *     是使用者看過的，所以不把取景拉近，改放寬門檻（實測：land 37.6%、salute 37.4%、kao 22.3%）。
 */
const HEIGHT_MIN = {
  desktop: { stand: 0.45, crouch: 0.25 },
  mobile: { stand: 0.35, crouch: 0.2 },
} as const;
type Stance = keyof (typeof HEIGHT_MIN)['desktop'];

function expectHeight(metrics: Metrics, stance: Stance, device: Device): void {
  const min = HEIGHT_MIN[device.slug][stance];
  expect(metrics.heightRatio, `高占 canvas 高 ${min * 100}%–90%（${device.slug === 'mobile' ? '手機直向' : '桌機'}${stance === 'stand' ? '站姿' : '蹲低架勢／others'}）：${metrics.note}`).toBeGreaterThanOrEqual(min);
  expect(metrics.heightRatio, `高占 canvas 高 ${min * 100}%–90%：${metrics.note}`).toBeLessThanOrEqual(0.9);
}

/** 計畫表：完整在 canvas 內（四邊留 ≥ 8 px）、桌機中心 x ∈ [0.50W, 0.80W]、手機底 < 0.70H 且中心 y 在上 60%、亮點外框與 DOM 文字矩形的重疊 ≤ 文字面積的 5%。 */
function expectPlacement(metrics: Metrics, device: Device): void {
  const { width: W, height: H } = device.viewport;
  const { cx, cy, bottom, margins, overlapRatio, note } = metrics;
  for (const [side, margin] of Object.entries(margins)) expect(margin, `${side} 邊離 canvas 邊緣 ≥ 8 px：${note}`).toBeGreaterThanOrEqual(8);
  if (device.slug === 'desktop') {
    expect(cx, `桌機外框中心 x ∈ [0.50W, 0.80W]：${note}`).toBeGreaterThanOrEqual(0.5 * W);
    expect(cx, `桌機外框中心 x ∈ [0.50W, 0.80W]：${note}`).toBeLessThanOrEqual(0.8 * W);
  } else {
    expect(bottom, `手機外框底 < 0.70H：${note}`).toBeLessThan(0.7 * H);
    expect(cy, `手機外框中心 y 在上 60%：${note}`).toBeLessThan(0.6 * H);
  }
  expect(overlapRatio, `亮點外框與 DOM 文字矩形重疊 ≤ 文字面積的 5%：${note}`).toBeLessThanOrEqual(0.05);
}

const beatText = (beat: BeatId) => (beat === 'opening' ? '.opening__lockup' : `[data-beat="${beat}"] .beat__text`);

// ── 1. 首屏（three 抵達前，海報）──────────────────────────────────

/** 把引擎 chunk（檔名含 qi-stage）扣住，直到呼叫回傳的函式（保險：30 秒後自動放行）。 */
async function holdEngine(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
    setTimeout(resolve, 30_000);
  });
  await page.route(/qi-stage[^/]*\.js(\?.*)?$/, async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

/** 等所有「會結束」的動畫跑完（進場動畫 0.9 秒）：截圖才不會抓到半透明的標題。 */
const settleAnimations = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );

for (const device of DEVICES) {
  test.describe(`首屏海報：${device.name}`, () => {
    test.use({ viewport: device.viewport });

    test('three 抵達前：亮度 > 100 的像素占 1.5%–15%、h1 可見、無水平溢出', async ({ page }) => {
      watch(page);
      const release = await holdEngine(page);
      await page.goto(homeUrl(device));
      const poster = page.locator('.opening__poster img');
      await expect(poster).toBeVisible();
      await expect.poll(() => poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
      await expect(page.locator('h1')).toBeVisible();
      await expect(html(page), 'three 還沒到').not.toHaveAttribute('data-qi-ready', /.*/);
      await settleAnimations(page);

      const png = await page.screenshot();
      save(`poster-${device.slug}`, png);
      const bright = await brightFraction(png);
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - window.innerWidth,
        body: document.body.scrollWidth - window.innerWidth,
      }));
      test.info().annotations.push({ type: 'poster', description: `亮度 > 100 的像素占 ${pct(bright)}；水平溢出 doc ${overflow.doc}px、body ${overflow.body}px` });
      expect(bright, '首屏亮點占比').toBeGreaterThanOrEqual(0.015);
      expect(bright, '首屏亮點占比').toBeLessThanOrEqual(0.15);
      expect(overflow.doc, 'documentElement 無水平溢出').toBeLessThanOrEqual(0);
      expect(overflow.body, 'body 無水平溢出').toBeLessThanOrEqual(0);
      release();
    });
  });
}

// ── 2–6. 引擎的姿勢 ─────────────────────────────────────────────

interface HumanCase {
  pose: string;
  beat: BeatId;
  label: string;
  /** 站姿、蹲低架勢（與 others）的高占比下限不同，見 `HEIGHT_MIN`（控制者裁定）。 */
  stance: Stance;
  /** 開場演完才量（新工作階段，等開場落地）。 */
  intro?: boolean;
  /** 先在 fist 段按「小孩」。 */
  kid?: boolean;
}

const HUMAN_CASES: HumanCase[] = [
  { pose: 'land', beat: 'opening', label: '開場落地後（land）', stance: 'stand', intro: true },
  { pose: 'dingzhou', beat: 'fist', label: 'dingzhou', stance: 'crouch' },
  { pose: 'kao', beat: 'combat-b', label: 'kao', stance: 'crouch' },
  { pose: 'kid-wushu', beat: 'fist', label: 'kid-wushu（切小孩）', stance: 'crouch', kid: true },
  { pose: 'salute', beat: 'coaches', label: 'salute', stance: 'stand' },
  { pose: 'others', beat: 'others', label: 'others', stance: 'crouch' },
];

/** 開頁、擺到指定姿勢、截圖，回傳這個姿勢的量測值。 */
async function measureHuman(page: Page, device: Device, c: HumanCase): Promise<Metrics> {
  await open(page, device, c.intro ? 'fresh' : 'seen');
  if (c.intro) {
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'playing');
    await run(page, 4500);
    await expect(html(page)).toHaveAttribute('data-qi-intro', 'done');
    await run(page, 1500);
    expect(await page.evaluate(() => (window as unknown as W).__qi.debug.meanError()), `${c.pose} 已聚合`).toBeLessThan(0.05);
  } else if (c.kid) {
    await settlePose(page, c.beat, 'dingzhou');
    await page.getByRole('button', { name: '小孩' }).click();
    await expect(html(page)).toHaveAttribute('data-audience', 'kid');
    await run(page, 200);
    await expect(html(page)).toHaveAttribute('data-qi-pose', c.pose, READY);
    await run(page, 3500);
    expect(await page.evaluate(() => (window as unknown as W).__qi.debug.meanError()), `${c.pose} 已聚合`).toBeLessThan(0.05);
  } else {
    await settlePose(page, c.beat, c.pose);
  }
  const measured = await shoot(page, `${c.pose}-${device.tag ?? device.slug}`);
  return metricsOf(measured, device, await textRects(page, beatText(c.beat)), c.pose);
}

for (const device of DEVICES) {
  test.describe(`引擎截圖：${device.name}`, () => {
    test.use({ viewport: device.viewport });

    for (const c of HUMAN_CASES) {
      test(`${c.label}：人形標準`, async ({ page }) => {
        const metrics = await measureHuman(page, device, c);
        expectPlacement(metrics, device);
        expectHeight(metrics, c.stance, device);
      });
    }

    test('spear：紅色像素 ≥ 150、槍桿中段縱向亮寬 ≥ 5 px、槍頭與纓都在 canvas 內（真實 tier）', async ({ page }) => {
      test.setTimeout(240_000);
      await open(page, device, 'seen', true);
      await settlePose(page, 'weapon-c', 'spear');
      const { analysis, rect, figure } = await shoot(page, `spear-${device.slug}`);
      const lit = analysis.lit!;
      const shaft = analysis.runMedian(0.4, 0.6);
      const margins = { left: lit.left, top: lit.top, right: analysis.width - lit.right, bottom: analysis.height - lit.bottom };
      const inkRight = await page.evaluate((id) => {
        let right = -Infinity;
        for (const column of document.querySelectorAll(`[data-beat="${id}"] .beat__text`)) {
          const walker = document.createTreeWalker(column, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent?.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const r of range.getClientRects()) if (r.width > 0) right = Math.max(right, r.right);
          }
        }
        return right;
      }, 'weapon-c');
      const texts = await textRects(page, beatText('weapon-c'));
      const textArea = texts.reduce((sum, t) => sum + area(t), 0);
      const overlapRatio = textArea > 0 ? texts.reduce((sum, t) => sum + overlapArea(figure, t), 0) / textArea : 0;
      test.info().annotations.push({
        type: 'spear',
        description:
          `tier ${TIER_OF[device.slug]}；外框 x ${f(figure.left)}–${f(figure.right)}（寬 ${f(figure.right - figure.left)}）、y ${f(figure.top)}–${f(figure.bottom)}；紅 ${analysis.red} 像素；` +
          `槍桿中段亮寬 ${shaft} px；四邊留 ${margins.left}/${margins.top}/${margins.right}/${margins.bottom} px；文字右緣 ${f(inkRight)}；與文字重疊 ${pct(overlapRatio)}`,
      });
      const note = `外框 ${JSON.stringify(figure)}、canvas ${JSON.stringify(rect)}`;
      expect(analysis.red, `紅色像素（R>150、G<90、B<90）≥ 150：${note}`).toBeGreaterThanOrEqual(150);
      expect(shaft, `槍桿中段縱向亮寬 ≥ 5 px：${note}`).toBeGreaterThanOrEqual(5);
      for (const [side, margin] of Object.entries(margins)) expect(margin, `槍頭與纓都在 canvas 內（${side} 邊離邊緣 ≥ 8 px）：${note}`).toBeGreaterThanOrEqual(8);
      expect(analysis.redBox, '纓（紅）在畫面上').not.toBeNull();
      // 與 Task 22b 一致：橫向版面的兵器以「該段實際文字的右緣」為左界；直向版面文字在下，只要求不壓到文字
      if (device.slug === 'desktop') expect(figure.left, `兵器左端在該段實際文字右緣 ${f(inkRight)} 之右：${note}`).toBeGreaterThanOrEqual(inkRight);
      expect(overlapRatio, `亮點外框與 DOM 文字矩形重疊 ≤ 文字面積的 5%：${note}`).toBeLessThanOrEqual(0.05);
    });

    test('scroll（收費課表的竹簡）：亮點外框與文字矩形重疊 ≤ 5%、文字區域亮度 > 100 的像素 ≤ 4%、外框是橫的長方形、完整在畫布內', async ({ page }) => {
      await open(page, device);
      await settlePose(page, 'pricing', 'scroll');
      // 竹簡淡（亮度 > 100 的像素很少），外框改以亮度 > 35 的光點量
      const measured = await shoot(page, `scroll-${device.slug}`, 35);
      const { analysis, rect, figure } = measured;
      const texts = await textRects(page, beatText('pricing'));
      const metrics = metricsOf(measured, device, texts, 'scroll');
      // 位置：完整在畫布內（四邊留 ≥ 8 px）、桌機中心 x ∈ [0.50W, 0.80W]、手機底 < 0.70H 且中心在上 60%、與文字重疊 ≤ 5%
      expectPlacement(metrics, device);
      // 外框比例：竹簡是橫的長方形（寬 ÷ 高 1.2–1.9，兩端略捲所以略窄於攤平時的 1.6）
      const aspect = (figure.right - figure.left) / (figure.bottom - figure.top);
      // 文字區域：該段文字矩形（裁在 canvas 內）底下，canvas 上亮度 > 100 的像素比例（竹簡淡到不影響收費導引文字的對比）
      const canvasBox: Box = { left: rect.left, right: rect.left + rect.width, top: rect.top, bottom: rect.top + rect.height };
      const inCanvas = texts.filter((t) => overlapArea(t, canvasBox) > 0);
      let inText = 0;
      let inTextBright = 0;
      const { data, info } = await sharp((await captureCanvas(page)).png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      for (const t of inCanvas) {
        const x0 = Math.max(0, Math.floor(t.left - rect.left));
        const x1 = Math.min(info.width, Math.ceil(t.right - rect.left));
        const y0 = Math.max(0, Math.floor(t.top - rect.top));
        const y1 = Math.min(info.height, Math.ceil(t.bottom - rect.top));
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            inText++;
            const o = (y * info.width + x) * 3;
            if (luma(data[o]!, data[o + 1]!, data[o + 2]!) > 100) inTextBright++;
          }
        }
      }
      const underText = inText > 0 ? inTextBright / inText : 0;
      test.info().annotations.push({
        type: 'scroll',
        description: `外框寬高比 ${aspect.toFixed(2)}；canvas 亮度 > 100 的像素占 ${pct(analysis.bright)}（有內容的像素占 ${pct(analysis.covered)}）；文字矩形（${inCanvas.length} 個、${inText} px）底下占 ${pct(underText)}；紅 ${analysis.red} 像素`,
      });
      expect(aspect, `竹簡外框寬高比 1.2–1.9：${metrics.note}`).toBeGreaterThan(1.2);
      expect(aspect, `竹簡外框寬高比 1.2–1.9：${metrics.note}`).toBeLessThan(1.9);
      expect(inText, '量得到文字區域').toBeGreaterThan(0);
      expect(analysis.covered, '竹簡有畫出來（不是空畫面造成的假通過）').toBeGreaterThan(0.005);
      expect(underText, '文字區域底下亮度 > 100 的像素 ≤ 4%（文字清晰）').toBeLessThanOrEqual(0.04);
    });

    test('crest（預約的光點館徽）：館徽矩形中心與亮點外框中心距離 ≤ 8% W、亮點外框在矩形內、是金色（不是朱紅）、預約按鈕不與館徽重疊', async ({ page }) => {
      await open(page, device);
      await settlePose(page, 'booking', 'crest');
      // 館徽要「聚合」夠久才量得到矩形（引擎的 getCrestRect 條件）
      await run(page, 1500);
      const crest = await page.evaluate(() => (window as unknown as W).__qi.debug.crestRect());
      expect(crest, '聚合後量得到館徽矩形').not.toBeNull();
      const { analysis, figure } = await shoot(page, `crest-${device.slug}`);
      const crestBox: Box = { left: crest!.x, right: crest!.x + crest!.w, top: crest!.y, bottom: crest!.y + crest!.h };
      const crestCenter = { x: (crestBox.left + crestBox.right) / 2, y: (crestBox.top + crestBox.bottom) / 2 };
      const figureCenter = { x: (figure.left + figure.right) / 2, y: (figure.top + figure.bottom) / 2 };
      const distance = Math.hypot(crestCenter.x - figureCenter.x, crestCenter.y - figureCenter.y);
      const button = await page.locator('#booking a.button--solid').boundingBox();
      expect(button, '預約按鈕可見').not.toBeNull();
      const buttonBox: Box = { left: button!.x, right: button!.x + button!.width, top: button!.y, bottom: button!.y + button!.height };
      const buttonOverlap = overlapArea(buttonBox, crestBox);
      const texts = await textRects(page, beatText('booking'));
      const textArea = texts.reduce((sum, t) => sum + area(t), 0);
      const textOverlap = textArea > 0 ? texts.reduce((sum, t) => sum + overlapArea(figure, t), 0) / textArea : 0;
      const slack = Math.max(8, 0.03 * (crestBox.right - crestBox.left));
      test.info().annotations.push({
        type: 'crest',
        description:
          `館徽矩形 ${JSON.stringify(crestBox)}；亮點外框 ${JSON.stringify(figure)}；中心距 ${f(distance)} px（${pct(distance / device.viewport.width)}W）；` +
          `紅 ${analysis.red} 像素；亮度 > 100 的像素占 ${pct(analysis.bright)}；按鈕 ${JSON.stringify(buttonBox)}、與館徽重疊 ${f(buttonOverlap)} px²；與文字重疊 ${pct(textOverlap)}`,
      });
      expect(distance / device.viewport.width, '館徽矩形中心與亮點外框中心距離 ≤ 8% W').toBeLessThanOrEqual(0.08);
      expect(figure.left, '亮點外框在矩形內（左）').toBeGreaterThanOrEqual(crestBox.left - slack);
      expect(figure.right, '亮點外框在矩形內（右）').toBeLessThanOrEqual(crestBox.right + slack);
      expect(figure.top, '亮點外框在矩形內（上）').toBeGreaterThanOrEqual(crestBox.top - slack);
      expect(figure.bottom, '亮點外框在矩形內（下）').toBeLessThanOrEqual(crestBox.bottom + slack);
      expect(analysis.red, '館徽是金色，紅色像素 < 40').toBeLessThan(40);
      expect(buttonOverlap, '預約按鈕不與館徽重疊').toBe(0);
      expect(textOverlap, '亮點外框與 DOM 文字矩形重疊 ≤ 文字面積的 5%').toBeLessThanOrEqual(0.05);
    });
  });
}

// 控制者裁定（R1）：手機直向的 others 在 390×844 與 360×740 都要四個人形完整落在畫布內（四邊留白 ≥ 8 px）、與文字矩形重疊 ≤ 5%。
test.describe(`引擎截圖：${SMALL_PHONE.name}`, () => {
  test.use({ viewport: SMALL_PHONE.viewport });

  const c = HUMAN_CASES.find((item) => item.pose === 'others')!;
  test(`${c.label}：人形標準`, async ({ page }) => {
    const metrics = await measureHuman(page, SMALL_PHONE, c);
    expectPlacement(metrics, SMALL_PHONE);
    expectHeight(metrics, c.stance, SMALL_PHONE);
  });
});

// ── 7. 減少動態的靜態圖 ───────────────────────────────────────

/** 版面上有占位、卻被樣式藏起來（透明或 visibility:hidden）的內容；`display:none`（沒在顯示的那組面板）不算。 */
const hiddenRendered = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const hidden: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main h1, main h2, main h3, main p, main a, main li, main img')) {
      if (el.closest('[aria-hidden="true"]') || el.getClientRects().length === 0) continue;
      for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (Number(style.opacity) < 0.99 || style.visibility === 'hidden') {
          hidden.push(`${el.tagName}.${el.className}: ${(el.textContent ?? '').trim().slice(0, 12)}`);
          break;
        }
      }
    }
    return hidden;
  });

/** 目前顯示的那組面板裡，每一段（BEATS）的靜態圖都可見、已載入；回傳每段一張視窗截圖（拼接圖用）。 */
async function checkStills(page: Page, audience: 'adult' | 'kid', device: Device): Promise<Buffer[]> {
  const shots: Buffer[] = [];
  for (const beat of BEATS) {
    const section = page.locator(`[data-beat="${beat}"]`);
    await expect(section, `${beat} 段存在`).toHaveCount(1);
    await section.scrollIntoViewIfNeeded();
    await scrollToBeat(page, beat);
    // 開場的靜態圖是海報；收費課表是竹簡（scroll）的靜態圖、預約是光點館徽（crest）的靜態圖，各段都至少有一張可見的圖
    const stills =
      beat === 'opening'
        ? page.locator('.opening__poster img')
        : section.locator('img.beat__still').filter({ visible: true });
    if (beat === 'pricing') await expect(section.locator('h2'), 'pricing 的標題可見').toBeVisible();
    expect(await stills.count(), `${audience}／${beat}：至少一張可見的靜態圖`).toBeGreaterThan(0);
    for (let i = 0; i < (await stills.count()); i++) {
      const still = stills.nth(i);
      await expect(still, `${audience}／${beat} #${i} 可見`).toBeVisible();
      await expect
        .poll(() => still.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), `${audience}／${beat} #${i} naturalWidth > 0`)
        .toBeGreaterThan(0);
    }
    expect(await hiddenRendered(page), `${audience}／${beat}：沒有被樣式藏住的內容`).toEqual([]);
    shots.push(await page.screenshot());
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${device.name} 無水平外溢`).toBeLessThanOrEqual(0);
  return shots;
}

/** 把一組視窗截圖縮小、排成拼接圖（每列 columns 張），方便一眼看完整頁。 */
async function contactSheet(shots: Buffer[], viewport: { width: number; height: number }, columns: number, cell: number): Promise<Buffer> {
  const cellW = cell;
  const cellH = Math.round((cell * viewport.height) / viewport.width);
  const gap = 6;
  const rows = Math.ceil(shots.length / columns);
  const tiles = await Promise.all(shots.map((shot) => sharp(shot).resize(cellW, cellH).png().toBuffer()));
  return sharp({
    create: { width: columns * (cellW + gap) + gap, height: rows * (cellH + gap) + gap, channels: 3, background: '#303030' },
  })
    .composite(tiles.map((input, i) => ({ input, left: gap + (i % columns) * (cellW + gap), top: gap + Math.floor(i / columns) * (cellH + gap) })))
    .png()
    .toBuffer();
}

for (const device of DEVICES) {
  test.describe(`減少動態的靜態圖：${device.name}`, () => {
    test.use({ viewport: device.viewport, reducedMotion: 'reduce' });

    test('每段 .beat__still img 可見、naturalWidth > 0，大人與小孩兩組都沒有 opacity:0 的內容', async ({ page }) => {
      watch(page);
      await page.goto('./');
      await expect(html(page)).toHaveClass(/qi-static/);
      await expect(html(page)).toHaveAttribute('data-qi-mode', 'static');
      await expect(page.locator('canvas[data-qi-canvas]')).toBeHidden();

      const adult = await checkStills(page, 'adult', device);
      save(`static-adult-${device.slug}`, await contactSheet(adult, device.viewport, device.slug === 'desktop' ? 4 : 6, device.slug === 'desktop' ? 440 : 250));

      await page.locator('#courses').scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: '小孩' }).click();
      await expect(html(page)).toHaveAttribute('data-audience', 'kid');
      const kid = await checkStills(page, 'kid', device);
      save(`static-kid-${device.slug}`, await contactSheet(kid, device.viewport, device.slug === 'desktop' ? 4 : 6, device.slug === 'desktop' ? 440 : 250));
    });
  });
}
