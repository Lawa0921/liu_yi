// 非首頁的頁面光點層（Task 26）：課程總覽、課程內頁、師資、教練、場地、收費、課表、404 共用的接線。
// 殼、退回、降級、掛載、取景、換姿勢、每格迴圈、resize、離開頁面都在 `qi/host.ts`（與首頁共用）；這裡只有「頁面光點層」專有的：
//
//   - 槽（`engine/slot.ts`）：形體擺進頁面指定的一塊矩形。多數頁面的畫布本身就是那一塊（桌機寬螢幕是右側欄、其他是頁首上方的一條）；
//     課程總覽的畫布是整張背景（氣流），形體只在滑過課程卡時聚在右側欄（`[data-qi-slot]`）。
//   - 每種頁面的互動（`PageKind`）：課程總覽＝滑過或聚焦課程卡，光點聚成該課的姿勢，離開回到氣流；師資總覽＝滑過或聚焦教練卡，脈動一下；
//     場地（院門）與 404（人形）＝從飄散慢慢聚成形體（場地在寬螢幕改由捲動帶動）；課程內頁、教練頁、收費、課表＝固定姿勢。
//   - 暫停：整條畫布（頁首上方那一條）捲出視窗就暫停繪製；課程頁有 3D 兵器架（`[data-sub-items] [data-weapon3d]`，自己有一個 WebGL context）
//     進入視窗時，頁首的光點淡出並暫停（兩個 context 不同時畫），離開視窗再回來。
//   - 掌風：與首頁相同（引擎的指標掛在 window 上）；畫布不接收指標事件。
//   - 沒有入館閘門、沒有開場：其他頁面直接顯示（首屏先是文字與該形體的靜態圖，引擎接手後交叉淡化）。
// 這個檔案會被打進頁面的腳本：程式字串與錯誤訊息只用英文（字型守門會掃 JS 裡的中文字）；也不得 import `config/copy.ts`。

import { isPageKind, PAGES, QI_RAIL_QUERY } from '../../qi/config/pages';
import type { PoseId } from '../../qi/config/poses';
import { gatherByScroll, gatherByTime, gatherModeOf, type GatherMode } from '../../qi/engine/gather';
import type { SlotBox } from '../../qi/engine/slot';
import { createQiHost, type QiHost } from './host';

/** 引擎就緒之後多久（毫秒）才預取課程總覽的各個姿勢：要在首屏預算（量到 data-qi-ready 為止）之外。 */
const PREFETCH_DELAY_MS = 2500;
/** 時間聚合：載入後先讓氣流飄這麼久（秒）才要求形體。 */
const GATHER_DELAY = 0.4;

/** 首次內容繪製（文字出現）之後 resolve；量不到（不支援、逾時 3 秒）也 resolve，引擎不會因此永遠不來。 */
function firstContentfulPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (performance.getEntriesByName('first-contentful-paint').length > 0) {
      resolve();
      return;
    }
    let timer = 0;
    const observer = new PerformanceObserver((list) => {
      if (list.getEntriesByName('first-contentful-paint').length === 0) return;
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    });
    try {
      observer.observe({ type: 'paint', buffered: true });
    } catch {
      resolve(); // 這個瀏覽器不報 paint 計時
      return;
    }
    timer = window.setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 3000);
  });
}

/**
 * 首屏的文字與靜態圖先出來：等首次內容繪製、load 事件、再等瀏覽器閒下來，才載入 three、引擎與形體
 * （每頁首屏預算 1.5 MB；`budget.spec` 量「首次內容繪製早於它們的請求」）。靜態圖與內容不依賴這一步，所以引擎晚一點到只是交叉淡化晚一點。
 */
async function afterFirstScreen(): Promise<void> {
  await firstContentfulPaint();
  if (document.readyState !== 'complete') await new Promise<void>((resolve) => window.addEventListener('load', () => resolve(), { once: true }));
  await new Promise<void>((resolve) => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 1000 });
    else setTimeout(resolve, 100);
  });
}

/** 頁尾把槽壓縮到至少這麼高（px）：再矮就縮成一點點了，寧可讓頁尾蓋住一小角。 */
const MIN_SLOT_PX = 60;

/**
 * 槽在畫布上的矩形。`limit` 是槽的下緣不得超過的視窗座標（頁尾的上緣）：頁尾在 main 外面、有不透明的底，捲到底時蓋在固定的右側欄上，
 * 光點只用頁尾之上的部分（槽被壓縮、光點隨頁尾升起而縮小上移），不被蓋住。
 */
function measureSlot(canvas: HTMLCanvasElement, target: HTMLElement, limit?: number): SlotBox | undefined {
  const box = target.getBoundingClientRect();
  if (!(box.width >= 1) || !(box.height >= 1)) return undefined; // display:none 或還沒有版面
  const origin = canvas.getBoundingClientRect();
  const height = limit === undefined ? box.height : Math.max(Math.min(box.height, limit - box.top), MIN_SLOT_PX);
  return { x: box.left - origin.left, y: box.top - origin.top, w: box.width, h: height };
}

/**
 * 課程總覽：滑過（滑鼠）或聚焦（鍵盤）某張課程卡，光點聚成該課的姿勢；離開回到氣流。只有寬螢幕（有右側欄）才聚。
 * 回傳「預取目前看得到的課程卡的姿勢」的函式：首屏之後才呼叫（每頁首屏預算 1.5 MB，形體每個約 112 KB），滑過時才不必等。
 */
function wireCourseCards(host: QiHost, rail: MediaQueryList): () => void {
  const cards = [...document.querySelectorAll<HTMLElement>('.course-card[data-qi-pose]')];
  const poseOf = (card: Element): PoseId | null => (card.getAttribute('data-qi-pose') as PoseId | null) ?? null;
  const show = (pose: PoseId | null): void => {
    if (!rail.matches) return;
    host.requestPose(pose ?? 'flow', true);
  };
  for (const card of cards) {
    const pose = poseOf(card);
    if (!pose) continue;
    card.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') show(pose);
    });
    card.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') show(null);
    });
    card.addEventListener('focusin', () => show(pose));
    card.addEventListener('focusout', (event) => {
      if (!card.contains((event as FocusEvent).relatedTarget as Node | null)) show(null);
    });
  }
  return () => {
    // 沒有右側欄（手機、平板）或不能 hover 的裝置不會聚成姿勢，也就不預取
    if (!host.alive() || !rail.matches || !matchMedia('(hover: hover)').matches) return;
    const visible = cards.filter((card) => card.getBoundingClientRect().width > 0).map(poseOf);
    host.loader.prefetch([...new Set(visible.filter((pose): pose is PoseId => pose !== null))]);
  };
}

/** 師資總覽：滑過或聚焦教練卡，光點脈動一下（`pulse`）。 */
function wireCoachCards(host: QiHost): void {
  const pulse = (): void => {
    if (host.alive()) host.stage.pulse();
  };
  for (const card of document.querySelectorAll<HTMLElement>('.coach-card')) {
    card.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') pulse();
    });
    card.addEventListener('focusin', pulse);
  }
}

export async function initQiPage(): Promise<void> {
  const backdrop = document.querySelector<HTMLElement>('[data-qi-backdrop]');
  const canvas = backdrop?.querySelector<HTMLCanvasElement>('canvas[data-qi-canvas]');
  const kind = backdrop?.dataset.qiPage;
  if (!backdrop || !canvas || !isPageKind(kind)) return;
  const spec = PAGES[kind];
  const initial = (backdrop.dataset.qiInitialPose as PoseId | undefined) ?? spec.pose;

  const host = createQiHost(canvas);
  if (host.stayStatic()) return; // 減少動態或沒有 WebGL2：靜態圖就是畫面，不載入引擎、不預取形體
  await afterFirstScreen();
  if (!host.alive()) return; // 等的期間離開頁面（pagehide）了
  host.watchTier();
  if (initial !== 'flow') host.loader.prefetch([initial]);

  const rail = matchMedia(QI_RAIL_QUERY);
  const slotElement = backdrop.querySelector<HTMLElement>('[data-qi-slot]') ?? canvas;
  // 頁尾的上緣（視窗座標）：只有槽在右側欄（寬螢幕的 rail 頁、課程總覽的右側欄槽）才受它限制；頁首上方的一條與整張畫布不受影響
  const footer = document.querySelector<HTMLElement>('.site-footer');
  const footerLimit = (): number | undefined => (footer && rail.matches && (spec.canvas === 'rail' || spec.slot === 'rail') ? footer.getBoundingClientRect().top : undefined);

  if (!(await host.mount({ slot: { box: () => measureSlot(canvas, slotElement, footerLimit()), world: spec.world } }))) return; // 掛不上：host 已退回靜態圖
  const stage = host.stage;

  // 課程總覽的氣流沒有形體；其他頁面一開始就是各自的姿勢（場地、404 先在氣流裡，晚一點才聚）
  const gather: GatherMode = gatherModeOf(kind, rail.matches);
  const first: PoseId = gather === 'time' ? 'flow' : kind === 'courses' ? 'flow' : initial;
  if (!(await host.firstPose(first))) return;

  // ── 取景：畫布大小變了（窄寬切換、視窗）重新量 ─────────────────
  let sized = { w: canvas.clientWidth, h: canvas.clientHeight };
  const resized = new ResizeObserver(() => {
    if (!host.alive()) return;
    const next = { w: canvas.clientWidth, h: canvas.clientHeight };
    if (next.w === sized.w && next.h === sized.h) return;
    sized = next;
    stage.resize(next.w, next.h);
  });
  resized.observe(canvas);
  host.onShutdown(() => resized.disconnect());
  const onRailChange = (): void => {
    if (host.alive()) stage.reframe(); // 課程總覽：右側欄出現或消失（畫布大小不變，槽的位置變了）
  };
  rail.addEventListener('change', onRailChange);
  host.onShutdown(() => rail.removeEventListener('change', onRailChange));

  // ── 暫停：捲出視窗、3D 兵器架進入視窗 ──────────────────────────
  let offscreen = false;
  let rack = false;
  const syncActive = (): void => {
    if (!host.alive()) return;
    const paused = offscreen || rack;
    stage.setActive(!paused);
    if (!paused) stage.reframe(); // 暫停期間頁尾可能動過（tick 在暫停中不取景），恢復時對準現在的槽
    if (rack) backdrop.dataset.qiPaused = 'rack';
    else if (offscreen) backdrop.dataset.qiPaused = 'offscreen';
    else delete backdrop.dataset.qiPaused;
  };
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) offscreen = !entry.isIntersecting;
    syncActive();
  });
  seen.observe(backdrop);
  host.onShutdown(() => seen.disconnect());
  const racks = document.querySelectorAll('[data-sub-items] [data-weapon3d]');
  if (racks.length > 0) {
    const inView = new Set<Element>();
    const watch = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inView.add(entry.target);
        else inView.delete(entry.target);
      }
      rack = inView.size > 0;
      syncActive();
    });
    for (const el of racks) watch.observe(el);
    host.onShutdown(() => watch.disconnect());
  }

  // ── 這一頁專有的互動 ────────────────────────────────────────────
  const prefetchCards = kind === 'courses' ? wireCourseCards(host, rail) : undefined;
  if (kind === 'coaches') wireCoachCards(host);

  // ── 每一格：聚合的程序 ──────────────────────────────────────────
  const startedAt = performance.now();
  let formed = gather !== 'time'; // time：過一小段才要求形體（先讓氣流飄一下）
  let lastScatter = -1;
  let lastSqueeze = -1;
  const tick = (): void => {
    let scatter = 0;
    if (gather === 'time') {
      const elapsed = (performance.now() - startedAt) / 1000;
      if (!formed && elapsed >= GATHER_DELAY) {
        formed = true;
        host.requestPose(initial, false);
      }
      scatter = formed ? gatherByTime(elapsed - GATHER_DELAY) : 1;
    } else if (gather === 'scroll') {
      scatter = gatherByScroll(window.scrollY, window.innerHeight, document.documentElement.scrollHeight - window.innerHeight);
    }
    stage.setScatter(scatter);
    // 頁尾升進槽的範圍：每當頁尾的上緣移動（只算它在槽內的部分）就重新取景（只動相機，便宜）；暫停中（捲出視窗、兵器架）不做
    const limit = footerLimit();
    const squeeze = limit === undefined ? -1 : Math.round(Math.min(limit, slotElement.getBoundingClientRect().bottom));
    if (squeeze !== lastSqueeze) {
      lastSqueeze = squeeze;
      if (!offscreen && !rack) stage.reframe();
    }
    if (scatter !== lastScatter) {
      lastScatter = scatter;
      host.setAttr('qiScatter', scatter.toFixed(2));
    }
  };
  const schedule = host.loop(tick);
  // 離開頁面（pagehide）釋放引擎；bfcache 返回時引擎原封不動，這裡沒有時間戳要重設（聚合的程序用 performance.now，回來之後自然已經聚好）
  host.watchLifecycle(() => undefined);

  if (gather === 'scroll' || gather === 'time') host.setAttr('qiGather', gather);
  host.setAttr('qiPage', kind);
  host.markReady();
  schedule();
  // 首屏（就緒）之後再過一會兒、瀏覽器閒下來時才預取課程卡的姿勢
  if (prefetchCards) {
    setTimeout(() => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(prefetchCards, { timeout: 4000 });
      else prefetchCards();
    }, PREFETCH_DELAY_MS);
  }
}
