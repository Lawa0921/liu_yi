import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ARMED } from '../../src/qi/config/armed';
import { SILHOUETTES_READY } from '../../src/qi/config/silhouettes';
import { OPAQUE } from '../../src/qi/shapes/head';
import { eraseWeapon } from '../../src/qi/shapes/sample-armed';
import type { FigureImage } from '../../src/qi/shapes/sample-figure';

// 持械形體的真素材驗收（Task 27）：ARMED 裡的座標是對著剪影量的，這裡用真的剪影驗——兵器軸落在剪影的兵器上、穿過手、剔掉兵器之後人形仍是完整的一塊。
const DIR = new URL('../../src/assets/silhouettes/', import.meta.url);

async function load(src: string): Promise<FigureImage> {
  const { data, info } = await sharp(fileURLToPath(new URL(`${src}.png`, DIR))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = new Uint8Array(info.width * info.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * info.channels + info.channels - 1]!;
  return { alpha, width: info.width, height: info.height };
}

/** (x, y) 附近半徑 r 內有沒有不透明像素。 */
function opaqueNear(img: FigureImage, x: number, y: number, r: number): boolean {
  const x0 = Math.max(0, Math.floor(x - r));
  const x1 = Math.min(img.width - 1, Math.ceil(x + r));
  const y0 = Math.max(0, Math.floor(y - r));
  const y1 = Math.min(img.height - 1, Math.ceil(y + r));
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) if (img.alpha[yy * img.width + xx]! >= OPAQUE && (xx - x) ** 2 + (yy - y) ** 2 <= r * r) return true;
  return false;
}

/** 點到線段的距離。 */
function distance(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/** 8 連通元件的面積（由大到小）。 */
function componentAreas(img: FigureImage): number[] {
  const { alpha, width, height } = img;
  const seen = new Uint8Array(width * height);
  const areas: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < alpha.length; start++) {
    if (alpha[start]! < OPAQUE || seen[start]) continue;
    let area = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop()!;
      area++;
      const x = at % width;
      const y = (at - x) / width;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (alpha[next]! >= OPAQUE && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
    }
    areas.push(area);
  }
  return areas.sort((a, b) => b - a);
}

/** 握點（手的中心，原圖 px，看圖量）與兵器軸離它的容許距離：苗刀的刀身是弧的，弦與手差一點。 */
const HANDS: Record<string, { points: [number, number][]; tolerance: number }> = {
  jian: { points: [[335, 152]], tolerance: 14 },
  miaodao: { points: [[578, 258], [720, 303]], tolerance: 32 },
  spear: { points: [[575, 182], [1097, 218]], tolerance: 14 },
  'kid-weapon': { points: [[362, 322]], tolerance: 30 },
  'kid-miaodao': { points: [[585, 290], [655, 292]], tolerance: 30 },
  'kid-spear': { points: [[470, 205], [930, 235]], tolerance: 16 },
};
/** 兵器軸（弦）上每個取樣點，離剪影的不透明像素最遠多少 px：直兵器很近，苗刀的弧讓弦偏離刀身。 */
const AXIS_SLACK: Record<string, number> = { jian: 14, miaodao: 45, spear: 14, 'kid-weapon': 18, 'kid-miaodao': 24, 'kid-spear': 16 };

describe.each(Object.entries(ARMED))('持械設定 %s', (id, def) => {
  it('剪影在已核可清單裡，檔案存在', async () => {
    expect(SILHOUETTES_READY).toContain(def.src);
    const img = await load(def.src);
    expect(img.width).toBeGreaterThanOrEqual(500);
  });

  it('兵器軸（鋒尖→尾端）在圖內，鋒尖落在剪影的兵器尖上，軸上每一點都貼近剪影（沒有量到空白處）', async () => {
    const img = await load(def.src);
    const { tip, butt } = def.spec;
    for (const [x, y] of [tip, butt]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(img.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(img.height);
    }
    expect(opaqueNear(img, tip[0], tip[1], 12), '鋒尖附近有剪影的兵器').toBe(true);
    const length = Math.hypot(butt[0] - tip[0], butt[1] - tip[1]);
    expect(length, '兵器夠長（至少 1/3 圖寬或圖高）').toBeGreaterThan(Math.max(img.width, img.height) / 3);
    for (let k = 0; k <= 40; k++) {
      const x = tip[0] + ((butt[0] - tip[0]) * k) / 40;
      const y = tip[1] + ((butt[1] - tip[1]) * k) / 40;
      expect(opaqueNear(img, x, y, AXIS_SLACK[id]!), `軸上第 ${k}/40 點 (${x.toFixed(0)}, ${y.toFixed(0)}) 離剪影太遠`).toBe(true);
    }
  });

  it('兵器軸穿過手：握點離軸線的距離在容許內（兵器落在手上）', () => {
    const { tip, butt } = def.spec;
    const { points, tolerance } = HANDS[id]!;
    for (const [x, y] of points) expect(distance(x, y, tip, butt), `握點 (${x}, ${y})`).toBeLessThanOrEqual(tolerance);
  });

  it('剔掉兵器之後：真的剔掉了一些、人形仍是單一的一塊（除了不到 40 px 的碎屑）、手與頭沒有被挖洞', async () => {
    const img = await load(def.src);
    const before = componentAreas(img);
    const { image, erased } = eraseWeapon(img, def.spec.erase);
    expect(erased, '剔掉的像素').toBeGreaterThan(2000);
    const after = componentAreas(image);
    expect(after[0]!, '主體保留超過 85% 的面積').toBeGreaterThan(before[0]! * 0.85);
    expect(after.filter((area) => area >= 40), '沒有被切成好幾塊').toHaveLength(1);
    // 手的中心像素還在（保留圈或膠囊沒有吃到手）
    for (const [x, y] of HANDS[id]!.points) expect(image.alpha[Math.round(y) * image.width + Math.round(x)]!, `手 (${x}, ${y})`).toBeGreaterThanOrEqual(OPAQUE);
  });

  it('weaponShare、surfaceShare 在 (0, 1) 之間；weapon 是三件兵器之一；headPx 為正整數', () => {
    expect(def.spec.weaponShare).toBeGreaterThan(0.15);
    expect(def.spec.weaponShare).toBeLessThan(0.6);
    if (def.spec.surfaceShare !== undefined) {
      expect(def.spec.surfaceShare).toBeGreaterThan(0.25);
      expect(def.spec.surfaceShare).toBeLessThan(0.9);
    }
    expect(['jian', 'miaodao', 'spear']).toContain(def.weapon);
    expect(Number.isInteger(def.headPx) && def.headPx > 0).toBe(true);
  });
});
