// 光點引擎的頁面接線（首頁 `home/init-home.ts` 與 Task 26 起的各頁 `qi/page.ts` 共用的那一半）。
//
//   - 殼：`window.__qi`（只有 ready／frames／tier／mode；`?qi-debug=1` 才多一個 debug）與 `html[data-qi-*]`（`setAttr` 只在值變了才寫 DOM）。
//   - 退回與收尾：`alive`、`shutdown`（停掉每格迴圈、觀察者、釋放引擎與 GL context）；退回靜態圖（`fallback.ts` 的 `enterStatic`）時一律收尾，
//     之後這裡的處理器都不再動作。減少動態、`<head>` 的探測已判定沒有 WebGL2（`html.qi-static`）時根本不載入引擎（`stayStatic`）。
//   - 降級：引擎依 fps 自動降級時在 window 發 `qi:tier`，這裡把 `html[data-qi-tier]` 與 `window.__qi.tier` 跟著改；降級不碰姿勢。
//   - 掛載：動態 import 引擎 chunk（three 在裡面）、`mountQiStage`；掛不上（chunk 載不到、WebGL 建不起來）退回靜態圖。
//     WebGL context 中途遺失（RF5）、降級重建丟錯由引擎回呼，一律退回靜態圖。
//   - 取景：`refit` 以「上次取景時的尺寸」為基準（RF1：網址列伸縮的小抖動不取景，累計超過門檻才取景）。
//   - 姿勢：`requestPose` 載入失敗就留在原姿勢（`requested` 不退回，所以停在同一段不會每格重發請求），warn 一次；`data-qi-pose` 只在最後一次要求載入完成後才更新。
//   - 每格：`loop` 排 rAF（先排下一格、再算這一格，tick 丟錯時錯誤照常冒出但迴圈不會永久停擺），passive scroll 監聽喚醒。
//   - 離開頁面（`pagehide`、非 bfcache）釋放引擎與 GL context；bfcache 返回（`pageshow` persisted）時呼叫端重設時間戳後繼續。
//   - 這個檔案會被打進頁面的腳本：程式字串與錯誤訊息只用英文（字型守門會掃 JS 裡的中文字）。

import type { PoseId } from '../../qi/config/poses';
import { initialTier, TIER_ORDER, type TierId } from '../../qi/engine/tiers';
import { viewportChanged } from '../../qi/engine/viewport';
import { fetchBytes } from '../../qi/shapes/fetch';
import { createShapeLoader, type ShapeLoader } from '../../qi/shapes/loader';
import { resolveShapeUrl } from '../../qi/shapes/urls';
import type { QiDebug, QiStage, QiStageOptions } from '../../qi/engine/qi-stage';
import { enterStatic, onEnterStatic } from './fallback';

export type Mode = 'webgl' | 'static';

export interface QiGlobal {
  ready: boolean;
  frames: number;
  tier: TierId;
  mode: Mode;
  debug?: QiDebug;
}

/** 掛載時引擎需要的選項裡，呼叫端決定的那一半（其餘由 host 補：畫布、tier、載入器、debug、context 遺失與失敗的回呼）。 */
export type StageOptions = Omit<QiStageOptions, 'canvas' | 'tier' | 'loader' | 'debug' | 'onContextLost' | 'onFailure'>;

export interface QiHost {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly params: URLSearchParams;
  readonly tier: TierId;
  readonly reducedMotion: boolean;
  readonly qi: QiGlobal;
  readonly loader: ShapeLoader;
  /** 這個頁面的引擎還活著嗎：退回靜態圖或離開頁面之後，所有處理器都不該再碰引擎。 */
  alive(): boolean;
  /** 掛上之後才有；呼叫端先確認 `alive()`。 */
  readonly stage: QiStage;
  /** 最近一次要求的姿勢（尚未要求過是 null）；首頁在每格比對它，載入途中被擋下時要自己改回 null 才會重試。 */
  requested: PoseId | null;
  /** 只在值變了才寫 `<html data-…>`（每格都會呼叫）。 */
  setAttr(name: string, value: string): void;
  /** 收尾時一起停的東西（觀察者、計時器）；依登記順序在釋放引擎之前呼叫。 */
  onShutdown(stop: () => void): void;
  /** 退回靜態圖時（引擎已收尾之後）要做的事；依登記順序呼叫，帶原因。 */
  onStatic(listener: () => void): void;
  /** 減少動態或沒有 WebGL2：退回靜態圖（不載入引擎）。回 true ＝ 呼叫端應該直接結束。 */
  stayStatic(): boolean;
  /** 寫 `data-qi-tier` 並聽引擎的降級事件。 */
  watchTier(): void;
  /** 動態載入引擎並掛上；失敗退回靜態圖並回 false。 */
  mount(options: StageOptions): Promise<boolean>;
  /** 換姿勢（見檔頭）；`burst` 預設由呼叫端決定。 */
  requestPose(pose: PoseId, burst: boolean): void;
  /** 掛上之後的第一個姿勢（光點直接落在目標上）：載入成功回 true；失敗退回靜態圖並回 false；載入途中退回靜態圖也回 false。 */
  firstPose(pose: PoseId): Promise<boolean>;
  /** 視窗尺寸與上次取景時差太多才取景（RF1）。 */
  refit(): void;
  /** 每個 rAF 都跑 `tick`；回傳「排一格」的函式（scroll、resize 等事件用它喚醒）。 */
  loop(tick: () => void): () => void;
  /** 視窗大小變了：取景、跑 `extra`、再排一格。 */
  watchResize(extra: () => void): void;
  /** pagehide（非 bfcache）釋放引擎；pageshow（bfcache 返回）呼叫 `restore` 後再排一格。 */
  watchLifecycle(restore: () => void): void;
  /** 引擎就緒：`qi.ready`、`data-qi-mode="webgl"`、`data-qi-ready="true"`。 */
  markReady(): void;
}

export function createQiHost(canvas: HTMLCanvasElement): QiHost {
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  const tier = initialTier({
    touch: matchMedia('(pointer: coarse)').matches,
    width: window.innerWidth,
    override: params.get('qi-tier'),
  });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // window.__qi 與 html 屬性：先有殼，引擎掛上後才 ready。
  const qi: QiGlobal = { ready: false, frames: 0, tier, mode: 'webgl' };
  (window as unknown as { __qi?: QiGlobal }).__qi = qi;

  let alive = true;
  let engine: QiStage | undefined;
  let raf = 0;
  let scheduler: (() => void) | undefined;
  const teardowns: (() => void)[] = [];
  const shutdown = (): void => {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(raf); // 停掉每格迴圈
    raf = 0;
    for (const stop of teardowns) stop();
    teardowns.length = 0;
    engine?.dispose(); // 也釋放 GL context
  };
  onEnterStatic(() => {
    qi.mode = 'static';
    qi.ready = false;
    shutdown();
  });

  const written = new Map<string, string>();
  const setAttr = (name: string, value: string): void => {
    if (written.get(name) === value) return;
    written.set(name, value);
    root.dataset[name] = value;
  };

  const loader = createShapeLoader({ fetch: fetchBytes, resolveUrl: resolveShapeUrl });
  let fitted = { w: window.innerWidth, h: window.innerHeight };
  const failedPoses = new Set<PoseId>();

  const host: QiHost = {
    root,
    canvas,
    params,
    tier,
    reducedMotion,
    qi,
    loader,
    alive: () => alive,
    get stage(): QiStage {
      return engine!;
    },
    requested: null,
    setAttr,
    onShutdown: (stop) => void teardowns.push(stop),
    onStatic: (listener) => void onEnterStatic(listener),
    stayStatic() {
      if (!reducedMotion && !root.classList.contains('qi-static')) return false;
      enterStatic(reducedMotion ? 'reduced-motion' : 'no-webgl');
      return true;
    },
    watchTier() {
      setAttr('qiTier', tier);
      // 引擎降級（依實測 fps，或呼叫端 setTier）時發 qi:tier：屬性與 window.__qi.tier 一起更新（Task 17）
      const onTier = (event: Event): void => {
        const next: unknown = (event as CustomEvent<unknown>).detail;
        if (!alive || typeof next !== 'string' || !TIER_ORDER.includes(next as TierId)) return;
        qi.tier = next as TierId;
        setAttr('qiTier', next);
      };
      window.addEventListener('qi:tier', onTier);
      teardowns.push(() => window.removeEventListener('qi:tier', onTier));
    },
    async mount(options) {
      try {
        const { mountQiStage } = await import('../../qi/engine/qi-stage');
        engine = await mountQiStage({
          ...options,
          canvas,
          tier,
          loader,
          debug: params.get('qi-debug') === '1',
          onContextLost: () => enterStatic('context-lost'), // RF5：靜態圖接手，DOM 內容不變
          onFailure: (error) => {
            // 自動降級時重建丟錯：引擎已沒有 sim 可畫，停在空白畫布比靜態圖糟；退回靜態圖（shutdown 會 dispose 引擎）
            console.warn('The qi engine failed while lowering its tier; showing still images.', error);
            enterStatic('tier-failed');
          },
        });
      } catch (error) {
        console.warn('The qi engine could not start; showing still images.', error);
        enterStatic('init-failed');
        return false;
      }
      if (engine.debug) qi.debug = engine.debug;
      // prev 是「上次取景時的尺寸」，不是上一個 resize 事件的（RF1）。起點是引擎掛上當下的尺寸（這一行與 mountQiStage 之間沒有 await，與引擎量到的一致）。
      fitted = { w: window.innerWidth, h: window.innerHeight };
      return true;
    },
    requestPose(pose, burst) {
      if (!alive) return;
      host.requested = pose;
      engine!.setPose(pose, { burst }).then(
        () => {
          failedPoses.delete(pose);
          if (alive && host.requested === pose) setAttr('qiPose', pose);
        },
        (error: unknown) => {
          if (!alive || failedPoses.has(pose)) return;
          failedPoses.add(pose);
          console.warn(`The pose "${pose}" could not be loaded; keeping the previous one.`, error);
        },
      );
    },
    async firstPose(pose) {
      try {
        host.requested = pose;
        await engine!.setPose(pose, { burst: false });
        if (!alive) return false; // 載入途中退回靜態圖了（context 遺失）
        setAttr('qiPose', pose);
        host.refit(); // RF1 邊角：載入途中視窗變了
        return true;
      } catch (error) {
        console.warn('The first pose could not be loaded; showing still images.', error);
        enterStatic('init-failed');
        return false;
      }
    },
    refit() {
      const next = { w: window.innerWidth, h: window.innerHeight };
      if (!viewportChanged(fitted, next)) return;
      engine!.resize(canvas.clientWidth, canvas.clientHeight);
      fitted = next;
    },
    loop(tick) {
      // 每個 rAF 都跑（引擎自己也是）。先排下一格、再算這一格（try/finally）：tick 丟錯時錯誤照常冒出，但迴圈不會永久停擺。
      const schedule = (): void => {
        if (!alive || raf !== 0) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          try {
            qi.frames++;
            tick();
          } finally {
            schedule();
          }
        });
      };
      scheduler = schedule;
      window.addEventListener('scroll', schedule, { passive: true });
      return schedule;
    },
    watchResize(extra) {
      window.addEventListener('resize', () => {
        if (!alive) return;
        host.refit();
        extra();
        scheduler?.();
      });
    },
    watchLifecycle(restore) {
      window.addEventListener('pagehide', (event) => {
        if (event.persisted) return; // 進 bfcache：引擎原封不動，pageshow 回來繼續
        enterStatic('page-hide'); // 真的離開：釋放引擎與 GL context，並讓這個頁面（若又被顯示）是靜態圖，不是一張死掉的畫布
      });
      window.addEventListener('pageshow', (event) => {
        if (!event.persisted || !alive) return;
        // 從 bfcache 回來：時間戳與捲動位置都過期了，由呼叫端重設後再排一格（context 若被瀏覽器收走，會走 webglcontextlost 退回靜態圖）
        restore();
        scheduler?.();
      });
    },
    markReady() {
      qi.ready = true;
      setAttr('qiMode', 'webgl');
      setAttr('qiReady', 'true');
    },
  };
  return host;
}
