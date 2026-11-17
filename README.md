# 六藝武術工作室網站

Astro 靜態網站，部署在 GitHub Pages。設計文件：`docs/superpowers/specs/2026-11-15-astro-rewrite-design.md`（整站）、`docs/superpowers/specs/2026-11-16-qi-homepage-design.md`（首頁改版「氣聚成人」）。

需要 Node 24、npm 11。

## 開發

```sh
npm install
npm run dev        # http://localhost:4321/liu_yi/
```

## 測試

```sh
npm test           # Vitest 單元測試（tests/unit）
npm run check      # astro check 型別檢查
npm run test:e2e   # 先建置 /liu_yi、/ 與引擎 harness 三份，再跑 Playwright（tests/e2e）
```

第一次跑端對端測試前：`npx playwright install chromium`。
已經建置過、只想重跑測試：`npm run test:e2e:only`。

端對端測試跑的是建置後的靜態站，分三個 Playwright project（`playwright.config.ts`）；本機一律加 `--workers=2`（預設 workers 在本機會逾時不穩），Playwright 同一時間只跑一組：

```sh
npm run build && npx playwright test --project=subpath --workers=2         # dist（base /liu_yi）：除引擎 harness 外的全部
npm run build:root && npx playwright test --project=root --workers=2       # dist-root（base /）：只重跑 links.spec 的連結與資源檢查
npm run build:harness && npx playwright test --project=engine --workers=2  # dist-harness：引擎 harness（qi-engine、qi-effects）
```

- 首頁的測試在 `tests/e2e/home*.spec.ts`（內容與切換、引擎接線、退回與無障礙），共用 helper 在 `tests/e2e/helpers.ts`（`homeTitles` 等）。
  headless 的 WebGL 是軟體繪製：引擎相關一律加 `?qi-tier=min&qi-debug=1`，時間用 `page.clock` 推進。
- **引擎 harness**：`qi-engine.spec.ts`、`qi-effects.spec.ts` 要直接操作 `QiStage`（換姿勢、換 tier、dispose、餵幀時間），不能經過首頁的捲動驅動，
  所以打在測試專用頁 `/__test/qi-harness/`（原始檔 `tests/harness/qi-harness.astro`）。那一頁只在 `QI_HARNESS=1` 的建置才存在
  （`integrations/qi-harness.ts`；`npm run build:harness` 輸出到 `dist-harness/`），**一般建置與部署都沒有它**，也不在 sitemap（另有 noindex）。
  `dist-harness/` 不得部署。
- 舊首頁（三幕、釘選、刀光、震腳、獅子掃光）的測試已隨首頁改版移除；兵器 3D 的測試只剩課程頁（`arsenal.spec.ts`）。
  `tests/unit/no-dead-home.test.ts` 守住「舊首頁的檔案與標記不會再回來」。

## 視覺與動態

- 色彩、字體、外框尺寸都在 `src/styles/tokens.css`；元件只用語意色變數（`--color-*`）。
- 紋樣（回紋、窗櫺、海水紋、顆粒）、匾額、方印、進場效果在 `src/styles/ornament.css`；固定外框在 `src/styles/chrome.css` 與 `src/components/Frame.astro`。
- 兵器、八方、擂台的線稿是自繪 SVG，在 `src/components/ornament/`（兵器線稿現在是 3D 兵器的退路）。
- 首頁是「氣聚成人」：一張固定的 WebGL 畫布，光點隨捲動聚成人形、兵器、攤開的竹簡（收費課表）與燙金獅子館徽（預約）（見下節）；其他頁的進場效果是 IntersectionObserver 加 CSS（`src/scripts/reveal.ts`）。已不使用 GSAP。
- 全站字型只有 TW-Kai 一種、字重 400（見〈字型〉）。

## 3D 兵器與特殊互動（第二版，設計文件 §15）

- 中國劍、苗刀、大槍是用 three.js **程式建模**的（剖面放樣、車削、擠出、曲線掃掠），不載任何模型、HDR 或貼圖檔：
  - 幾何：`src/scripts/three/loft.ts`（放樣）、`src/scripts/three/weapons.ts`（三件兵器）。
  - 材質與程式貼圖：`src/scripts/three/materials.ts`、`src/scripts/three/textures.ts`。顏色讀 `tokens.css` 的 `--color-steel`、`--color-brass` 等。
  - 攝影棚環境（金屬反光的來源）：`src/scripts/three/studio.ts`。空間暗、燈條少而窄而亮：刃大部分是深鋼灰，映到燈條的地方才是銳利的光帶。要調「金屬感」先調這裡。
  - 檢視器（三種模式：兵器台 `stage`、課程頁單件 `single`、課程卡 `card`）：`src/scripts/three/viewer.ts`。首頁改版後 `stage` 模式（以及 `switcher.ts`、`stage.ts`）沒有入口，因課程頁 3D 規定不動而保留，列為後續清理。
- three 在課程頁只在有 `[data-weapon3d]`、且使用者接近那個區塊時才下載（`src/scripts/weapons3d.ts`）；首頁的光點引擎另有自己的 three chunk（見〈首頁：氣聚成人〉）。
  沒有 WebGL、建立失敗或沒有 JavaScript 時，顯示原本的 SVG 線稿（`.weapon3d-fallback`）。
- 構圖：兵器只擺在「舞台範圍」裡（畫布扣掉標題、課程牌、切換列之後的那一塊，由檢視器量 DOM 得來），大小與斜度由 `src/lib/arsenal/stage.ts` 算；課程頁每一列的名稱與兵器各佔一格。
- 純邏輯都在 `src/lib/arsenal/`，有單元測試：捲動進度 → 姿勢（`pose.ts`）、兵器切換（`switcher.ts`）、
  拖曳慣性與回正（`inertia.ts`）、能力偵測與降級（`capability.ts`）。共用樣式在 `src/styles/arsenal.css`。
- 刀光、震腳、首屏獅子的掃光已隨舊首頁移除（`capability.ts` 的 `slash`／`stomp` 欄位因此沒有使用者，列為後續清理）。
- 「減少動態」：兵器靜態呈現（仍可拖曳）。手機：像素比上限 1.5、關陰影；離開畫面或分頁在背景時停止繪製。
- 端對端測試在 `tests/e2e/arsenal.spec.ts`（課程頁的 3D 兵器）。無頭瀏覽器的 WebGL 是軟體繪製，這個檔案的測試依序執行。

## 首頁：氣聚成人

- 引擎在 `src/qi/`：`config/`（素材清單、人形比例、姿勢與 beat 對應、首頁文案）、`shapes/`（形體檔格式、取樣、載入）、`engine/`（GPGPU 模擬、光暈、掌風、捲動模型、開場、自動降級；`engine/qi-stage.ts` 是動態載入的入口）。
  首頁的版面在 `src/components/home/`、`src/styles/home.css`，接線在 `src/scripts/home/`（`init-home.ts`）。
- 光點數分級 `high`／`mid`／`low`／`min`（256²／192²／144²／112²），連續低於 40 fps 自動降一級；開場演出期間先不降，演完才降。
  網址可帶 `?qi-tier=high|mid|low|min` 覆寫分級、`?qi-debug=1` 暴露 `window.__qi.debug`（測試與截圖用）。
- 減少動態、沒有 WebGL2、引擎掛不上、WebGL context 遺失、自動降級時重建失敗：退回靜態圖（`html.qi-static`），頁面文字與連結不變；沒有 JavaScript 時兩組課程面板與靜態圖都直接可見。
- **入館閘門**：首次進站（每個工作階段一次，`sessionStorage` 的 `liuyi:qi-intro`）先蓋一層全屏黑底——燙金獅子館徽、四周飄浮的光點（引擎的氣流，`flow` 姿勢）與「入館」按鈕；按下（或 Enter、空白鍵）後淡出（≤ 600 ms）才開始開場，閘門期間 `html` 不可捲動、背景 `inert`、焦點在按鈕，進入後焦點到 `main`。
  是否顯示由 `<head>` 的行內腳本在首繪前決定（`scripts/home/intro-gate.ts` 的 `shouldShowGate`，單元測試以 vm 對照）：減少動態、沒有 WebGL2、再訪、網址帶 `#錨點`、從站內其他頁進來、沒有 JavaScript 都不擋；首頁腳本載不到時 10 秒後由行內腳本拿掉閘門。
  網址可帶 `?qi-crest-failsafe=<ms|off>` 注入開場館徽的逾時保險（測試用；預設 7 秒，閘門收起後才起算，開場一開始就解除）。
- 課程、收費、課表與 LINE 預約一律是 DOM 文字，不只存在畫布裡。

### 其他頁面的光點層

- 每個非首頁的頁面也有光點（`BaseLayout` 的 `qi` 屬性，元件 `components/QiBackdrop.astro`，腳本 `scripts/qi/page.ts`，樣式 `styles/qi-page.css`）；每種頁面放什麼形體、放在哪裡在 `src/qi/config/pages.ts`：
  課程內頁依課程的分類與對象（拳→定軸、格鬥→撐捶、兵器→劍、兒童課 `kid-*`、其他→`others`）；課程總覽是整張畫布的氣流（`flow`），滑過或聚焦課程卡才在右側欄聚成該課的姿勢；
  師資與教練頁是抱拳（`salute`），師資總覽滑過或聚焦教練卡時脈動一下；場地是院門（`gate`，由既有的 `bg-mid-gate` 剪影走形體產線），寬螢幕往下捲時由飄散聚成門；
  收費與課表是低亮度的竹簡（`scroll`），文字與海報圖浮在上面；404 是光點散開、慢慢聚成落地人形。
- **版面**：桌機寬螢幕（寬 ≥ 80rem 且寬高比 ≥ 4:3，`QI_RAIL_QUERY`）光點畫布是內容右側的一欄，內容欄讓出位置、光點不在任何文字底下；其他尺寸是頁首上方的一條（隨頁面捲走，捲出視窗就暫停）；
  竹簡與課程總覽的氣流是整張固定的背景。靜態圖（引擎到達之前、減少動態、沒有 WebGL、沒有 JS）依引擎的取景算大小（`config/still-fit.ts`、`lib/still-fit.ts`），交叉淡化時人形一樣大。
- **引擎**：與首頁共用同一個 `mountQiStage`，取景改由「槽」決定（`engine/slot.ts`，`QiStageOptions.slot`）；兵器與合成形體縮進槽（`Layout.window`、`othersFitWindow`）。
  首頁與各頁共用的接線（殼、退回、降級、掛載、取景、換姿勢、每格迴圈）在 `scripts/qi/host.ts`；`fallback.ts` 也搬到 `scripts/qi/`。沒有入館閘門與開場。
- **傳輸量**：每頁首屏 ≤ 1.5 MB；three、引擎與形體等 load 事件與瀏覽器閒下來之後才載入（`budget.spec` 每種頁面各量一頁）。有 3D 兵器架的課程頁（自己有一個 WebGL context），兵器架進入視窗時頁首的光點淡出並暫停。

### 素材產線

- **形體檔與靜態圖是建置產物**（`src/assets/generated/qi/`，已忽略）：`integrations/qi-assets.ts` 在建置時由入庫的剪影、兵器快照、朱印遮罩與館徽圖產生（竹簡是程序化的幾何，沒有輸入檔，所以不含任何字），輸入雜湊不變就跳過；CI 不需要 Python、OpenAI 金鑰或字型原檔。
- **剪影**（`src/assets/silhouettes/`）：本機工具 `tools/silhouettes/{gen.py,postprocess.py,prompts.json}` 以 OpenAI Images 生成、後處理並做機械品管（金鑰只在執行時從 `%APPDATA%/agent-sprite-forge/config.json` 讀取，不得寫進 repo 或輸出）。
  提示詞、raw 雜湊、請求數與 QA 結果記在 `provenance.json`；品管閘門是 `scripts/qi/silhouette-qa.ts`（`tests/unit/silhouette-assets.test.ts` 驗已入庫的圖）。raw PNG 不入庫。
  沒被使用的剪影（`bg-*`、`mid-*`、`fg-*` 等）刻意保留；其中 `bg-mid-gate` 現在是場地頁院門（`gate` 形體）的來源。
- **朱印遮罩**（`src/assets/seal/seal-liuyi.png`）：`tools/seal/render-seal.py` 以崇羲篆體渲出 512×512 的 alpha 遮罩。字型檔（CC BY-ND 3.0 TW）只放在本機 `~/.cache/liu_yi-fonts/`，絕不入庫（`tests/unit/seal-asset.test.ts` 會掃）。
- **兵器快照**（`src/qi/data/weapons/*.geo`）：改了 `src/scripts/three/weapons.ts` 的造型後執行 `npm run qi:snapshot-weapons` 重新產生並入庫。
- **燙金獅子館徽**（`src/assets/images/crest-lion.png`）：開場區用的透明底金色版。`scripts/crest/render-crest.ts` 由 `logo_large.jpg`（黑底米白線條）轉出——亮度當不透明度、換成古金色帶；改了來源或色帶後執行 `npm run crest:build` 重建並入庫（`tests/unit/crest-asset.test.ts` 會驗成品沒過期）。首頁用 `<Image>` 輸出響應式 webp；預約段的光點館徽（`crest` 形體）也是由這張圖依亮度取樣（亮線多取、暗面少取）。
- 本機 Python 工具一律用 `uv run --no-project --python 3.11 --with … python <腳本>` 執行，用法寫在各腳本檔頭。

## 字型

全站只用 TW-Kai（全字庫正楷體，OFL-1.1，授權檔 `src/assets/fonts/OFL-TW-Kai.txt`）、字重 400。原檔約 37 MB、**不進 git**；入庫的是依實際用字子集化的 `src/assets/fonts/twkai-subset.woff2` 與字集 `twkai-subset.chars.txt`。

- **改了任何會顯示在頁面上的文字**（文案、標籤、alt、aria-label）後執行 `npm run fonts:subset`：它下載並驗證原檔（sha256，快取在被忽略的 `.cache/fonts/`）、建置站台掃用字、子集化並寫出上述兩個檔。
  `-- --from-dir <dist>` 可略過建置、直接掃現成的建置資料夾。子集變了要一起提交。
- **每次 `astro build` 都有守門**（`integrations/twkai-guard.ts`）：頁面（HTML 文字、alt／title／aria-label、CSS `content:`、JS 內的 CJK 字串）有任何字不在子集內就讓建置失敗並列出字與頁面；掃到 0 個字也算失敗。
  TW-Kai 本身沒有的字須列入 `scripts/fonts/fallback-allowed.txt`；`TWKAI_GUARD=warn` 只印警告（`fonts:subset` 自己建置時用）。
- 會被打包進瀏覽器端的程式（引擎 chunk、首頁腳本）的錯誤訊息與字串用英文，否則守門會因 JS 內的中文字失敗。
- 單一 woff2 的大小上限由 `tests/e2e/fonts.spec.ts` 把關；字數增加讓子集變大超過上限時會紅燈，逼著重新檢討。

## 建置

```sh
npm run build        # 輸出到 dist/，base 是 /liu_yi
npm run preview      # 預覽 dist/
```

## 換 base 或網域

站台網址與 base 的預設值只寫在 `deploy-target.mjs`（`https://lawa0921.github.io` 與 `/liu_yi`）。

- 永久更換（例如換自訂網域）：改 `deploy-target.mjs` 的 `DEFAULT_SITE`、`DEFAULT_BASE`。
- 單次建置覆寫：用環境變數 `SITE_URL`、`BASE_PATH`（`OUT_DIR` 可改輸出資料夾）。
  `npm run build:root` 就是 `BASE_PATH=/ OUT_DIR=dist-root` 的建置。
- `npm run build:harness`（`QI_HARNESS=1 OUT_DIR=dist-harness`）多出引擎測試專用頁 `/__test/qi-harness/`，只給 e2e 的 `engine` project 用，不得部署。

## 已移除的東西

- `/lab/`（給業主看方向的光點試作與 harness）已刪除，歷史在 commit `e56a090`；`astro.config.mjs` 的 sitemap 仍排除 `/lab/`，以免日後再放拋棄式試作時被收錄。
- 舊首頁的 `Hero`／`Acts` 元件與其腳本（三幕釘選、刀光、震腳、獅子掃光）。

站內連結與資源一律經過 `src/lib/url.ts` 的 `url()`，不要手寫 `/liu_yi/...`。

## 內容

- 課程：`src/content/courses/*.md`，教練：`src/content/coaches/*.md`；欄位定義在 `src/content.config.ts`。
- `published: false` 的不會產生頁面。`needsOwnerCopy: true` 是內文待業主補的課程。
- 照片放 `src/assets/images/`，在課程的 `photos` 列出（最多 5 張）；影片填 `videoUrl`。
- 教練資歷只抄錄海報上看得到的內容，不補寫。

## 部署

`.github/workflows/deploy.yml`：推到 `master` 時建置並部署到 GitHub Pages。
