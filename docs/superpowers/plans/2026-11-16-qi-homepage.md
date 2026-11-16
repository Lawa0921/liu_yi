# 首頁「氣聚成人」實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把首頁整個改成「金色光點聚成八極拳師」的新骨架（光點引擎、段落捲動、大人／小孩切換、朱印預約），全站改用全字庫正楷體 TW-Kai 子集。

**Architecture:** 建置時把剪影、兵器快照、朱印遮罩預算成二進位形體檔與靜態 WebP（Astro integration 產生，輸入雜湊不變就跳過）。執行時一個動態載入的 `qi-stage` 模組（GPGPU 光點模擬＋自寫光暈）接在純邏輯的捲動模型、降級調速器、開場時間軸之後；首頁本身是正常的 DOM `section`＋ `position: fixed` 的 canvas，內容全是 DOM 文字，引擎失效時退回靜態圖。字型原檔不進 git，由腳本下載並驗 sha256，只提交子集產物，建置時守門。

**Tech Stack:** Astro 7（靜態、GitHub Pages）、three@0.187、TypeScript、vitest（單元）、Playwright（e2e，in-process 驅動）、新增 devDependencies：`tsx`、`sharp`（已是 astro 的傳遞相依，改為明列）、`subset-font`、`fflate`。

**Spec:** `docs/superpowers/specs/2026-11-16-qi-homepage-design.md`（以下簡稱「設計」，§ 指其章節）。前一份設計 `2026-11-15-astro-rewrite-design.md` 的其餘頁面與內容模型沿用。

## Global Constraints

每個任務的需求都隱含本節。

- **技術**：Astro 7 靜態輸出、GitHub Pages；site／base／outDir 只在 `deploy-target.mjs`（預設 base `/liu_yi`；`build:root` 輸出 `dist-root`，base `/`）；站內連結一律經 `src/lib/url.ts` 的 `url()`。three@0.187。
- **傳輸量**：首屏 ≤ 1.5 MB（目標 ≤ 1.3 MB）；整頁 ≤ 5 MB（設計 §5）。量測規則見決定 D28。
- **光點數**：桌機約 6.5 萬點（256² = 65 536）、手機或觸控約 2 萬點（144² = 20 736）；連續低於 40 fps 降一級（設計 §8.1）。
- **捲動**：不用強制 scroll-snap；canvas `position: fixed` 且 `aria-hidden="true"`；高度用 `svh`／`lvh`；resize 不重建模擬（設計 §8.3、§8.5）。
- **字型**：全站 TW-Kai（OFL-1.1，授權檔入庫）、`font-weight` 一律 400、`font-synthesis: none`；Noto Serif TC 全部移除（設計 §8.7）。
- **反目標**（設計 §4）：不得出現太極圖、八卦圖（含卦爻）、龍鳳、日式語彙、假書法、水墨範本感、金色漸層立體字、外發光滿版、彩色技能特效；也不得讓課程／收費／課表／LINE 預約只存在 canvas 裡。
- **既有選擇器必須保留**：`data-audience-option`、`data-audience-panel`、`data-carousel`、`data-slide`、`data-nav-toggle`、`data-line-open`、`#line`、`#line-dialog`、`data-video-section`、`data-course-body`、`data-gallery`、`data-sub-items`、`.course-card h3`、`.coach-card h3`、`.is-active`、`data-active-slide`。首頁改版後失效的首頁測試見〈既有測試遷移表〉；**非首頁的測試保持不動並通過**。
- **測試驅動**：測試只用 in-process 驅動（vitest、Playwright 的 `page.*`／`page.clock`／`page.mouse`）。**嚴禁任何 OS 層級滑鼠鍵盤自動化**（不得用 SendInput、AutoHotkey、PyAutoGUI、`pywinauto` 之類驅動使用者真實的滑鼠鍵盤）；派 subagent 時要把這條寫進派工內容。
- **秘密**：OpenAI 金鑰只在 `%APPDATA%\agent-sprite-forge\config.json`，絕不可寫進 repo、log、commit、截圖或任何輸出；生圖腳本沿用「讀檔、輸出前遮蔽」的寫法。
- **CI 不得需要**：下載 TW-Kai 原檔、OpenAI 金鑰、Python、字型原檔。這些只屬於開發者本機指令。
- **改到可見文字的任務**（文案、標籤、alt、aria-label）在 commit 前要跑 `npm run fonts:subset`；建置的字型守門紅燈時不得 commit。
- **TDD**：每個任務 失敗測試 → 看它紅 → 實作 → 看它綠 → commit。純視覺調參改用 headless 截圖檢查，任務內寫明截圖項目與合格標準。設定檔／素材生成類任務以「先寫品管閘門測試」代替。
- **每個 commit 前**：`npm test`、`npm run check`（0 errors、0 warnings）與該任務的 e2e 都要綠。
- **commit 格式**（不要 push）：
  ```
  git -c user.name="Lawa0921" -c user.email="bag571ivy3470@gmail.com" commit -m "<type>: <中文摘要>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```
- **指令**：Shell 指令會被改寫成 `rtk <cmd>`，輸出被截斷時改用 `rtk proxy <cmd>`。本專案在 Windows 原生跑 Node，不走 WSL；Playwright 同一時間只跑一組。
- **targeted e2e 指令**（`dist-root` 只需存在，Task 1 會先建好一次；只有 `links.spec` 與最終驗收用得到它的內容）：
  `npm run build && npx playwright test tests/e2e/<檔名> --project=subpath`
- **headless 的 WebGL 是軟體繪製**：引擎的 e2e 一律加 `?qi-tier=min&qi-debug=1`，並用 `page.clock` 推進時間。

## Review Focus

規格沒說、但最可能咬到使用者的輸入或情境（由最可能者排起）。每一條都在擁有該程式碼的任務裡有一個釘住它的測試（任務內以【RF#】標示）。

1. 【RF1】手機網址列伸縮、轉向：`innerHeight` 變動 ≤ 18% 時不重建、不跳（期待：畫面不閃、粒子不重來）；轉向（寬高對調）要重新取景但保留姿勢。→ Task 13、19
2. 【RF2】開場還在演就點頁首的段落跳轉或快速捲動：期待開場立刻收尾、姿勢直接去目標段落、不報錯。→ Task 19
3. 【RF3】`localStorage`／`sessionStorage` 被封鎖（隱私模式）：期待頁面與引擎正常、切換仍可用（只是不記住）、開場照演。→ Task 19
4. 【RF4】內容缺口：某對象某分類沒有已發布課程、沒有已發布教練、沒有「其他課程」：期待不留空殼段落、捲動模型不崩潰、仍是合法 HTML。→ Task 13、18
5. 【RF5】WebGL context 中途遺失：期待退回靜態圖、不報錯、DOM 內容不變。→ Task 20

---

## 計畫替設計做的決定

設計留白處與計畫自行選擇的值。執行者照做；要推翻請先回報。

| # | 決定 |
|---|---|
| D1 | TW-Kai 原檔（約 37 MB）**不進 git**。`fonts:subset` 下載 `Fonts_Kai.zip`（`https://data.cns11643.gov.tw/opendata/Fonts_Kai.zip`，約 57 MB），只取出 `TW-Kai.ttf` 並驗 sha256 `9b502e5197d52a946552bef100b9a3d601befcf896fb2b64f28f862314bea337`（36 691 296 bytes，字型版本 11510.1；這是 scratchpad 參考檔的實測雜湊，Task 2 要用實際下載再驗一次），快取在 repo 內被忽略的 `.cache/fonts/`。只提交 `twkai-subset.woff2`、`twkai-subset.chars.txt`、OFL 授權檔 |
| D2 | **子集化在開發者指令 `npm run fonts:subset`，建置時一律守門**：每次 `astro build` 的 `astro:build:done` 掃 `dist`，有任何字不在子集就失敗並列出字與頁面。與設計 §8.7 「重新建置就會自動補字」差一個指令，換來 CI 不用下載 57 MB、建置可重現 |
| D3 | 守門規則：HTML 文字節點與 `alt`／`title`／`aria-label`、CSS `content:` 字串、JS 內 CJK／全形範圍字串，**所有非空白字（含 ASCII）都要在子集內**；TW-Kai 本身沒有的字須列入 `scripts/fonts/fallback-allowed.txt`（預設空），否則失敗 |
| D4 | 子集化用 Node 的 `subset-font`（實測 TW-Kai 約 0.2 s、峰值 RSS 約 214 MB），不用 Python；產物保留直排用的 `vhea`／`vmtx`／`vert`（單元測試守住） |
| D5 | 用 Astro 字型功能的 `fontProviders.local()` 載入單一 woff2，CSS 變數 `--font-twkai`；`--font-display` 與 `--font-body` 兩個現有 token 都指向它（設計寫的 `--font-serif` 現況不存在） |
| D6 | 全站 `font-weight: 700` 掃成 400，以單元測試（`style-guard`）守住不再出現 ≥ 500 |
| D7 | 生圖腳本與提示詞入庫 `tools/silhouettes/`（raw PNG 不入庫），`src/assets/silhouettes/provenance.json` 記錄 prompt／raw 雜湊／請求數／QA 結果／狀態 |
| D8 | 新剪影共 5 張：`fig-kid-wushu`、`fig-kid-defense-a`、`fig-kid-defense-b`、`fig-kid-weapon`、`fig-salute`；每張最多 3 次請求，Task 6–7 合計最多 20 次 |
| D9 | 朱印＝朱文、方形、右「六」左「藝」；崇羲篆體只在本機 `tools/seal/render-seal.py` 使用，入庫的是 512×512 的 alpha 遮罩 PNG，字型檔絕不入庫（單元測試檢查） |
| D10 | 形體檔 `.bin` v1：40 B header＋平面化 `u16×3` 座標＋`u8 kind`，每檔固定 N = 16 384 個打散序取樣（114 728 B）。執行時依 tier 擴張：N ≥ 點數就取前綴，否則重複並加 0.006 的抖動 |
| D11 | 形體 `.bin` 與靜態 WebP 是**建置產物**（`src/assets/generated/qi/`，已忽略），由 `integrations/qi-assets.ts` 在 `astro:config:setup` 產生，輸入雜湊不變就跳過；兵器快照 `.geo` 與朱印遮罩 PNG 是**入庫的來源** |
| D12 | 人形比例＝頭部大小對齊＋腳底對齊：`scale = headPx(land) / headPx(f)`；試作的 `FIGURE_SCALE`（lift 1.02、land 1、dingzhou 1.25、chengchui 1.18、kao 1.12）原值搬入設定檔當 `scaleOverride`（已被使用者看過） |
| D13 | 兵器在 `.bin` 內是「長軸 +x、鋒尖朝 +x、置中、全長 1」的單位形，執行時依視窗比例套試作的 length／tilt／height（寬 2.9／3.2／3.8、窄 1.9／2.1／2.3） |
| D14 | 環境煙（7%）不進形體檔，執行時程序化產生，所有姿勢共用同一批 |
| D15 | 光暈自寫（1/4 解析度可分離模糊＋色調映射），不用 `EffectComposer`／`UnrealBloomPass`；`low`／`min` tier 關閉光暈 |
| D16 | tier：`high` 256² / `mid` 192² / `low` 144² / `min` 112²（65 536 / 36 864 / 20 736 / 12 544）。桌機（寬 ≥ 960 且非觸控）起於 `high`，其餘起於 `low`；暖機 2 秒後連續兩個 1 秒視窗平均 < 40 fps 降一級，降級後冷卻 3 秒；降級＝重建 GPGPU |
| D17 | 捲動模型：DOM `[data-beat]`；每個 beat 高 `--stage-height`（svh）；轉場帶＝0.45 個視窗高（聚合停留 ≥ 0.55）；目標在轉場帶中點切換；`scatter = sin(π·u)` |
| D18 | 開場：靜態圖（`land` 的聚合態）交接後才開始；只在每個工作階段第一次進站演（`sessionStorage` 鍵 `liuyi:qi-intro`）。序列約 3.4 s：散開 0.6 s → 吸氣聚成 `lift` → 落地＋衝擊波；`Esc` 或可聚焦的「略過」鈕可跳過；再訪不演 |
| D19 | 靜態圖在建置時由 Node 的 `sharp` 從 `.bin` 渲染（加色點＋模糊），不依賴 headless 瀏覽器；hero 寬／直各一張 ≤ 60 KB，各姿勢靜態圖 ≤ 45 KB |
| D20 | 退回旗標 `html.qi-static` 由 `<head>` 行內腳本在首繪前判定（減少動態、無 WebGL2）；靜態圖是否顯示只由 CSS 決定；引擎執行中失敗再補上同一個 class |
| D21 | 大人／小孩切換鈕做新元件 `components/home/AudienceSwitch.astro`（沿用 `data-audience-*`）；面板 `[data-audience-panel]` 放在各 beat 內；面板顯示規則搬到 `global.css`；引擎用 `MutationObserver` 觀察 `html[data-audience]`，不改 `audience-toggle.ts` |
| D22 | 首頁課程順序依設計 §7＝拳 → 格鬥 → 兵器（課程總覽頁仍是兵器 → 拳術 → 格鬥）；首頁 e2e 用新 helper |
| D23 | 師資段的「專長」＝該教練任教的已發布課程名（用 `coursesOfCoach`，不新增欄位）；教練剪影用通用抱拳，卡片進入視窗中央時引擎 `pulse()` |
| D24 | 「兩行介紹」＝`course.summary`＋`copy.ts` 的一行招式文案；兵器三件子項的一行也來自 `copy.ts`（content 的 `subItems` 沒有 description）。這些文案是提案，交付清單標「待業主確認」 |
| D25 | 段落跳轉＝桌機右緣 `nav.home-rail`（開場、課程、師資、收費課表、預約）；手機不顯示（手機選單已有頁面連結）；不動既有 `主要導覽` |
| D26 | `/lab/qi/` 與開發用 harness 在 Task 22 刪除（試作已被正式模組取代，歷史在 `e56a090`）；`astro.config.mjs` 的 sitemap `/lab/` 篩選保留 |
| D27 | 引擎對外：`window.__qi`（`ready`、`frames`、`tier`、`mode`）與 `html[data-qi-*]`；`?qi-tier=high|mid|low|min` 覆寫 tier；`?qi-debug=1` 才暴露 `debug`（讀回、`feedFrameTime`） |
| D28 | 傳輸量以**未壓縮的 decoded bytes**計（沿用 `trackTransfers` 慣例，GitHub Pages 會 gzip，所以是保守上限）；「首屏」＝載入到 `html[data-qi-ready]`、尚未捲動為止 |
| D29 | 兵器取樣不在執行時、也不在建置時 import `weapons.ts`：`npm run qi:snapshot-weapons` 手動產生三個 `.geo` 快照入庫（約 0.45 MB），快照檔頭記 `weapons.ts` 的 `git hash-object` 以便追溯 |
| D30 | 首頁清理後若 `gsap` 無任何使用者，從 `package.json` 移除 |
| D31 | 不刪未被首頁使用的剪影（`bg-*`、`mid-*`、`fg-*`、`fig-jian`、`fig-miaodao`、`fig-daqiang`）：它們不被 import，不進 `dist`，保留以免過度清理 |
| D32 | `viewer.ts` 的 stage 模式、`switcher.ts`、`stage.ts` 在首頁移除後成為無入口程式碼，但課程頁 3D 規定「不動」，所以保留，列為後續清理 |
| D33 | 地址、電話業主尚未提供，頁尾沿用現有 LINE／Facebook，不新增空欄位 |

## 檔案結構

新增（建置與工具）

- `scripts/fonts/{source,charset,subset,guard,cli}.ts`：TW-Kai 下載驗證、用字掃描、子集化、守門、`fonts:subset` 指令
- `integrations/{twkai-guard,qi-assets}.ts`：兩個 Astro integration（若 `astro.config.mjs` 無法直接 import `.ts`，改成 `.mjs` 外殼以 `tsx` 子行程呼叫）
- `scripts/qi/{snapshot-weapons,build-shapes,render-stills,hash,silhouette-qa}.ts`：形體與靜態圖產線、剪影機械品管
- `tools/silhouettes/{gen.py,postprocess.py,prompts.json}`、`tools/seal/render-seal.py`：生圖與朱印（只在本機跑，用 `uv run --no-project --python 3.11 --with pillow --with numpy --with scipy …`）

新增（資料，入庫）

- `src/assets/fonts/{twkai-subset.woff2,twkai-subset.chars.txt,OFL-TW-Kai.txt}`
- `src/assets/silhouettes/{fig-kid-wushu,fig-kid-defense-a,fig-kid-defense-b,fig-kid-weapon,fig-salute}.{png,webp}`、`provenance.json`
- `src/assets/seal/seal-liuyi.png`
- `src/qi/data/weapons/{jian,miaodao,spear}.geo`

新增（執行時，`src/qi/`）

- `config/{silhouettes,figures,shapes,poses,copy}.ts`：素材清單、人形比例、形體配方、姿勢與 beat 對應、首頁文案
- `shapes/{format,sample-figure,head,weapon-snapshot,sample-weapon,expand,loader}.ts`
- `engine/{scroll-model,tiers,intro,viewport,forces}.ts`：純邏輯，單元測試
- `engine/shaders/{noise,velocity,position,points,ground,glow}.ts`、`engine/{sim,glow,pointer,stage}.ts`、`engine/qi-stage.ts`：three 相關，動態載入的 chunk

新增（首頁）

- `src/lib/home.ts`（`buildHomeModel`）、`src/components/home/{Opening,CoursesRun,CourseBeat,OtherCourses,CoachesBeat,PricingBeat,BookingBeat,AudienceSwitch,SectionRail,Still}.astro`
- `src/scripts/home/{init-home,beats,audience-sync,intro-gate,fallback}.ts`、`src/styles/home.css`

修改

- `astro.config.mjs`、`package.json`、`.gitignore`、`src/layouts/BaseLayout.astro`、`src/styles/{tokens,global,ornament,chrome}.css` 與各元件的 `font-weight`、`src/pages/index.astro`、`README.md`
- `tests/e2e/{helpers,arsenal,motion,chrome,audience,carousel,polish}.spec.ts` 與 `helpers.ts`（見遷移表）

新增（測試）

- `tests/unit/`：`fonts-source`、`fonts-charset`、`fonts-subset`、`fonts-guard`、`style-guard`、`silhouette-qa`、`silhouette-assets`、`seal-asset`、`qi-shape-format`、`qi-figure-sampler`、`qi-figures-config`、`qi-weapon-snapshot`、`qi-weapon-sampler`、`qi-build-shapes`、`qi-stills`、`qi-poses`、`qi-scroll-model`、`qi-tiers`、`qi-intro`、`qi-viewport`、`qi-forces`、`qi-expand`、`qi-loader`、`qi-effects`、`home-model`、`home-copy`、`home-css`、`qi-intro-gate`、`no-dead-home`
- `tests/e2e/`：`fonts`、`qi-engine`、`qi-effects`、`home`、`home-engine`、`home-fallback`、`budget`、`visual`

刪除（Task 22）

- `src/components/{Hero,Acts}.astro`、`src/scripts/{acts,acts-pin,slash,stomp,hero-sheen}.ts`、`src/lib/arsenal/slash.ts`、`tests/unit/arsenal-slash.test.ts`、`src/lab/`、`src/pages/lab/`、只被首頁使用的 `arsenal.css` 規則（`.slash-layer`、`is-slashing`、`.stomp-ring`，以 grep 確認）

## 既有測試遷移表

首頁改版（Task 18）會讓下列測試失效。在 Task 18 同一個 commit 內處理，改完整套 e2e 必須綠。

| 檔案 | 現有測試 | 處置 | 改驗什麼 |
|---|---|---|---|
| `helpers.ts` | `cardTitles` | 保留 | 新增 `HOME_ADULT_ORDER`（八極專修、散手技擊、中式兵器）、`HOME_KID_ORDER`（兒童武術、防身格鬥、防身兵器）、`homeTitles(page, audience)`＝`#courses [data-audience-panel="…"] [data-course-title]`；從 `motion.spec` 搬入 `hiddenByStyle`、從 `arsenal.spec` 搬入 `trackTransfers`／`totalBytes` |
| `audience.spec.ts` | `for path of ['./', './courses/']` 兩個 test | 迴圈只留 `./courses/`；`./` 的兩個移到 `home.spec` | 首頁：預設大人、切小孩後標題與連結換、重新整理保留、非法 storage 回大人；改用 `homeTitles` 與新順序 |
| `audience.spec.ts` | 選擇在首頁與課程總覽沿用 | 保留 | 首頁恰有一組切換鈕，`getByRole('button',{name:'小孩'})` 唯一 |
| `audience.spec.ts` | localStorage 非法值回大人（`./`） | 改寫到 `home.spec` | 同斷言換 `homeTitles` |
| `carousel.spec.ts` | 全部（`openWithPausedClock`、`openHomeAsKid` 走 `./`） | 把 `goto('./')` 改 `goto('./courses/')`，其餘不動 | 輪播行為本來就屬於 `CourseCard`，課程總覽頁有同一批卡片 |
| `chrome.spec.ts` | 減少動態／內容全部可見 | 刪除，改寫到 `home.spec` 同名測試 | 首頁 h1 可見、各 `h2` 可見、兩組課程在小孩切換後可見、無 `opacity:0` |
| `chrome.spec.ts` | 沒有 JavaScript／內容仍看得到 | 改成 `goto('./courses/')`（其餘不動）；首頁版本寫進 `home-fallback.spec` | 首頁無 JS：兩組面板都顯示、靜態圖可見、連結可點 |
| `chrome.spec.ts` | 其餘（導覽、選單、手機溢出、預約體驗、假聯絡資訊） | 保留 | 首頁仍有 `Header`、`LineDialog`、頁尾 `#line` |
| `polish.spec.ts` | 手機寬度：大人｜小孩（`./` 與 `./courses/`） | `./` 版移到 `home.spec`（先捲到課程段再點切換），`./courses/` 版保留 | 切換期間與重新整理後無水平外溢 |
| `polish.spec.ts` | 首頁首屏的進場在 1.2 秒內完成（手機，`.hero *`） | 改寫選擇器為 `.opening *` | 動畫結束時間 > 0 且 ≤ 1200 ms |
| `motion.spec.ts` | 首頁三幕：桌機／減少動態／手機／沒有 JS 桌機首個測試 | 刪除（三幕、釘選、`data-acts` 已不存在） | 由 `home.spec`、`home-fallback.spec` 取代 |
| `motion.spec.ts` | 沒有 JS 的海報與照片切換按鈕、海報站內放大、課程頁照片切換 | 保留 | — |
| `arsenal.spec.ts` | 兵器台：桌機 ×7 | 刪除 describe；「拖曳慣性」「鍵盤轉」「離開畫面停止繪製」改寫到〈中式兵器課程頁〉（宿主改 `[data-sub-items] [data-weapon3d]`） | 同斷言換宿主；切換、出鞘、撐寬屬首頁專有，不遷移 |
| `arsenal.spec.ts` | WebGL 不可用：首頁顯示線稿 | 刪除；「中式兵器課程頁顯示線稿」保留 | 首頁無 WebGL 由 `home-fallback.spec` 驗 |
| `arsenal.spec.ts` | 減少動態：兵器靜態姿勢 | 改寫到課程頁子項 | 不自動轉、拖曳可用、放手停住 |
| `arsenal.spec.ts` | 減少動態：不出刀光、不震 | 刪除（功能移除） | — |
| `arsenal.spec.ts` | 手機 390：首頁兵器台、直向滑過兵器台 | 刪除前者；後者的 `touch-action: pan-y` 斷言改寫到課程頁子項畫布；「課程頁三個子項有 3D」保留 | — |
| `arsenal.spec.ts` | three 的載入時機：首頁首屏不載入 three | 刪除（新前提是首屏載入 three），由 `budget.spec` 取代；「收費頁完全不載入 three」保留 | 見 Task 23 |
| `arsenal.spec.ts` | 中式兵器課程頁 ×3 | 保留 | — |
| `arsenal.spec.ts` | 首頁大人「中式兵器」卡片 | `goto('./courses/')`，斷言不變 | — |
| `arsenal.spec.ts` | 震腳、斬：刀光 ×3、首屏獅子掃光 | 刪除（首頁功能移除） | — |
| `arsenal.spec.ts` | 沒有 JavaScript（兵器線稿） | 只留課程頁部分 | 首頁無 JS 由 `home-fallback.spec` 驗 |
| `arsenal.spec.ts` | 構圖 ×3 裝置 | 刪除「兵器台」；保留「課程頁：每一列完整裝下兵器」 | — |
| `seo.spec.ts`、`links.spec.ts`、`course-page.spec.ts` | 全部 | 不動 | 首頁仍恰有一個 `h1`、所有連結與資源 200、爬得到全部路由 |

---

### Task 1: 工具鏈、基線與外部資料備份

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Modify: `package.json`、`.gitignore`
- 無新測試（設定任務，TDD 豁免；以「基線全綠」與「工具可載入」為驗證）

**Interfaces:**
- Produces: devDependencies `tsx`、`sharp`、`subset-font`、`fflate`；npm scripts `fonts:subset`（`tsx scripts/fonts/cli.ts`）、`qi:snapshot-weapons`（`tsx scripts/qi/snapshot-weapons.ts`）；`.gitignore` 新增 `.cache/`、`src/assets/generated/`。

- [ ] **Step 1: 記錄基線**。依序跑 `npm test`、`npm run check`、`npm run build && npm run build:root`、`npx playwright test --project=subpath`，把各自的通過數寫進 scratchpad 的 `baseline.txt`（不進 repo）。若有任何紅燈：停止並回報「基線不綠」，不要往下做。
- [ ] **Step 2: 備份 repo 外的來源資料**。把 `C:\msys64\tmp\claude\144a7f37daf6744b\e53d62ea-7d72-44e7-8650-a816684225c5\scratchpad\fonts\twkai\TW-Kai.ttf` 與 `…\fonts\chongxi\chongxi_seal.otf` 複製到 `C:\Users\bag57\.cache\liu_yi-fonts\`（repo 外，scratchpad 會被清掉）；把兩者 sha256 記進 `baseline.txt`；`TW-Kai.ttf` 的 sha256 必須是 `9b502e51…bea337`。
- [ ] **Step 3: 安裝相依**。`npm i -D tsx subset-font fflate sharp`（版本取當下最新穩定版，lockfile 一併提交）。確認 `package-lock.json` 仍含 `@img/sharp-linux-x64`（CI 是 ubuntu）。
- [ ] **Step 4: 驗證工具可載入**。`npx tsx -e "import('subset-font').then(()=>console.log('ok'))"` 印出 `ok`；`npx tsx -e "import('sharp').then(()=>console.log('ok'))"` 印出 `ok`。
- [ ] **Step 5: 改 `package.json` scripts 與 `.gitignore`**，再跑 `npm test`、`npm run check` 確認仍綠。
- [ ] **Step 6: Commit** `chore: 加入首頁改版的建置工具鏈`

### Task 2: TW-Kai 來源取得與授權

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `scripts/fonts/source.ts`、`src/assets/fonts/OFL-TW-Kai.txt`
- Test: `tests/unit/fonts-source.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const TWKAI_SOURCE: { zipUrl: string; entry: 'TW-Kai.ttf'; sha256: string; bytes: 36691296; version: '11510.1' }
  export function sha256Hex(data: Uint8Array): string
  export function extractEntry(zip: Uint8Array, entry: string): Uint8Array   // 找不到 → throw Error（訊息含 entry 名）
  export function ensureSourceFont(opts: { cacheDir: string; fetch?: typeof fetch; source?: Pick<typeof TWKAI_SOURCE, 'zipUrl' | 'entry' | 'sha256'> }): Promise<string> // 回 TTF 路徑；source 預設 TWKAI_SOURCE（測試用來注入假的雜湊與網址）
  ```

- [ ] **Step 1: 寫失敗測試** `fonts-source.test.ts`：
  - `sha256Hex(new TextEncoder().encode('abc'))` ＝ `ba7816bf…15ad`。
  - `extractEntry`：用 `fflate.zipSync` 在記憶體建 zip，取出內容逐位元相等；缺 entry 時 `toThrow(/TW-Kai\.ttf/)`。
  - `ensureSourceFont`（fake `fetch` 回傳含假 TTF 的 zip，`source` 參數注入假檔的 `sha256`）：第一次下載並寫入 `cacheDir`；第二次呼叫 `fetch` 次數仍為 1；快取檔被竄改後會刪掉重下；下載內容雜湊不符 → `toThrow(/sha256/)` 且 `cacheDir` 內沒有留下該檔。
  - `src/assets/fonts/OFL-TW-Kai.txt` 存在，含 `SIL OPEN FONT LICENSE Version 1.1` 與 `Ministry of Digital Affairs`。
- [ ] **Step 2: 跑測試確認紅**：`npx vitest run tests/unit/fonts-source.test.ts` → FAIL（模組不存在）。
- [ ] **Step 3: 實作** `source.ts`：用 `fflate` 的 `unzipSync(data, { filter: f => f.name === entry })` 只展開目標檔（zip 約 57 MB，不要展開另外三個字型）；下載寫到暫存檔、驗證通過才 rename 進快取。
- [ ] **Step 4: 寫授權檔**：OFL-1.1 全文（取自 https://openfontlicense.org/open-font-license-official-text/）＋檔頭註明「全字庫正楷體 TW-Kai，版本 11510.1，(c)2026 數位發展部／Ministry of Digital Affairs，選用 OFL-1.1（另一選項為政府資料開放授權條款-第1版），來源 https://data.gov.tw/dataset/5961」。
- [ ] **Step 5: 跑測試確認綠**。
- [ ] **Step 6: 實下載驗證（一次）**：`npx tsx -e "import('./scripts/fonts/source.ts').then(m=>m.ensureSourceFont({cacheDir:'.cache/fonts'})).then(console.log)"`。成功代表 zip 內 `TW-Kai.ttf` 的 sha256 與 Step 2 備份相符。**若不符：停止並回報「文件說 sha256 是 X、實際下載是 Y」**，不要自己改釘值。
- [ ] **Step 7: Commit** `feat(fonts): TW-Kai 來源下載、sha256 驗證與 OFL 授權檔`

### Task 3: 用字掃描與子集化

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `scripts/fonts/charset.ts`、`scripts/fonts/subset.ts`、`scripts/fonts/cli.ts`、`scripts/fonts/fallback-allowed.txt`（空檔）
- Test: `tests/unit/fonts-charset.test.ts`、`tests/unit/fonts-subset.test.ts`

**Interfaces:**
- Consumes: `ensureSourceFont`（Task 2）
- Produces:
  ```ts
  export function charsFromHtml(html: string): Set<string>  // 文字節點（含 <noscript>、不含 <script>/<style>）＋ alt/title/aria-label/placeholder/value；解 entity；略過空白與控制字元
  export function charsFromCss(css: string): Set<string>    // 只取 content: "…" 字串
  export function charsFromJs(js: string): Set<string>      // 只取 U+2E80–9FFF、U+3000–303F、U+FF00–FFEF
  export function scanDist(dir: string): Promise<{ chars: Set<string>; where: Map<string, string[]> }> // where：字 → 出現的檔案
  export function toCharsetText(chars: Set<string>): string // 依碼位排序、無重複
  export function missingChars(used: Set<string>, subset: Set<string>, allowedFallback?: Set<string>): string[]
  export function buildSubset(sourceTtf: Uint8Array, chars: Set<string>): Promise<{ woff2: Uint8Array; notInFont: string[] }>
  ```
  CLI：`npm run fonts:subset [-- --from-dir <dist>]`。流程：`ensureSourceFont` → 若 `src/assets/fonts/twkai-subset.woff2` 不存在，先以 ASCII＋`SITE.name` 產生暫時版 → 以 `TWKAI_GUARD=warn` 跑 `astro build` → `scanDist` → `buildSubset` → 寫 `twkai-subset.woff2` 與 `twkai-subset.chars.txt` → 印出字數、檔案大小、`notInFont`（非空則退出碼 1）。`--from-dir` 略過建置直接掃指定資料夾。

- [ ] **Step 1: 寫失敗測試**（`fonts-charset`）：
  ```ts
  charsFromHtml('<p>六藝 <b>武術</b></p><script>var s="隱藏"</script><img alt="劍"><noscript>無</noscript>')
  // → 恰為 { 六, 藝, 武, 術, 劍, 無 }；不含 隱、藏
  charsFromHtml('<p>A&amp;B&nbsp;·</p>')  // 含 'A','&','B','·'；不含任何空白（含 U+00A0）
  charsFromJs('x="關閉選單",y="abc"') // 恰為 關閉選單 四個字
  charsFromCss('.a::before{content:"・"}.b{color:red}') // { ・ }
  missingChars(new Set([...'六藝劍']), new Set([...'六藝'])) // ['劍']
  missingChars(used, subset, new Set(['劍']))               // []
  toCharsetText(new Set(['b','a','藝']))                     // 'ab藝'
  ```
  `scanDist` 在暫存資料夾放兩個 html、一個 css、一個 js、一個 `.xml`：xml 不被掃；`where` 回正確檔名。
- [ ] **Step 2: 寫失敗測試**（`fonts-subset`，用 `.cache/fonts/TW-Kai.ttf`；檔案不存在時 `it.skipIf`）：`buildSubset(ttf, new Set([...'六藝武術・｜·A1']))` 產出的 woff2 經 `wawoff2`（`subset-font` 的傳遞相依，若 import 失敗就明列為 devDependency）解壓後是 sfnt，表目錄含 `cmap`、`glyf`、`vhea`、`vmtx`；cmap 恰含請求的字；`notInFont` 對 `'\u{1F600}'` 回該字；同輸入兩次輸出逐位元相同（決定性）；輸出 ≤ 40 KB。
- [ ] **Step 3: 紅**：`npx vitest run tests/unit/fonts-charset.test.ts tests/unit/fonts-subset.test.ts` → FAIL。
- [ ] **Step 4: 實作**。`charsFromHtml` 用輕量解析（不新增重型相依）：先移除 `<script>`、`<style>` 與註解，再抽屬性值與文字節點。`buildSubset` 用 `subset-font`（`targetFormat: 'woff2'`），不開 `noLayoutClosure`，以保留 `vert`。
- [ ] **Step 5: 綠**。確認輸出 `skipped 0`（先跑過 Task 2 Step 6 讓快取存在，否則子集化測試被跳過＝沒驗證）。
- [ ] **Step 6: 先不跑 CLI 的真實子集化**（要等 Task 4 把字型接進 Astro 才有意義）。Commit `feat(fonts): 用字掃描與 woff2 子集化`

### Task 4: 全站改用 TW-Kai，建置字型守門

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `integrations/twkai-guard.ts`、`scripts/fonts/guard.ts`、`src/assets/fonts/twkai-subset.woff2`、`src/assets/fonts/twkai-subset.chars.txt`
- Modify: `astro.config.mjs`、`src/layouts/BaseLayout.astro`、`src/styles/tokens.css`、`src/styles/global.css`、`src/styles/ornament.css`、`src/components/{Acts,AudienceCards,CourseCard,Footer,Header}.astro`（只改 `font-weight`）、`src/pages/lab/qi.astro`（移除 Noto 的 `<Font>` 與 `font-weight:700`；Task 22 才整頁刪）
- Test: `tests/unit/fonts-guard.test.ts`、`tests/unit/style-guard.test.ts`、`tests/e2e/fonts.spec.ts`

**Interfaces:**
- Produces: `export function checkDist(opts: { distDir: string; charsetFile: string; allowedFile?: string }): Promise<{ ok: boolean; missing: string[]; pages: Record<string, string[]> }>`；integration 在 `astro:build:done` 呼叫它，`ok === false` 時 throw（訊息含缺字、出現檔案、「請執行 npm run fonts:subset」）；環境變數 `TWKAI_GUARD=warn` 時只印警告。CSS 變數 `--font-twkai`。

- [ ] **Step 1: 寫失敗測試**：
  - `fonts-guard`：暫存 dist 內 html 含 `劍`、charsetFile 只有 `六藝` → `ok:false`、`missing:['劍']`、`pages['劍']` 含該 html；全覆蓋 → `ok:true`；`allowedFile` 含 `劍` → `ok:true`。
  - `style-guard`：掃 `src/**/*.{css,astro}` 的 `font-weight` 宣告，只允許 `400`、`normal`、`inherit`、`unset`（目前會紅）；`global.css` 含 `font-synthesis: none`；`src/` 與 `astro.config.mjs` 內不得出現 `Noto Serif TC`、`noto-serif-tc`。
  - `fonts.spec`（e2e，`/`、`/courses/`、`/pricing/` 各一輪）：`await document.fonts.ready` 後 `[...document.fonts].some(f => /TW-Kai/.test(f.family) && f.status === 'loaded')`；`getComputedStyle(h1).fontFamily` 以 `TW-Kai` 開頭（引號容許）；`getComputedStyle(document.body).fontSynthesis` 含 `none`；全程沒有對 `fonts.gstatic.com`／`fonts.googleapis.com` 的請求；該頁 `font/woff2` 回應恰 1 個、≤ 160 KB。
- [ ] **Step 2: 紅**：`npx vitest run tests/unit/fonts-guard.test.ts tests/unit/style-guard.test.ts` → FAIL。
- [ ] **Step 3: 實作守門與 integration**，把 `astro.config.mjs` 的 `fonts` 換成：
  ```js
  fonts: [{ provider: fontProviders.local(), name: 'TW-Kai', cssVariable: '--font-twkai',
    options: { variants: [{ src: ['./src/assets/fonts/twkai-subset.woff2'], weight: 400, style: 'normal' }] },
    fallbacks: ['Songti TC', 'PMingLiU', 'serif'] }]
  ```
  `BaseLayout` 改 `<Font cssVariable="--font-twkai" preload />`；`tokens.css` 兩個 token 皆指向 `var(--font-twkai), 'Songti TC', 'PMingLiU', serif`（並更新註解）；`global.css` 的 `html` 加 `font-synthesis: none`；掃掉所有 `font-weight: 700`（已知處：`global.css`、`ornament.css`、`Acts`、`AudienceCards`、`CourseCard`、`Footer`、`Header`；以 `style-guard` 測試掃出的清單為準，不要漏）改為 400。
- [ ] **Step 4: 產生第一版子集**：`npm run fonts:subset`（會下載一次原檔、建置、掃描）。結果檔 `twkai-subset.woff2` 與 `.chars.txt` 入庫；`notInFont` 必須為空，否則停止並回報缺字清單（改文案或決定列入 `fallback-allowed.txt` 前要問使用者）。
- [ ] **Step 5: 綠**：`npm test`、`npm run check`、`npm run build && npx playwright test tests/e2e/fonts.spec.ts --project=subpath`。若 Astro 的 `optimizedFallbacks` 對本機 woff2 讀取失敗，改設 `optimizedFallbacks: false` 並在 commit 說明。
- [ ] **Step 6: 截圖檢查**（headless，`/`、`/courses/`、`/pricing/`，390×844 與 1440×900，存到 scratchpad）。合格標準：標題與內文皆為楷體字形（與 `scratchpad\font-specimen\02-twkai.png` 同風格）、無豆腐方塊（`□`）、`h1` 沒有假粗體（筆畫粗細與內文一致）、無水平溢出。把六張圖用 Read 逐張看過再寫進 commit 說明。
- [ ] **Step 7: Commit** `feat(fonts): 全站改用 TW-Kai 子集並加建置守門`

### Task 5: 剪影產線入庫與品管閘門

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `tools/silhouettes/{gen.py,postprocess.py,prompts.json}`、`scripts/qi/silhouette-qa.ts`、`src/assets/silhouettes/provenance.json`、`src/qi/config/silhouettes.ts`
- Test: `tests/unit/silhouette-qa.test.ts`（檢查器本身，用合成影像）、`tests/unit/silhouette-assets.test.ts`（真實素材）

**Interfaces:**
- Produces:
  ```ts
  // scripts/qi/silhouette-qa.ts
  export interface QaResult { ok: boolean; failures: string[] }   // failures 的元素為 'size'|'edge'|'stray'|'haze'|'area'
  export function checkSilhouette(rgba: Uint8Array, width: number, height: number): QaResult
  //   size：寬高皆 ≥ 500；edge：alpha>127 的外框離四邊 ≥ 6 px；stray：最大 8 連通元件 ≥ 遮罩面積 97%；
  //   haze：alpha 在 (8,247) 且離二值邊緣 > 2 px 的像素數 = 0；area：遮罩面積占整張 0.12–0.55
  // src/qi/config/silhouettes.ts（值是 src/assets/silhouettes/ 下的檔名，無副檔名）
  export const SILHOUETTES_READY: string[]    // 已核可：目前為 fig-zhenjiao、fig-zhenjiao-land、fig-dingzhou、fig-chengchui、fig-kao
  export const SILHOUETTES_PLANNED: string[]  // 待生成：fig-salute、fig-kid-wushu、fig-kid-defense-a、fig-kid-defense-b、fig-kid-weapon
  ```
  `provenance.json`：`{ [name]: { model, promptSha256, rawSha256, requests, status: 'approved'|'legacy', qa: {…}, date } }`。

- [ ] **Step 1: 把 scratchpad 的產線搬進 repo**：從 `C:\msys64\tmp\claude\144a7f37daf6744b\e53d62ea-7d72-44e7-8650-a816684225c5\scratchpad\silhouettes-raw\` 複製 `gen.py`、`postprocess.py`、`prompts.json`、`prompts-2.json`（合併進 `tools/silhouettes/prompts.json`）。改動：輸出與 raw 路徑改成參數（預設 scratchpad 的 `silhouettes-raw`）；金鑰仍只從 `%APPDATA%\agent-sprite-forge\config.json` 讀，維持 `scrub()`；總請求上限預設 20。**不要複製 `raw/` 圖檔。**
- [ ] **Step 2: 補既有五張的來源紀錄**：以 scratchpad 的 `qa-meta.json`、`qa-meta-2.json`、`prompts*.json`、`request-count*.json` 寫入 `provenance.json`（`status: 'legacy'`）。
- [ ] **Step 3: 寫失敗測試**：
  - `silhouette-qa`（合成 RGBA）：合格的人形（圓頭＋軀幹＋四肢，1000×1400，邊距 60）→ `ok:true`；貼邊（外框距邊 3 px）→ `failures` 含 `'edge'`；遠處 12 px 的雜點（占 < 3% 但離主體 > 40 px）→ 含 `'stray'`；主體外圍加一圈 alpha=100、寬 5 px 的光暈 → 含 `'haze'`；400×400 → 含 `'size'`；遮罩占 80% → 含 `'area'`；各項互不影響。
  - `silhouette-assets`：對 `SILHOUETTES_READY` 每個名稱：`.png` 與 `.webp` 都存在、`.webp` ≤ 120 000 B；`sharp` 解成 RGBA 後 `checkSilhouette(...).ok === true`；`provenance.json` 有該名稱、`requests ≤ 3`、`status` 為 `approved` 或 `legacy`；`src/assets/silhouettes/` 內沒有檔名含 `rejected`／`tmp`／`-v1` 的檔。
- [ ] **Step 4: 紅**：`npx vitest run tests/unit/silhouette-qa.test.ts` → FAIL（模組不存在）。
- [ ] **Step 5: 實作 `checkSilhouette`**（連通元件與距離計算可參考 `tools/silhouettes/postprocess.py` 的 QA 區段），跑兩支測試。`silhouette-assets` 若對既有五張有任何一項不過，**停止並回報**（不要悄悄重生既有素材）。
- [ ] **Step 6: Commit** `chore(assets): 剪影產線、來源紀錄與機械品管閘門入庫`

### Task 6: 兒童剪影 4 張

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `src/assets/silhouettes/fig-kid-{wushu,defense-a,defense-b,weapon}.{png,webp}`；Modify: `tools/silhouettes/prompts.json`、`provenance.json`、`src/qi/config/silhouettes.ts`（4 個名稱從 `SILHOUETTES_PLANNED` 移到 `SILHOUETTES_READY`）
- Test: `tests/unit/silhouette-assets.test.ts`（Task 5 的閘門）

**Interfaces:**
- Produces: 4 個名稱的 PNG／WebP；姿勢對應：`fig-kid-wushu`＝兒童武術（弓步沖拳）、`fig-kid-defense-a`＝防身格鬥（護架站姿）、`fig-kid-defense-b`＝防身格鬥（閃身推擋）、`fig-kid-weapon`＝防身兵器（持直身雙刃劍的預備式）。

- [ ] **Step 1: 先紅**：把 4 個名稱移進 `SILHOUETTES_READY`，跑 `npx vitest run tests/unit/silhouette-assets.test.ts` → FAIL（缺檔）。
- [ ] **Step 2: 寫提示詞**：沿用 `_common_fig` 的規則（純黑剪影、純白底、無漸層／描邊／文字／地面／陰影、人物與兵器完整在框內且四邊留白、立領盤扣上衣＋束口燈籠褲＋平底布鞋），把人物改成「一位 8–12 歲的華人兒童，頭身比約 1:6，服裝與成人完全一致」，嚴禁日式元素（袴、頭帶、和服、忍者、動漫風）。`fig-kid-weapon` 的提示詞明確寫「直身雙刃劍、雙手持握、劍尖朝右上」，其餘三張「不持任何兵器」。
- [ ] **Step 3: 生成**：`python tools/silhouettes/gen.py gpt-image-1.5 fig-kid-wushu fig-kid-defense-a fig-kid-defense-b fig-kid-weapon`（Python 用 `uv run --no-project --python 3.11`；Windows 的 Store 版 Python 缺套件）。**請求總數 ≤ 12，每張 ≤ 3。** 金鑰不得出現在任何輸出。
- [ ] **Step 4: 後製與機械品管**：`uv run --no-project --python 3.11 --with pillow --with numpy --with scipy tools/silhouettes/postprocess.py`（輸出 PNG／WebP 與 `contact-sheet`，圖放 scratchpad）。
- [ ] **Step 5: 人工品管（自行決定去留，用 Read 看圖）**。每張都要同時滿足：①單一人物、完整在框內；②年齡感為孩童（頭身比約 5.5–6.5 頭身，成人剪影約 7.5）；③服裝與既有成人剪影一致；④無日式元素；⑤姿勢可辨、四肢分離；⑥只有 `fig-kid-weapon` 有兵器；⑦無文字、地面、陰影。不合格者重生（同一張總共 ≤ 3 次，仍不合格就換構圖描述再試一次並在 `provenance.json` 記為第 4 次例外前**先停下回報**）。被淘汰的 raw 留在 scratchpad，**runtime 路徑（`src/assets/`）不得出現任何不合格檔**。
- [ ] **Step 6: 綠**：`npx vitest run tests/unit/silhouette-assets.test.ts`；`provenance.json` 為 4 張寫入 `status:'approved'`、請求數、QA 摘要。
- [ ] **Step 7: Commit** `feat(assets): 兒童剪影四張（兒童武術、防身格鬥×2、防身兵器）`

### Task 7: 「抱拳行禮」通用剪影

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:** Create `src/assets/silhouettes/fig-salute.{png,webp}`；Modify `prompts.json`、`provenance.json`、`silhouettes.ts`（`fig-salute` 從 `SILHOUETTES_PLANNED` 移到 `SILHOUETTES_READY`）；Test `tests/unit/silhouette-assets.test.ts`

**Interfaces:** Produces `fig-salute`（成人，正面略側，雙手抱拳於胸前，微欠身）。

- [ ] **Step 1: 先紅**（同 Task 6 Step 1）。
- [ ] **Step 2: 提示詞**：成人（同 `_common_fig` 的服裝規則）、站姿端正、「左掌包右拳於胸前、雙肘微外展、上身微前傾行抱拳禮」、不持兵器。
- [ ] **Step 3: 生成**（`gen.py … fig-salute`，≤ 3 次；Task 6–7 合計 ≤ 20 次，累計以 `request-count.json` 為準）→ 後製 → 人工品管（①雙手抱拳姿勢可辨、拳與掌的輪廓分得開；②無日式禮儀元素；③其餘同 Task 6 第 ②–⑦ 項的適用部分）。
- [ ] **Step 4: 綠**，寫 `provenance.json`。
- [ ] **Step 5: Commit** `feat(assets): 抱拳行禮通用剪影`

### Task 8: 朱印「六藝」遮罩

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `tools/seal/render-seal.py`、`src/assets/seal/seal-liuyi.png`；Modify `provenance.json`（加 `seal-liuyi`）
- Test: `tests/unit/seal-asset.test.ts`

**Interfaces:**
- Produces: 512×512 灰階 alpha 遮罩（朱文：方框＋右「六」左「藝」，字與框為不透明）。字型路徑是參數：`render-seal.py --font <path> --out src/assets/seal/seal-liuyi.png`。

- [ ] **Step 1: 寫失敗測試** `seal-asset.test.ts`：PNG 存在且為 512×512；無半透明霧（alpha 只在邊緣 2 px 內為中間值）；外框存在：距四邊 8–14 px 的環上不透明比例 ≥ 95%；內部恰有 2 個以上的大連通元件（面積各 ≥ 1 500 px），其中最大兩個的質心 x 分別落在寬度的 0.25±0.12 與 0.75±0.12，且質心 y 在 0.5±0.15；墨量占 0.25–0.55；**repo 內沒有 `*.otf`、`*.ttf`、含 `chongxi` 的檔案**（用 `fs` 遞迴掃專案根，略過 `node_modules`、`.cache`、`dist*`、`.git`、`.astro`）。
- [ ] **Step 2: 紅**。
- [ ] **Step 3: 實作** `render-seal.py`（`uv run --no-project --python 3.11 --with pillow`）：用 PIL 以崇羲篆體畫「六」「藝」（先確認兩字都在該字型的 cmap；缺字則停止並回報），畫外框，閾值化成二值 alpha 後輸出。字型位置：`C:\Users\bag57\.cache\liu_yi-fonts\chongxi_seal.otf`（Task 1 備份）；若不存在，停止並回報。
- [ ] **Step 4: 綠**；**人工品管（Read 看圖）**：兩字筆畫完整、是篆書形體（不是楷書）、外框完整、字與框之間有留白。不合格就調字級、字距、框粗重畫（純本機運算，無請求成本）。
- [ ] **Step 5: Commit** `feat(assets): 朱印「六藝」篆字遮罩（字型檔不入庫）`

### Task 9: 形體格式、人形取樣與比例設定檔

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `src/qi/shapes/{format,head,sample-figure}.ts`、`src/qi/config/figures.ts`
- Test: `tests/unit/qi-shape-format.test.ts`、`tests/unit/qi-figure-sampler.test.ts`、`tests/unit/qi-figures-config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // format.ts
  export const SHAPE_COUNT = 16384
  export const KIND = { STEEL: 100, BRASS: 101, RED: 102, DARK: 103, AURA: 104, SEAL: 105 } as const // 0–99＝人形「靠近輪廓的程度」
  export interface Shape { count: number; positions: Float32Array /*xyz*/; kinds: Uint8Array; min: [number, number, number]; max: [number, number, number] }
  export function encodeShape(s: Shape): Uint8Array      // 40 B header：魔數 'QSH1'、u16 版本=1、u16 flags、u32 count、f32×3 min、f32×3 max、u32 保留；其後 u16 x[]、y[]、z[]（依 min/max 量化）、u8 kinds[]
  export function decodeShape(b: Uint8Array): Shape      // 魔數／版本／長度不符 → throw
  export function kindToW(kind: number): number          // 0–99 → kind/99；STEEL..AURA → 2..6；SEAL → 7
  // head.ts
  export function measureHeadHeight(alpha: Uint8Array, w: number, h: number): number // 由上而下的列寬輪廓：第一個局部最大（頭）之後的第一個局部最小（頸）之前的高度（px）
  // figures.ts
  export interface FigureDef { id: string; src: string /* silhouettes/ 下的檔名，無副檔名 */; headPx: number; scaleOverride?: number; audience: 'adult' | 'kid' | 'both' }
  export const FIGURES: Record<string, FigureDef>  // 鍵＝形體 id：lift（src fig-zhenjiao）、land（fig-zhenjiao-land）、dingzhou、chengchui、kao、salute、kid-wushu、kid-defense-a、kid-defense-b、kid-weapon（src 為對應的 fig-*）
  export const WORLD_UNIT_PER_LAND_PX: number  // 2/1161，搬自試作 WORLD_HEIGHT/REFERENCE_PX
  export function figureScale(def: FigureDef, land: FigureDef): number // scaleOverride ?? land.headPx / def.headPx
  // sample-figure.ts
  export function sampleFigure(img: { alpha: Uint8Array; width: number; height: number }, scale: number, opts: { count: number; seed: number }): Shape
  ```
  取樣規則搬自試作 `sampleFigure`：網格 0.32、距離場 chamfer 3-4、22% 取自輪廓帶（距離 < 1.7 格）、腳底外框底對齊 y=0、外框中線對齊 x=0、厚度 `0.27·√min(depth/0.24,1)+0.025` 加雜訊。環境煙**不**進檔。

- [ ] **Step 1: 寫失敗測試**：
  - `qi-shape-format`：往返誤差 ≤ (max−min)/65535 + 1e-6；`byteLength === 40 + 7 * 16384`；壞魔數／版本 2／截短資料各自 `toThrow`；`kindToW(50)≈0.505`、`kindToW(KIND.RED)===4`、`kindToW(KIND.SEAL)===7`。
  - `qi-figure-sampler`（合成遮罩：矩形軀幹＋圓頭＋細頸，兩種尺寸各一）：`min y` 的 0.5 百分位 < 0.02 且 ≥ −1e-6（腳底在 0）；`(min.x+max.x)/2` 的絕對值 < 0.02；兩種尺寸的遮罩若 `headPx` 對應不同，套用 `figureScale` 後世界頭高相差 ≤ 3%；z 厚度絕對值 ≤ 0.30；kind 為 0–99；輪廓帶占比 ≈ 22%±3%；同 seed 逐位元相同；`measureHeadHeight` 對合成遮罩回傳值在真值 ±10% 內。
  - `qi-figures-config`：`SILHOUETTES_READY` 的每個檔名都恰被一個 `FIGURES[*].src` 使用（此時 READY 已含全部十張）；`scaleOverride` 依序為 `lift:1.02、land:1、dingzhou:1.25、chengchui:1.18、kao:1.12`（`lift` 的 src 是 `fig-zhenjiao`，`land` 是 `fig-zhenjiao-land`）；對真實剪影（`sharp` 解碼）`measureHeadHeight` 與設定的 `headPx` 相差 ≤ 12%；五個舊值與 `land.headPx / def.headPx` 相差 ≤ 15%（證明搬入的值與頭部對齊一致）；每個非 override 的圖，取樣後世界身高在 1.1–2.6、腳底 y ∈ [0, 0.03]。
- [ ] **Step 2: 紅**。
- [ ] **Step 3: 實作**。`headPx` 的真值由執行者以 `measureHeadHeight` 量出並四捨五入寫入 `figures.ts`；量不準的圖（例如 `dingzhou` 頭部前傾）可手填並在註解寫明依據。
- [ ] **Step 4: 綠**，Commit `feat(qi): 形體二進位格式、人形取樣與頭部對齊比例設定`

### Task 10: 兵器幾何快照與取樣

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `scripts/qi/snapshot-weapons.ts`、`src/qi/shapes/{weapon-snapshot,sample-weapon}.ts`、`src/qi/data/weapons/{jian,miaodao,spear}.geo`
- Test: `tests/unit/qi-weapon-snapshot.test.ts`、`tests/unit/qi-weapon-sampler.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface WeaponPart { cls: 2 | 3 | 4 | 5; positions: Float32Array; indices: Uint32Array } // 2 鋼 3 銅 4 紅纓 5 暗色（柄、桿）；座標沿用 weapons.ts 原座標（長軸 +Y，公尺）
  export interface WeaponSnapshot { name: 'jian' | 'miaodao' | 'spear'; tip: number; butt: number; parts: WeaponPart[] }
  export function encodeSnapshot(s: WeaponSnapshot): Uint8Array   // 檔頭含 weapons.ts 的 git hash-object
  export function decodeSnapshot(b: Uint8Array): WeaponSnapshot
  export function sampleWeapon(s: WeaponSnapshot, opts: { count: number; seed: number }): Shape // 長軸 +x、鋒尖朝 +x、置中、全長 1
  ```
  取樣規則搬自試作：表面占 30%（其餘為貼著兵器的氣，kind=AURA，延伸 0.03–0.35/長度比例縮放）、面積權重取 0.6 次方、鋼 ×1.8、暗色 ×1.4；**補強**：纓穗（cls 4）權重由 0.5 提到 1.6 並保證至少占全部點的 3.5%；桿身（cls 5）每個表面點加半徑 0.010（單位長度內）的垂直軸向散布，讓桿看起來有粗細。劍鞘不取樣。

- [ ] **Step 1: 寫失敗測試**：
  - `qi-weapon-snapshot`：往返逐頂點誤差 ≤ 量化步長；三個 `.geo` 都存在且單檔 ≤ 260 KB、合計 ≤ 600 KB；三件 `parts` 非空、`tip > butt`。
  - `qi-weapon-sampler`（以真快照）：N = 16 384、決定性；非 AURA 點的 x 範圍 `max−min` ＝ 1 ± 0.005 且置中；`kinds` 只含 `{2,3,4,5,6}` 對應的 `KIND`；**大槍**：紅（`KIND.RED`）≥ 3.5%、暗色（`KIND.DARK`）≥ 10%、暗色點到長軸距離的 p95 ∈ [0.005, 0.012]（單位長度）；AURA ≤ 72%；**劍**：鋼點占表面點 ≥ 40%。
- [ ] **Step 2: 紅**。
- [ ] **Step 3: 實作快照腳本**：用 `tsx` 載入 `src/scripts/three/weapons.ts` 的 `buildJian`／`buildMiaodao`／`buildSpear`（Node 可直接跑，已驗證無 DOM 相依），材質用只帶 `userData.cls` 的空殼（搬自試作 `taggedMaterials`），遍歷 mesh 輸出頂點與索引（量化成 int16、索引 u16／u32）。執行 `npm run qi:snapshot-weapons`，三個 `.geo` 入庫。
- [ ] **Step 4: 實作 `sampleWeapon`**，綠。
- [ ] **Step 5: Commit** `feat(qi): 兵器幾何快照與取樣（加粗槍桿、補強紅纓）`

### Task 11: 合成形體、形體產線與 Astro integration

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `src/qi/config/shapes.ts`、`scripts/qi/{build-shapes,hash}.ts`、`integrations/qi-assets.ts`
- Modify: `astro.config.mjs`（註冊 `qi-assets`）
- Test: `tests/unit/qi-build-shapes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ShapeRecipe =
    | { kind: 'figure'; figure: string }
    | { kind: 'weapon'; name: 'jian' | 'miaodao' | 'spear' }
    | { kind: 'seal' }
    | { kind: 'compose'; parts: { figure: string; scale: number; x: number }[] }
  export const SHAPES: Record<string, ShapeRecipe>   // 鍵＝形體 id：lift land dingzhou chengchui kao jian miaodao spear salute seal others kid-wushu kid-defense-a kid-defense-b kid-weapon
  export function buildAllShapes(opts: { root: string; outDir: string; force?: boolean }): Promise<{ built: string[]; skipped: boolean }>
  ```
  `others`＝四個小人形（`land`、`dingzhou`、`chengchui`、`kao`）縮成 0.38、橫排，總寬 ≥ 2.5 倍高；`seal`＝遮罩取樣（kind=SEAL，深度很薄）；`outDir` 內每個形體一個 `<id>.bin`，另寫 `shapes.json`（`{id, bytes, sha256}`）與 `.inputs-hash`。

- [ ] **Step 1: 寫失敗測試**：對暫存 `outDir` 建置後，每個 id 都有 `.bin` 且大小恰為 `40 + 7 * 16384`；全部可 `decodeShape`、座標皆有限；`others` 的 `(max.x-min.x) / (max.y-min.y) ≥ 2.5`；`seal` 的寬高比在 0.8–1.25；第二次呼叫 `skipped === true` 且不重寫檔；暫存複製的某張剪影改一個像素後 `skipped === false` 且只有受影響的 id 檔案內容變；`SHAPES` 的鍵與 `FIGURES`、weapon 名單一致；全部 `.bin` 合計 ≤ 1.9 MB。
- [ ] **Step 2: 紅**。
- [ ] **Step 3: 實作** `buildAllShapes`：輸入雜湊 = 剪影 PNG、`seal-liuyi.png`、三個 `.geo`、`config/{figures,shapes}.ts`、`shapes/*.ts` 原始碼與格式版本。`qi-assets.ts` 在 `astro:config:setup` 呼叫它（輸出到 `src/assets/generated/qi/shapes/`）；不改動 dev watch。
- [ ] **Step 4: 綠**；再跑 `npm run build` 確認產出資料夾與 `shapes.json` 存在，`npm run check` 通過。
- [ ] **Step 5: Commit** `feat(qi): 形體配方、建置時產出 .bin 與 Astro integration`

### Task 12: 靜態圖產生

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `scripts/qi/render-stills.ts`
- Modify: `integrations/qi-assets.ts`（接上靜態圖，輸出 `src/assets/generated/qi/stills/*.webp` 與 `stills.json`）
- Test: `tests/unit/qi-stills.test.ts`

**Interfaces:**
- Consumes: `Shape`（Task 9）、`SHAPES`（Task 11）
- Produces:
  ```ts
  export function renderStill(shape: Shape, opts: { width: number; height: number; seed: number; glow?: number }): Promise<Uint8Array> // WebP；Float32 加色高斯點＋sharp 模糊疊加＋色調映射；顏色用金／米白／朱紅（同引擎）
  export function renderAllStills(opts: { shapesDir: string; outDir: string }): Promise<void>
  ```
  輸出：`hero-wide.webp`（1440×810）、`hero-tall.webp`（780×1280）皆由 `land` 形體產生；每個有形體的姿勢各一張 `<id>.webp`（1000×750）；`stills.json`：`{ [name]: { width, height, bytes } }`。

- [ ] **Step 1: 寫失敗測試**：合成圓盤形體 → 輸出可被 `sharp` 解成指定尺寸的 WebP；平均亮度在 3–60 之間（暗底）；亮點（L > 120）占 0.5%–12%；亮點質心落在影像中央 ±10%；同輸入逐位元相同；`renderAllStills` 對真資料：`hero-wide.webp` 與 `hero-tall.webp` ≤ 60 KB、其餘每張 ≤ 45 KB（超過即失敗，由執行者調 quality／點徑，不放寬門檻）。
- [ ] **Step 2: 紅**，**Step 3: 實作**，**Step 4: 綠**。
- [ ] **Step 5: 視覺檢查**（headless）：把 `hero-wide`、`hero-tall` 與 `dingzhou`、`spear`、`seal`、`kid-wushu` 的靜態圖用 Read 看過。合格標準：人形或兵器清晰可辨；人形外框高度占影像 ≥ 60%（hero-wide 為 ≥ 70%）；金色為主、略帶米白，**不得有滿版外發光**；`spear` 紅纓明顯可見；`seal` 的「六藝」可辨讀。
- [ ] **Step 6: Commit** `feat(qi): 建置時產生聚合姿勢的靜態 WebP`

### Task 13: 引擎純邏輯（姿勢、捲動模型、降級、開場、視窗）

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `src/qi/config/poses.ts`、`src/qi/engine/{scroll-model,tiers,intro,viewport,forces}.ts`
- Test: `tests/unit/qi-poses.test.ts`、`qi-scroll-model.test.ts`、`qi-tiers.test.ts`、`qi-intro.test.ts`、`qi-viewport.test.ts`、`qi-forces.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // poses.ts
  export type Audience = 'adult' | 'kid'
  export type BeatId = 'opening'|'fist'|'combat-a'|'combat-b'|'weapon-a'|'weapon-b'|'weapon-c'|'others'|'coaches'|'pricing'|'booking'
  export type PoseId = 'lift'|'land'|'dingzhou'|'chengchui'|'kao'|'jian'|'miaodao'|'spear'|'others'|'salute'|'flow'|'seal'|'kid-wushu'|'kid-defense-a'|'kid-defense-b'|'kid-weapon'
  export const BEATS: readonly BeatId[]   // 依序即上面順序
  export const POSE_BY_BEAT: Record<Audience, Record<BeatId, PoseId>>
  //   adult: opening→land fist→dingzhou combat-a→chengchui combat-b→kao weapon-a→jian weapon-b→miaodao weapon-c→spear others→others coaches→salute pricing→flow booking→seal
  //   kid：fist→kid-wushu combat-a→kid-defense-a combat-b→kid-defense-b weapon-a→kid-weapon，其餘同 adult
  export interface Burst { dir: [number, number, number]; power: number; mode: 0 | 1 | 2 | 3; hold?: number } // mode 3＝向內收（朱印）
  export const BURSTS: Record<PoseId, Burst> // 試作 STEPS 的值：dingzhou [1,.15,.1]/3.2/0、chengchui [1,.1,0]/3.0/1、kao [1,.35,.15]/3.4/0、jian [1,.25,0]/3.0/0、miaodao [.6,-.8,0]/3.2/0、spear [1,0,0]/3.6/0、land [0,-1,0]/2.2/2、lift [0,1,0]/1.8/2 hold .5；新姿勢 others/salute 用 mode 2 power 1.4–1.8、flow [1,0,0]/1.0/0、seal [0,-1,0]/2.0/3、kid-* 沿用 chengchui 的 mode 1/power 3.0
  export function poseFor(beat: BeatId, audience: Audience): PoseId
  // scroll-model.ts
  export interface BeatRect { id: BeatId; top: number; height: number }
  export interface ScrollState { index: number; from: number; to: number; mix: number; scatter: number; settled: boolean }
  export const BAND = 0.45
  export function scrollState(beats: readonly BeatRect[], scrollY: number, viewportH: number): ScrollState // 高度 ≤ 0 的 beat 先濾掉
  // tiers.ts
  export type TierId = 'high' | 'mid' | 'low' | 'min'
  export const TIERS: Record<TierId, { side: number; count: number; glow: boolean }>
  export function initialTier(env: { touch: boolean; width: number; override?: string | null }): TierId
  export function createGovernor(opts: { start: TierId; floorFps?: number /*40*/; windowMs?: number /*1000*/; strikes?: number /*2*/; graceMs?: number /*2000*/; cooldownMs?: number /*3000*/ }): { frame(nowMs: number): TierId | null; tier(): TierId }
  // intro.ts
  export type IntroPhase = 'handoff' | 'exhale' | 'inhale' | 'hold' | 'land' | 'done'
  export function introState(t: number): { phase: IntroPhase; springScale: number; groundLevel: number; target: 'land' | 'lift'; inhale: number }
  //   springScale：handoff 1、exhale 0.1、inhale 0.1+0.9·smoothstep(1.0,2.0,t)、其後 1；groundLevel 恆為 1（接續靜態圖的終態）；
  //   target：1.0 ≤ t < 2.7 為 'lift'，其餘 'land'；inhale：僅在 inhale 階段由 0 升到 1，其餘 0
  export function shouldPlayIntro(env: { reducedMotion: boolean; seen: boolean; scrollY: number; viewportH: number }): boolean
  // viewport.ts
  export function viewportChanged(prev: { w: number; h: number }, next: { w: number; h: number }): boolean // 寬度不同，或高度差 > 18%（網址列伸縮約 5–12%）才算
  // forces.ts（搬自試作 frame()）
  export const SPRING = 26
  export function forcesFor(i: { scatter: number; scrollSpeed: number; sinceBurst: number; burstHold: number; snap: boolean; intro?: { springScale: number } }): { spring: number; curl: number; damp: number }
  export function switchScatter(sinceSwitchMs: number): number   // 切換大人／小孩時的散開量：max(0, 1 − t/900)；有效 scatter = max(scrollScatter, switchScatter)
  ```
  開場時刻：`handoff` 0–0.6、`exhale` 0.6–1.0、`inhale` 1.0–2.0（target `lift`）、`hold` 2.0–2.7、`land` 2.7–3.4（落地於 2.7 觸發）、之後 `done`。

- [ ] **Step 1: 寫失敗測試**（數值為決定值）：
  - `scrollState`（三個 beat，各 `top = 0/1000/2000`、`height = 1000`，`viewportH = 1000`，focus = `scrollY + 500`，帶半寬 225）：`scrollY=0` → `{index:0, from:0, to:0, scatter:0, settled:true}`；`scrollY=500`（focus 1000）→ `mix=0.5`、`scatter=1`、`index=1`；`scrollY=300`（focus 800）→ `from 0, to 1`、`scatter≈sin(π·0.0556)=0.174`；`scrollY=270`（focus 770）→ `settled:true`；`scrollY=2500`、`scrollY=-200` → `index` 分別 2、0 且 `settled`；`beats=[]` → `{index:0, settled:true, scatter:0}`（RF4）；含一個 `height:0` 的 beat 時它被略過、索引仍指向有高度的 beat；高度不等（1000／1500）時轉場帶位置跟著邊界走。
  - `initialTier`：`{touch:false,width:1440}` → `high`；`{touch:true,width:1440}` → `low`；`{touch:false,width:800}` → `low`；`override:'mid'` → `mid`；`override:'bogus'` → 忽略；`TIERS.high.count===65536`、`TIERS.low.count===20736`、`TIERS.min.side===112`、`high.glow===true`、`low.glow===false`。
  - `createGovernor`（餵 `frame(now)`）：以 16.7 ms 間隔餵 6 秒 → 一直回 `null`；以 40 ms（25 fps）餵 → 在暖機 2000 ms 後、第二個低於 40 fps 的 1 秒視窗結束時回 `'mid'`，之後 3000 ms 內不再降；持續低 fps 依序降到 `min` 後永遠 `null`；單格間隔 > 1000 ms（分頁被切走）會重置視窗，不算一次低 fps。
  - `introState`／`shouldPlayIntro`：`t=0.3 → handoff`、`0.8 → exhale`、`1.5 → inhale`、`2.3 → hold`、`2.9 → land`、`3.5 → done`；`introState(0.3).springScale===1`、`introState(0.8).springScale < 0.2`、`introState(1.5).target==='lift'`、`introState(2.9).target==='land'`、`introState(1.5).inhale` 在 (0,1)、`introState(0.3).inhale===0`；`shouldPlayIntro({reducedMotion:false, seen:false, scrollY:0, viewportH:900})===true`；`seen:true`、`reducedMotion:true`、`scrollY > 0.25*viewportH` 各自回 `false`。
  - `viewportChanged`（RF1）：`{390,844}→{390,760}`（−10%）→ `false`；`→{390,640}`（−24%）→ `true`；寬度不同 → `true`；轉向 `{390,844}→{844,390}` → `true`。
  - `forcesFor`：`scatter=1` 時 `spring ≈ SPRING·(1−0.82) = 4.68`、`curl ≈ 0.32+1.3`；`scatter=0, scrollSpeed=3` → `curl ≈ 0.32+3·0.35`；`snap:true` → `spring` 乘 2.2；`sinceBurst=0, burstHold=1` → `spring` 為基準的 0.1 倍；`switchScatter(0)===1`、`switchScatter(450)===0.5`、`switchScatter(900)===0`、`switchScatter(2000)===0`。
  - `qi-poses`：`BEATS` 恰 11 個；兩個 audience 的 `POSE_BY_BEAT` 涵蓋全部 beat；每個出現的 `PoseId` 都有 `SHAPES` 配方（`flow` 例外：無配方、程序化）；`BURSTS` 涵蓋全部 `PoseId`。
- [ ] **Step 2: 紅**，**Step 3: 實作**（常數與公式搬自試作 `main.ts` 的 `frame()`／`STEPS`），**Step 4: 綠**。
- [ ] **Step 5: Commit** `feat(qi): 姿勢對應、捲動模型、降級調速器、開場時間軸與視窗判斷`

### Task 14: 目標貼圖展開與形體載入器

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `src/qi/shapes/{expand,loader,urls}.ts`
- Test: `tests/unit/qi-expand.test.ts`、`tests/unit/qi-loader.test.ts`

**Interfaces:**
- Consumes: `Shape`、`kindToW`（Task 9）；`BeatId`、`PoseId`、`Audience`、`BEATS`、`POSE_BY_BEAT`（Task 13）
- Produces:
  ```ts
  export interface AmbientField { mask: Uint8Array; positions: Float32Array }
  export function ambientField(count: number, seed?: number /*7*/): AmbientField   // 占 7%，所有姿勢共用
  export interface Layout { scale: number; rotZ: number; offset: [number, number, number] }
  export function weaponLayout(name: 'jian'|'miaodao'|'spear', wide: boolean): Layout // 寬：2.9/.16、3.2/.22、3.8/.05；窄：1.9/.5、2.1/.55、2.3/.45；中點高度 1.05
  export function expandTargets(shape: Shape, size: number, ambient: AmbientField, layout?: Layout): Float32Array // size*size*4，w＝kindToW，環境煙 w＝−1
  export function flowTargets(size: number, ambient: AmbientField): Float32Array   // 全部點為緩流（w＝−1），範圍比環境煙大
  export interface ShapeLoader { load(id: string): Promise<Shape>; prefetch(ids: readonly string[]): void; has(id: string): boolean }
  export function createShapeLoader(opts: { fetch: (url: string) => Promise<ArrayBuffer>; resolveUrl: (id: string) => string }): ShapeLoader
  export function prefetchPlan(beatIndex: number, audience: Audience, introPending: boolean): string[] // 目前＋前後各 2 個 beat 的形體 id（去重、不含 flow）；introPending 時只含 land、lift
  // urls.ts（只在瀏覽器建置用）：import.meta.glob('../../assets/generated/qi/shapes/*.bin', { query: '?url', import: 'default', eager: true }) → resolveShapeUrl(id)
  ```

- [ ] **Step 1: 寫失敗測試**：
  - `ambientField(65536)`：`mask` 中 1 的比例 0.07±0.005；同 seed 逐位元相同；不同姿勢的 `expandTargets` 在環境煙索引上的位置完全相同。
  - `expandTargets(shape, 112, …)`（12 544 格 ≤ N）：非環境煙的第 j 個點座標等於 `shape` 第 j 個取樣（前綴性質，無抖動）；`size=256`：第 `N+k` 個與第 k 個距離 ≤ 0.006√3；輸出長度 `size*size*4`；環境煙格 `w === -1`，人形格 `0 ≤ w ≤ 1`。
  - `weaponLayout('spear', true)` 套用後鋒尖 x ≈ `3.8/2·cos(0.05)`、高度中點 1.05；`wide:false` 用窄版數值。
  - 載入器：同時 `load('land')` 兩次 `fetch` 只呼叫一次；回傳資料壞魔數 → `load` reject 且不快取（下次重試）；網路失敗重試 1 次後 reject；`prefetchPlan(0,'adult',true)` 為 `['land','lift']`；`prefetchPlan(0,'adult',false)`（視窗＝beat 0–2）恰為 `land`、`dingzhou`、`chengchui`；`prefetchPlan(9,'kid',false)`（beat 7–10）含 `others`、`salute`、`seal` 且不含 `flow`；`prefetchPlan(1,'kid',false)` 含 `land`、`kid-wushu`、`kid-defense-a`、`kid-defense-b`。
- [ ] **Step 2: 紅**，**Step 3: 實作**，**Step 4: 綠**。
- [ ] **Step 5: Commit** `feat(qi): 目標貼圖展開、環境煙與形體載入器`

### Task 15: GPGPU 模擬與渲染核心（含 harness 頁）

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `src/qi/engine/shaders/{noise,velocity,position,points,ground,glow}.ts`、`src/qi/engine/{sim,glow,pointer,stage}.ts`、`src/qi/engine/qi-stage.ts`、`src/pages/lab/qi-harness.astro`
- Test: `tests/e2e/qi-engine.spec.ts`

**Interfaces:**
- Consumes: `forcesFor`、`BURSTS`、`TIERS`、`ShapeLoader`、`expandTargets`、`ambientField`、`flowTargets`、`weaponLayout`
- Produces:
  ```ts
  export interface QiStageOptions { canvas: HTMLCanvasElement; tier: TierId; loader: ShapeLoader; reducedMotion: boolean }
  export interface QiStage {
    setPose(pose: PoseId, opts?: { burst?: boolean }): Promise<void>   // 預設 burst:true
    setScatter(v: number): void; setScrollSpeed(v: number): void
    pulse(strength?: number): void
    resize(w: number, h: number): void       // 只動相機與 render target，不重建模擬
    setTier(t: TierId): Promise<void>        // 重建 GPGPU
    dispose(): void
    readonly debug?: {   // 只在 ?qi-debug=1 時存在
      snapshot(region?: Box): { width: number; height: number; covered: number; bright: number; red: number } // red＝R>150、G<90、B<90 的像素數
      meanError(): number                                  // GPU 讀回：非環境煙點到目標的平均距離
      speedNear(x: number, y: number, r: number): number   // 螢幕座標半徑 r px 內的平均速率
      radialVelocity(): number                             // 平均「往中心」的速度分量（正＝往內）
      uniforms(): Record<string, number>                   // 例如 uStreak
      pulseCount(): number; simGeneration(): number; tier(): TierId
      feedFrameTime(ms: number): void                      // 以內部虛擬時間餵調速器（不依賴 rAF），Task 17 接線
    }
  }
  export interface Box { x: number; y: number; w: number; h: number }
  export function mountQiStage(o: QiStageOptions): Promise<QiStage>   // qi-stage.ts 的唯一 export（動態 import 的入口）
  ```
  移植自試作並拆檔：速度／位置著色器（彈簧、curl noise、掌風、換招衝量，新增 `uImpulseMode = 3` 向內收）、點與地面著色器、`GPUComputationRenderer` 初始化、掌風指標投影（`pointer.ts`）。光暈：`glow.ts` 自寫（場景畫到半解析度 `HalfFloatType` RT → 1/4 解析度可分離 9-tap 模糊 → 疊加＋ACES 色調映射），`tier.glow === false` 時直接畫到螢幕。`window.__qi`、`html[data-qi-*]` 屬性（`ready`、`mode`、`tier`）由 Task 19 接線，這裡只提供 `debug`。

- [ ] **Step 1: 寫 harness 頁**（網址 `./lab/qi-harness/`，`noindex`，只含全螢幕 canvas 與一支腳本：解析 `?qi-tier`、`?qi-debug`，用 `createShapeLoader({ fetch, resolveUrl: resolveShapeUrl })` 建載入器，動態 import `qi-stage` 並 `mountQiStage`，把 stage 放到 `window.__qiStage`）。**Step 2: 寫失敗 e2e**（`?qi-tier=min&qi-debug=1`，`page.clock.install` → 載入 → `pauseAt` → `runFor`）：
  1. `setPose('land')` 推進 3 s：`debug.snapshot()` 的 `covered ≥ 0.01`、`bright ≥ 0.0005`；`debug.meanError() < 0.05`。
  2. `setPose('dingzhou')`（burst）：推進 300 ms 後 `meanError > 0.3`（炸開）；再推進 3 s 後 `< 0.05`（聚合）。
  3. 掌風：`page.mouse.move` 快速劃過人形（8 步，每步 `clock.runFor(16)`）→ `debug.speedNear(x,y,80) > 3 ×` 劃過前的基線。
  4. `resize` 呼叫 5 次 → `debug.simGeneration()` 不變；`setTier('min')`→`setTier('min')` 後遞增。
  5. 全程 `pageerror` 與 `console.error` 為 0。
- [ ] **Step 3: 紅**（模組不存在）。**Step 4: 實作**。移植時保留試作常數（`SPRING=26`、彈簧 per-particle 係數 0.45–1.5、curl `e=0.1`、`uHandR=0.5` 等），常數集中在 `forces.ts`／各 shader 檔頂端。
- [ ] **Step 5: 綠**：`npm run build && npx playwright test tests/e2e/qi-engine.spec.ts --project=subpath`。
- [ ] **Step 6: Commit** `feat(qi): GPGPU 光點引擎核心（模擬、掌風、換招衝量、自寫光暈）與 harness`

### Task 16: 試作四項補強與開場演出

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Modify: `src/qi/engine/shaders/{points,ground,velocity}.ts`、`src/qi/engine/stage.ts`
- Create: `src/qi/engine/effects.ts`
- Test: `tests/unit/qi-effects.test.ts`、`tests/e2e/qi-effects.spec.ts`

**Interfaces:**
- Produces（`effects.ts`，純函式，供著色器參數與測試共用）：
  ```ts
  export function shockwave(t: number): { radius: number; width: number; amp: number; flash: number }
  //   第一圈 radius = 0.25 + 3.6t − 0.35t²、width = 0.12 + 0.2t、amp = 3.5·e^(−1.5t)；第二圈延後 0.12 s、amp ×0.6；flash = 0.6·e^(−6t)；t<0 → amp 0
  export function streakLength(speed: number): number   // 1 + clamp(speed·0.25, 0, 1)·2.6（沿速度方向拉長的倍數）
  export function inhaleAcc(p: [number, number, number], t: number): [number, number, number] // 往中心的加速度（含少量旋轉），|p| 越遠越強；t 為吸氣進度 0–1
  export interface QiStage { playLanding(): void; playIntro(opts?: { skip?: boolean }): void }
  ```
  補強四點：①換招拖尾（點精靈在片段著色器內依 `vDir` 拉成橢圓，`uStreak` 隨速度）；②落地衝擊波（雙圈＋白閃＋鏡頭震幅 0.05→0.08，時序取自 `shockwave`）；③開場吸氣流線（速度著色器 `inhaleAcc`，強度隨 `introState().inhale`，並讓點沿流向拉長）；④大槍桿與紅纓（資料已在 Task 10；著色器端 `kind=RED` 用 `uSeal·1.4`、`kind=DARK` 用 `uGold·0.85`，點徑加大 15%）。

- [ ] **Step 1: 寫失敗測試**：
  - `qi-effects`：`shockwave(0)` 的 `amp===3.5`、`radius===0.25`；`shockwave(0.5).radius ≈ 1.9625`（0.25+1.8−0.0875）；`amp` 隨 t 單調遞減；`shockwave(-1).amp===0`；`streakLength(0)===1`、`streakLength(4)===3.6`、單調；`inhaleAcc([2,0,0],0.5)` 的 x 分量 < 0、`inhaleAcc([0,0,0],0.5)` 為有限且接近零。
  - `qi-effects.spec`（harness，`qi-tier=min&qi-debug=1`）：①吸氣：`playIntro()` 後 `clock.runFor` 到 1.2–1.8 s，`debug.radialVelocity()`（往中心為正）平均 > 0.5；②落地：`playLanding()` 後 `debug.snapshot({環帶區域})` 在 t=0.4 s 的 `bright` ≥ t=0 基線的 2.5 倍；鏡頭震幅在 0.8 s 內回到 0；③大槍：`setPose('spear')` 聚合後 `debug.snapshot().red ≥ 150`，且槍桿中段縱向亮寬 ≥ 5 px（1440×900）；④拖尾：`setPose` 的 burst 峰值時 `debug.uniforms().uStreak > 1.5`。
- [ ] **Step 2: 紅**，**Step 3: 實作**，**Step 4: 綠**。
- [ ] **Step 5: 截圖檢查**（1440×900 與 390×844；落地前、落地後 0.2／0.5 s、burst 峰值、吸氣中、大槍聚合）。合格標準：①落地環在 0.5 s 時半徑涵蓋人形腳寬的 2 倍以上且不蓋住整個畫面；②burst 峰值時可見朝出招方向的線狀拖尾（不是圓點雲）；③大槍的紅纓為紅色（不是金色）、桿身肉眼可見有粗細；④全程不出現「滿版外發光」或彩色特效（只有金／米白／朱紅）。
- [ ] **Step 6: Commit** `feat(qi): 拖尾、落地衝擊波、吸氣流線、大槍桿與紅纓`

### Task 17: 依 fps 自動降級接線

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:** Modify `src/qi/engine/stage.ts`、`qi-stage.ts`；Test `tests/e2e/qi-engine.spec.ts`（新增 describe）

**Interfaces:** Consumes `createGovernor`、`TIERS`；Produces 階梯變化時 `window.dispatchEvent(new CustomEvent('qi:tier', { detail: tier }))`、`html[data-qi-tier]`。

- [ ] **Step 1: 寫失敗 e2e**（harness，`?qi-tier=high&qi-debug=1`；`debug.feedFrameTime(ms)` 以內部虛擬時間驅動調速器，所以在單一 `page.evaluate` 迴圈裡餵幀即可，不必讓軟體 GL 真的跑 65 536 點的幀）：連續餵 40 ms 的幀累計 ≥ 16 秒虛擬時間 → `html[data-qi-tier]` 依序 `high→mid→low→min`，相鄰兩次降級的虛擬時間差 ≥ 3 s，到 `min` 後不再變；餵 16 ms 的幀 20 秒 → 不降；每次降級 `debug.simGeneration()` 遞增 1；三級降完後 `renderer.info.memory.textures` 相較第一次降級後的增量 ≤ 2（舊 render target 有被 dispose）；`?qi-tier=bogus` → 退回 `initialTier` 的結果。
- [ ] **Step 2: 紅**，**Step 3: 實作**（調速器每個 rAF 以 `performance.now()` 餵入；降級時先 `setTier`，保留目前姿勢並給一次輕衝量），**Step 4: 綠**。
- [ ] **Step 5: Commit** `feat(qi): 依實測 fps 自動降級`

### Task 18: 首頁 DOM、內容模型與既有測試遷移

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `src/lib/home.ts`、`src/qi/config/copy.ts`、`src/components/home/{Opening,CoursesRun,CourseBeat,OtherCourses,CoachesBeat,PricingBeat,BookingBeat,AudienceSwitch,SectionRail,Still}.astro`、`src/styles/home.css`
- Modify: `src/pages/index.astro`（整頁換新）、`src/layouts/BaseLayout.astro`（新 prop `home?: boolean`，只有首頁傳；退回判定腳本留到 Task 20）、`src/styles/global.css`（`html[data-audience='adult'] [data-audience-panel='kid'], html[data-audience='kid'] [data-audience-panel='adult'] { display: none }` 從 `AudienceCards.astro` 的 global style 搬到這裡）、遷移表列出的 e2e 檔
- Test: `tests/unit/home-model.test.ts`、`tests/unit/home-copy.test.ts`、`tests/e2e/home.spec.ts`（新）＋遷移表

**Interfaces:**
- Consumes: `getPublishedCourses`、`getPublishedCoaches`、`coursesOfCoach`、`otherCourses`（`src/lib/courses.ts`、`content.ts`）、`BOOKING_ANCHOR`、`BOOKING_LABEL`、`SITE`、`url()`、`stills.json`（Task 12）
- Produces:
  ```ts
  // src/lib/home.ts（純邏輯，不依賴 astro:content）
  export type Category3 = 'fist' | 'combat' | 'weapon'
  export interface CourseLike { id: string; data: { title: string; summary: string; audience: string; category: string; subItems: { name: string }[]; published: boolean; order: number; coaches: { id: string }[] } }
  export interface StepModel { category: Category3; beats: BeatId[]; adult?: CourseLike; kid?: CourseLike }   // 順序 fist、combat、weapon；beats：fist→['fist']、combat→['combat-a','combat-b']、weapon→['weapon-a','weapon-b','weapon-c']
  export function buildHomeModel<C extends CourseLike, K extends { id: string; data: { name: string; role: string; published: boolean; order: number } }>(courses: readonly C[], coaches: readonly K[]): { steps: StepModel[]; others: C[]; coaches: (K & { teaches: string[] })[] }
  // copy.ts
  export const COPY: { opening: { sub: string; hint: string }; moves: Record<string, { no: string; name: string; lines: [string, string?] }>; weapons: Record<'jian'|'miaodao'|'spear', string>; pricing: { lead: string; facility: string }; booking: { lead: string }; others: { lead: string; all: string } }
  ```
  首頁 DOM 約定：`main#main[data-home]`；`section#opening[data-beat="opening"]`（`h1`＝`SITE.shortName`、`<p class="opening__sub">`、`.opening__poster`＝hero 靜態圖 `<picture>`（`hero-wide`／`hero-tall`，`fetchpriority="high"`）、`[data-skip-intro]` 按鈕、`往下捲` 提示）；`section#courses`（`h2.visually-hidden`「課程」→ `.courses-run`）內含 `AudienceSwitch`（`position: sticky`，`[data-audience-option]`）與各 beat 區塊 `.beat[data-beat="fist|combat-a|combat-b|weapon-a|weapon-b|weapon-c"]`；每個 beat 內有 `[data-audience-panel="adult"]` 與 `[data-audience-panel="kid"]`，課程 `article[data-course="<slug>"]` 含 `h3[data-course-title]`、兩行介紹、`看這門課` 連結；`combat-b`、`weapon-b/c` 的面板只放招式註解；`weapon-a/b/c` 面板內各有一個 `[data-sub-item]`（中國劍／苗刀／大槍＋一行）；`weapon-c` 另有 `看真兵器` 連到 `/courses/chinese-weapons/`；`section#others[data-beat="others"]`（`h2` 其他課程、各課 `h3` 連結、`所有課程` → `/courses/`）；`section#coaches[data-beat="coaches"]`（`h2` 師資、每位 `article[data-coach]` 含 `h3` 名、職稱、`專長：…`、`看教練`）；`section#pricing[data-beat="pricing"]`（`h2` 收費與課表、導引文案、`看收費`／`看課表`／`看場地`，**不含任何金額或時段**）；`section#booking[data-beat="booking"]`（`h2` 預約、`.seal-hit`、`a.button.button--solid[href="#line"][data-line-open]`＝`BOOKING_LABEL`）；`nav.home-rail[aria-label="首頁段落"]`；每個面板內 `.beat__still`（`Still.astro`，props `{ name: string }`：以 `import.meta.glob('../../assets/generated/qi/stills/*.webp', { eager: true, query: '?url', import: 'default' })` 解出網址、`stills.json` 提供寬高，輸出 `<img alt="" loading="lazy" decoding="async">`），CSS：`html.js:not(.qi-static) .beat__still { display: none }`。`AudienceSwitch` 外層高度 0（`height: 0; position: sticky`）、內層絕對定位，避免推擠版面（頁面長度不變，與大人／小孩無關）。標題層級：`h1` → `h2` → `h3`，不跳級。

- [ ] **Step 1: 寫失敗單元測試**：
  - `home-model`：以現有六門主課＋兩門其他課的假資料：`steps` 依序 `fist, combat, weapon`；大人／小孩各取該分類 `order` 最小且已發布者；`others` 只含 `category==='other'` 且已發布；`coaches` 只含已發布、依 `order` 排、`teaches` 為其任教的已發布課程名；**RF4**：整組沒有 `combat` 課 → `steps` 不含 `combat`；只有大人缺 `weapon` → 該 step 的 `adult` 為 `undefined`、`kid` 仍在；沒有教練／沒有其他課程 → 對應陣列為空；未發布者一律不出現。
  - `home-copy`（設計 §4 閘門）：`COPY` 的每個字串都不含 `/太極|八卦|卦|龍|鳳|袴|和服|忍者|日式|書法|水墨/`；每行 ≤ 18 個字；`moves` 涵蓋 `dingzhou`、`chengchui`、`kao`；`weapons` 三件齊全。
- [ ] **Step 2: 寫失敗 e2e `home.spec.ts`**（desktop 1440×900 與 390×844；以下「面板」皆指 `#courses [data-audience-panel="…"]`）：
  - 恰有一個 `h1`，文字 `六藝武術`；副標含 `八極拳・兵器・格鬥`。
  - **每門已發布課程都有 DOM `h3` 與連結**：對 `PUBLISHED_COURSES` 每一項，首頁存在 `a[href$="courses/<slug>/"]`（`toHaveCount(1)`，**不要求可見**，因為非作用中的那組是隱藏的）且同一個 `article` 內的 `h3` 文字等於課名（設計 §11）；未發布課程名（內家養身功…）0 筆。
  - 切換：預設大人，`homeTitles(page,'adult')` 為 `HOME_ADULT_ORDER` 且可見、kid 全隱藏；按 `小孩` 後標題與 href（`…/courses/<slug>/`）換成 `HOME_KID_ORDER`；重新整理保留；非法 localStorage 值回大人；首頁恰有一組切換鈕（`getByRole('button',{name:'小孩'})` 數量 1）。
  - 兵器：兩個對象各有三個 `[data-sub-item]`，文字依序含 中國劍、苗刀、大槍；`看真兵器` href 結尾 `courses/chinese-weapons/`。
  - 其他課程：`#others` 內 `h3` 為 巴西柔術、核心瑜珈，另有 `所有課程` → `courses/`。
  - 師資：`#coaches [data-coach] h3` 為 `COACHES` 的四個名字；`蕭蕭` 0 筆；每位有 `看教練`、一行 `專長：…`；
  - 收費課表：`#pricing` 有 `看收費`／`看課表`／`看場地` 三連結（href 正確）；`#pricing` 文字不含 `/NT|\$|元|\d{3,}/`。
  - 預約：`#booking` 的按鈕文字 `預約體驗`、`href="#line"`、有 `data-line-open`；點擊 → `#line-dialog` 可見、`Esc` 關閉。
  - 段落跳轉：桌機 `nav.home-rail` 5 個連結可見、點 `預約` 後 `#booking` 進入視窗；手機該 nav `toBeHidden`。
  - 無水平溢出（大人、小孩，兩種寬度）；標題層級不跳級；`html` 的 `scroll-snap-type` 為 `none`。
  - 減少動態（`reducedMotion:'reduce'`）：`h1`、各 `h2` 可見，`hiddenByStyle(page,'main')` 為 `[]`，兩組課程在小孩切換後可見。
  - 手機 390 的小孩切換期間（先 `scrollIntoView` 課程段）無水平外溢（遷自 `polish.spec`）。
- [ ] **Step 3: 紅**：`npx vitest run tests/unit/home-model.test.ts tests/unit/home-copy.test.ts` → FAIL；`home.spec` 在舊首頁上 FAIL。
- [ ] **Step 4: 實作** `home.ts`、`copy.ts`、元件與 `index.astro`。版面方向：桌機文字在左（直書標題）、光點在右（試作取景的 `look.x = −visibleH·aspect·0.13`）；手機文字在下、光點在上。每個 beat 高 `var(--stage-height)`（`svh`）；切換鈕 `position: sticky; top: calc(var(--frame-top) + 0.75rem)`，放在 `.courses-run` 內，離開該容器自然收起；canvas 的 DOM 在 Task 19 加。文案先寫入 `copy.ts`：兩行介紹＝`course.summary`＋`moves` 一行；小孩的招式註解取自課程內文首句（例如防身格鬥「戴上拳套，學會出手，也學會收手。」）。
- [ ] **Step 5: 遷移既有 e2e**（逐列照〈既有測試遷移表〉；`arsenal.spec` 的大幅刪改完成後，`reachStage`、`stage()`、`snapshot` 等只被首頁用的 helper 一併刪除）。
- [ ] **Step 6: 綠**：`npm test && npm run check && npm run build && npx playwright test --project=subpath`（整套，非只首頁）。
- [ ] **Step 7: `npm run fonts:subset`**（新文案的字入庫），重跑 `npm run build` 確認守門綠。
- [ ] **Step 8: Commit** `feat(home): 首頁新骨架（DOM 段落、切換、靜態圖）並遷移舊首頁測試`

### Task 19: 捲動與大人／小孩切換的引擎接線

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `src/scripts/home/{init-home,beats,audience-sync,intro-gate}.ts`
- Modify: `src/pages/index.astro`（加 canvas 與腳本入口）、`src/styles/home.css`（canvas 與 `lvh`）；`src/lib/audience.ts`、`src/scripts/audience-toggle.ts` 不動
- Test: `tests/e2e/home-engine.spec.ts`、`tests/unit/home-css.test.ts`、`tests/unit/qi-intro-gate.test.ts`

**Interfaces:**
- Consumes: `scrollState`、`POSE_BY_BEAT`、`BURSTS`、`initialTier`、`createGovernor`、`viewportChanged`、`introState`、`shouldPlayIntro`、`createShapeLoader`、`prefetchPlan`、`mountQiStage`、`AUDIENCE_STORAGE_KEY`
- Produces: `export function initHome(): Promise<void>`；`beats.ts`：`readBeatRects(root: ParentNode, scrollY: number): BeatRect[]`（以 `[data-beat]` 的 `getBoundingClientRect` 與 `scrollY` 還原文件座標；在 resize、`document.fonts.ready`、audience 變動後重算）；`intro-gate.ts`：`introSeen(storage: Pick<Storage,'getItem'>|null): boolean`、`markIntroSeen(storage: Pick<Storage,'setItem'>|null): void`（讀寫失敗一律吞掉）；`html` 屬性：`data-qi-ready`、`data-qi-mode`（`webgl`|`static`）、`data-qi-tier`（已由 Task 17 的 stage 設定，這裡只轉述）、`data-qi-beat`、`data-qi-pose`、`data-qi-scatter`（兩位小數）、`data-qi-intro`（`playing`|`done`|`skipped`）；`window.__qi`。

行為：passive `scroll` 與 rAF 讀 `scrollY` → `scrollState` → `stage.setScatter(max(scatter, switchScatter(...)))`、`setScrollSpeed`；`index` 變動時 `stage.setPose(poseFor(beat, audience))`；`MutationObserver` 觀察 `html[data-audience]`（初始載入不算）→ 重新 `setPose` 並 burst，同時 `switchScatter` 從 0 ms 起算；canvas `position: fixed; inset: var(--frame-top) var(--frame-inset) auto; height: calc(100lvh - var(--frame-top) - var(--frame-bottom)); z-index: 0`（低於頁首 50 與外框 60，內容 `position: relative; z-index: 1`），beat 高度用 `--stage-height`（`svh`）；`stage.resize` 只在 `viewportChanged` 為真時呼叫；教練卡片進入視窗中央（`IntersectionObserver`，rootMargin 同 `card-carousel.ts`）→ `stage.pulse()`；預取依 `prefetchPlan`。

- [ ] **Step 1: 寫失敗 e2e**（`?qi-tier=min&qi-debug=1`；`beatCenterY(id)` helper＝該 beat 中心座標 − 視窗高/2）：
  0. 共用設定：`addInitScript` 先設 `sessionStorage['liuyi:qi-intro']='1'`（跳過開場；RF2、RF3 的測試例外）。另有單元測試 `tests/unit/home-css.test.ts`：`src/styles/home.css` 含 `100lvh` 與 `--stage-height`，不含 `100vh`，不含 `scroll-snap-type`（除了 `none`）。
  1. 逐個 beat `scrollTo(beatCenterY(id))` 並推進時鐘，`html[data-qi-pose]` 依序等於 adult 對應（`land, dingzhou, chengchui, kao, jian, miaodao, spear, others, salute, flow, seal`），停穩後 `data-qi-scatter` ≤ 0.05。
  2. 捲到兩 beat 邊界（beat 邊界 y − 視窗高/2）：`data-qi-scatter ≥ 0.9`，捲離後回到 ≤ 0.05。
  3. 按 `小孩`：`data-qi-pose` 變成 kid 對應（`kid-wushu`…）、切換後 100 ms 時 `data-qi-scatter > 0.5`、1.5 s 後 `≤ 0.05`；`localStorage` 預設 kid 載入時第一個課程 beat 的 pose 即為 kid，且載入當下 `data-qi-scatter` 不被切換觸發（≤ 0.05）。
  4. 切換鈕黏性：停在 `fist`、`weapon-c` 時 `[data-audience-option]` 在視窗內；停在 `opening`、`others` 時 `toBeInViewport({ratio:0})` 為否。
  5. **RF1**：`page.setViewportSize` 高度縮 10% → `data-qi-tier` 與 `debug.simGeneration()` 不變、無 `pageerror`；轉向（390×844 → 844×390）→ canvas 尺寸更新、`data-qi-pose` 不變。
  6. **RF2**（桌機視窗；不設 `liuyi:qi-intro`）：首次進站開場 `playing` 時立刻點 `nav.home-rail` 的 `預約` → 時鐘推進後 `data-qi-intro` 為 `done`（不是卡在 `playing`）、`data-qi-pose==='seal'`、無 `pageerror`。
  7. **RF3**：`addInitScript` 讓 `Storage.prototype.getItem/setItem` 都 throw → 頁面載入、引擎 `data-qi-ready` 出現、切換鈕仍可切換、重新載入後開場仍 `playing`（無記憶）、無 `pageerror`。
  8. 教練卡片進入視窗中央時 `debug.pulseCount()` 遞增。
  9. 單元 `tests/unit/qi-intro-gate.test.ts`：`introSeen`／`markIntroSeen` 在 `null` 與會 throw 的 storage 上不丟例外；`markIntroSeen` 後 `introSeen` 為真。
- [ ] **Step 2: 紅**，**Step 3: 實作**，**Step 4: 綠**。
- [ ] **Step 5: Commit** `feat(home): 捲動模型、大人／小孩切換與開場閘門接上光點引擎`

### Task 20: 首屏交接、退回與無障礙

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `src/scripts/home/fallback.ts`
- Modify: `src/layouts/BaseLayout.astro`（行內腳本）、`src/styles/home.css`、`src/scripts/home/init-home.ts`
- Test: `tests/e2e/home-fallback.spec.ts`

**Interfaces:** Produces `html.qi-static`（`<head>` 行內腳本在首繪前判定：`matchMedia('(prefers-reduced-motion: reduce)')` 或 `canvas.getContext('webgl2')` 取不到）；`fallback.ts`：`export function enterStatic(reason: 'reduced-motion'|'no-webgl'|'context-lost'|'init-failed'): void`（加 `html.qi-static`、設 `data-qi-mode="static"`、停掉 rAF、移除 `[data-skip-intro]`）。

- [ ] **Step 1: 寫失敗 e2e**：
  1. **首屏不空白**：用 `page.route` 把檔名含 `qi-stage` 的 JS 請求拖延 3 秒（若 chunk 檔名不含 `qi-stage`，在 `astro.config.mjs` 以 `vite.build.rollupOptions.output.chunkFileNames` 命名）：拖延期間 `.opening__poster img` 可見且 `naturalWidth > 0`、`h1` 可見、`html` 尚無 `data-qi-ready`、截圖中央區域平均亮度 > 3；放行後 `data-qi-ready` 出現、海報 1 秒內 opacity 變 0、canvas 可見。
  2. **開場一次**：新 context 首次載入 `data-qi-intro` 為 `playing` → `done`；同一分頁重新整理為 `skipped`；新 context 再次 `playing`。
  3. **鍵盤略過**：`playing` 時 `Tab` 可聚焦 `[data-skip-intro]`、`Enter` 立刻 `skipped`；另一輪以 `Esc` 同。
  4. **減少動態**（`reducedMotion:'reduce'`）：`html.qi-static`、`data-qi-mode='static'`；**沒有請求**檔名含 `qi-stage` 的 JS、沒有 `.bin`；無 `[data-skip-intro]`；可見面板內的 `.beat__still img` 可見且 `naturalWidth > 0`；`hiddenByStyle(page,'main')` 為 `[]`；切換對象後可見的靜態圖 `src` 改變。
  5. **無 WebGL**（沿用 `arsenal.spec` 的 `getContext` 覆寫）：同第 4 點的靜態斷言、無 `pageerror`、所有課程連結可點。
  6. **RF5**：引擎 ready 後呼叫 `canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()` → 1 秒內 `html.qi-static` 與 `data-qi-mode='static'`、無 `pageerror`、DOM 文字與連結數量不變。
  7. **無 JS**（桌機與 390）：兩組面板都顯示、每個面板的靜態圖可見、`nav.home-rail` 與 `[data-skip-intro]`、切換鈕隱藏（`data-requires-js`）、點 `看這門課` 進入課程頁、`預約體驗` 的 `href` 是 `#line` 且 `#line` 的 QR 可見。
  8. **無障礙**：canvas `aria-hidden="true"` 且不可聚焦；`Tab` 序（跳到主要內容 → 頁首 →〔略過〕→ 切換鈕 → …→ 預約按鈕）無陷阱；切換鈕有 `aria-pressed`；`.beat__still img` 的 `alt` 為空字串。
- [ ] **Step 2: 紅**，**Step 3: 實作**，**Step 4: 綠**。
- [ ] **Step 5: `npm run fonts:subset`**（若新增文案，例如「略過」），建置守門綠。
- [ ] **Step 6: Commit** `feat(home): 首屏交接、減少動態／無 WebGL／無 JS 退回與無障礙`

### Task 21: 朱印預約

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:** Modify `src/components/home/BookingBeat.astro`、`src/qi/engine/stage.ts`（`debug.sealRect()`、公開 `getSealRect()`）、`src/scripts/home/init-home.ts`、`src/styles/home.css`；Test `tests/e2e/home-engine.spec.ts`（新增 describe）

**Interfaces:** Produces `QiStage.getSealRect(): { x: number; y: number; w: number; h: number } | null`（印的螢幕矩形，`seal` 姿勢未聚合時回 `null`）；`.seal-hit`（`<a href="#line" data-line-open aria-hidden="true" tabindex="-1">`）在引擎聚合後定位到該矩形。

- [ ] **Step 1: 寫失敗 e2e**：捲到 `#booking` 並推進時鐘 → `getSealRect()` 非 null、落在視窗內（桌機與 390 手機）、與 `.button` 的矩形不重疊；點 `.seal-hit` 中心 → `#line-dialog` 可見；鍵盤：`Tab` 到 `預約體驗` 按鈕、`Enter` 開啟、`Esc` 關閉；`.seal-hit` `aria-hidden="true"` 且 `tabindex="-1"`；靜態模式（減少動態）下朱印靜態圖（`seal-liuyi` 的 still）可見、按鈕仍可開啟視窗；頁尾 `#line` 與 QR 不變。
- [ ] **Step 2: 紅**，**Step 3: 實作**，**Step 4: 綠**，**Step 5: Commit** `feat(home): 朱印預約（光點收進印、印與按鈕皆可開啟 LINE 視窗）`

### Task 22: 清理舊首頁與試作

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Delete: `src/components/{Hero,Acts}.astro`、`src/scripts/{acts,acts-pin,slash,stomp,hero-sheen}.ts`、`src/lib/arsenal/slash.ts`、`tests/unit/arsenal-slash.test.ts`、`src/lab/`、`src/pages/lab/`、`arsenal.css` 內只被首頁用的規則
- Modify: `package.json`（`gsap` 若無使用者則移除）、`README.md`（新增：`fonts:subset` 流程、資產產線、`/lab/` 已移除、測試遷移後的說明）
- Test: `tests/unit/no-dead-home.test.ts`

**Interfaces:** 無新介面；`BaseLayout.astro` 移除 `initWeapons3d` 之外與首頁相關的 import 殘留（`initSlash` 在 `index.astro`，已隨首頁移除）。

- [ ] **Step 1: 寫失敗測試** `no-dead-home.test.ts`：上列被刪路徑皆不存在；`src/` 內沒有任何 import 指向它們；`src/` 與 `tests/` 不含 `data-acts`、`.pin-spacer`、`slash-layer`、`data-stomp`、`hero__`、`src/lab/qi`；`astro.config.mjs` 的 sitemap 篩選仍在；若 `package.json` 仍列 `gsap` 則 `src/` 內必須有 `from 'gsap'`。
- [ ] **Step 2: 紅**，**Step 3: 刪除並修引用**（`git grep` 確認 `Plaque`、`AudienceCards`、`CourseCard`、`CoachCard`、`ornament/*`、`weapons3d.ts`、`three/*` 仍被其他頁使用，**不刪**；D32 的 `viewer.ts` stage 模式保留）。
- [ ] **Step 4: 綠**：`npm test && npm run check && npm run build && npx playwright test --project=subpath`。
- [ ] **Step 5: `npm run fonts:subset`**（文案不應變，預期 `git diff` 空；若子集變小代表舊頁面專用字被清掉，一併提交）。
- [ ] **Step 6: Commit** `chore: 移除舊首頁元件、刀光與震腳腳本，並刪除 /lab 試作`

### Task 23: 傳輸量、截圖與整體驗收

> 測試驅動：只用 in-process（vitest、Playwright 的 `page.*`／`page.clock`），嚴禁任何 OS 層級滑鼠鍵盤自動化。

**Files:**
- Create: `tests/e2e/budget.spec.ts`、`tests/e2e/visual.spec.ts`
- Modify: 視覺調參所需的 `src/styles/home.css`、`src/qi/**`（只限參數）

**Interfaces:** Consumes `trackTransfers`、`totalBytes`（`helpers.ts`）、`?qi-tier`；Produces 驗收報告（scratchpad）。

- [ ] **Step 1: 寫 `budget.spec.ts`**（desktop 1440×900 與 390×844；用 `?qi-tier` 以外的真實預設 tier）：
  - 首屏：載入到 `html[data-qi-ready]`（或 `data-qi-mode='static'`）、未捲動，`totalBytes ≤ 1.5 MB`（硬門檻）；`> 1.3 MB` 時加 `test.info().annotations` 警示（目標未達不算失敗）；three 的 chunk 在首屏內（`data-qi-ready` 前已載）；新 context（開場待演）首屏請求的 `.bin` 數量 ≤ 3 且含 `land`、`lift`。
  - 整頁：逐段捲到底（每 700 px，`networkidle`）＋切到小孩再捲一次，累計 `≤ 5 MB`。
  - 收費頁等無 3D 頁面不載入 three（沿用舊斷言）。
- [ ] **Step 2: 寫 `visual.spec.ts`**（headless 截圖存 `test-results/visual/`，以 `sharp` 對截圖做數值檢查；Playwright 的 `page.screenshot`，無 OS 層級操作）。截圖項目與合格標準：

  | 項目 | 視窗 | 合格標準 |
  |---|---|---|
  | 首屏（three 抵達前，海報） | 1440×900、390×844 | 非空白：亮度 > 100 的像素占 1.5%–15%；`h1` 可見；無水平溢出 |
  | 開場落地後（`land`） | 同上 | 人形亮點外框高占 canvas 高 45%–90%、完整在 canvas 內（四邊留 ≥ 8 px）；桌機外框中心 x ∈ [0.50W, 0.80W]；手機外框底 < 0.70H、中心 y 在上 60% |
  | `dingzhou`、`kao`、`kid-wushu`（切小孩） | 同上 | 同上；亮點外框與 DOM 文字矩形重疊面積 ≤ 文字面積的 5% |
  | `spear` | 1440×900、390×844 | 紅色像素（R>150、G<90、B<90）≥ 150；槍桿中段縱向亮寬 ≥ 5 px；槍頭與纓都在 canvas 內 |
  | `others`、`salute`、`flow` | 同上 | `flow`：亮度 > 100 的像素 ≤ 4%，文字區域清晰；`salute`、`others` 同「人形」標準 |
  | `seal` | 同上 | 朱印矩形中心與亮點外框中心距離 ≤ 8% W；紅色像素 ≥ 300；預約按鈕不與印重疊 |
  | 減少動態靜態圖 | 同上 | 每段 `.beat__still img` 可見、`naturalWidth > 0`；無 `opacity:0` 的內容 |

  以上門檻是起始值；若視覺調參（Task 16 起）發現需調整，要在對應 commit 說明並由 Step 6 的 fresh-context 驗收簽核，不得單方放寬。
- [ ] **Step 3: 紅 → 調參 → 綠**：只調 CSS 與引擎參數（點徑、取景、`look`、文字位置），**不改測試門檻**。
- [ ] **Step 4: 字型最小化**：`npm run fonts:subset -- --from-dir dist` 後 `git status` 應無變更（子集沒有多餘或缺漏的字）；有變更就提交。
- [ ] **Step 5: 三套測試連跑兩次**：`npm test`、`npm run check`、`npm run test:e2e`（含 `links.spec` 的根路徑建置），兩輪都要全綠；記錄通過數到 scratchpad `final.txt`。
- [ ] **Step 6: fresh-context 獨立驗收**：由主對話派一個全新的 agent（不自驗），派工內容包含：設計文件 §11 驗收清單、本計畫的〈Global Constraints〉、「只讀不改」、「嚴禁 OS 層級滑鼠鍵盤自動化」、要它自己重跑三套測試與 `visual.spec`、逐張看截圖並回報：每項驗收條件的證據（測試輸出、數字、截圖檔路徑）、任何偏離、傳輸量實測值。驗收未過則回到對應任務修，再重派新的 fresh agent。
- [ ] **Step 7: 交付清單（寫進最終回報，不寫檔）**：待業主確認——八極拳架（`dingzhou`、`chengchui`、`kao`、`zhenjiao`）與兒童剪影是否正確、首頁文案（`copy.ts`）、教練剪影照片同意與否、地址與電話；待使用者實機看——桌機與手機的 fps 與發熱（設計 §11：headless 的 fps 不代表實機）。
- [ ] **Step 8: Commit** `test: 首頁傳輸量預算與截圖驗收`

---

## 自我檢查

**1. 規格涵蓋**

| 設計 | 任務 |
|---|---|
| §2 目標 1–4（骨架、招式即課程、字型、手機） | 13–21 |
| §4 反目標（可找到內容、不鎖捲動、不卡頓、SEO、禁用語彙） | 18（`home-copy`、DOM）、19（無 snap）、17（降級）、23 |
| §5 限制（傳輸量、TDD、選擇器、字型授權、素材） | Global Constraints、2–8、23 |
| §7 段落表與切換規則 | 13（姿勢／beat）、18、19 |
| §8.1 引擎＋四項補強＋降級 | 15、16、17 |
| §8.2 形體資料、比例表、兵器快照 | 9、10、11 |
| §8.3 捲動 | 13、19 |
| §8.4 首屏、靜態圖、開場一次 | 12、19、20 |
| §8.5 退回與無障礙 | 20 |
| §8.6 兵器與課程頁 | 18（`看真兵器`）、22（課程頁不動） |
| §8.7 字型 | 2、3、4 |
| §8.8 第三版處理 | 已執行，無任務 |
| §9 素材與朱印 | 5–8 |
| §10 留給實作者決定 | D15–D19、D25 |
| §11 驗收 | 23 |

**2. 步驟掃描**：每個程式步驟都給了簽名、檔案與決定值；沒有留白的「之後再補」。仍需執行者判斷處有明確界線（`headPx` 實測、提示詞措辭、視覺調參只改參數）。

**3. 型別一致**：`BeatId`／`PoseId`／`Audience`（Task 13）被 14、15、18、19 沿用；`Shape`／`KIND`／`kindToW`（Task 9）被 10、11、12、14 沿用；`TierId`／`TIERS`（Task 13）被 15、17 沿用；`QiStage` 的方法在 15（核心）、16（`playLanding`、`playIntro`）、21（`getSealRect`）逐步擴充，名稱一致；`SILHOUETTES` 與 `SILHOUETTES_READY`（Task 5）被 6、7、9 沿用。

**4. Review Focus**：RF1→13、19；RF2→19；RF3→19；RF4→13、18；RF5→20。

**5. 比例**：計畫以介面、斷言、決定值為主；沒有函式本體的轉錄。
