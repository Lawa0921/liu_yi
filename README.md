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
- 首頁是「氣聚成人」：一張固定的 WebGL 畫布，光點隨捲動聚成人形、兵器、攤開的竹簡（課表）與燙金獅子館徽（預約）（見下節）；其他頁的進場效果是 IntersectionObserver 加 CSS（`src/scripts/reveal.ts`）。已不使用 GSAP。
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
- 課程、課表與 LINE 預約一律是 DOM 文字，不只存在畫布裡。收費方案不公開（業主決定），站上不放金額與收費頁，改引導用 LINE 詢問費用。

- **景深層**（Task 27）：光點拳師旁邊有遠景屋脊與中景（院門、兵器架、鼓、旗、木人樁，依段落交叉淡化，`MID_BY_BEAT`；中景在人形左側、不是正後方），前面有框在左右的前景（右上簷角；左下窗櫺，只在左下角沒有字的段落出現，`HOME_FG_LEFT_BEATS`；直向只有左上簷角）；
  標記在 `components/home/Depth.astro`、樣式 `styles/depth.css`、接線 `scripts/home/depth.ts`，配對在 `lib/scene/config.ts`。遠景與中景用 `mix-blend-mode: lighten` 疊在最上面（z-index 2，只把比後面亮的地方提亮），
  所以開場的靜態海報與每段靜態圖那種不透明的暗底也蓋不住它——引擎到達之前、引擎在跑、減少動態或沒有 WebGL（靜態圖）、沒有 JS，四種狀態看到的景深一樣；光點畫布仍用 `screen`（純黑底對頁面底色是中性的）。
  前景（近黑，一般混合）同在最上面（為了蓋在不透明的海報與靜態圖前面），所以**會**在文字之上：靜止在每一段時位置避開文字與光點主體；捲動途中文字從前景底下經過時，腳本把與文字相交的那一張前景淡出、走過去再淡入
  （`scripts/home/depth.ts` 量每個文字矩形，純函式在 `lib/scene/fg-dodge.ts`；沒有 JS 時前景不顯示）。文字掃過的速度可以是每秒上千 px，淡出來不及，所以依捲動速度與方向提前：
  往文字來的那一側看遠 速度 × (淡出 0.1 s ＋ 一格)，文字還沒碰到就開始淡出（淡入 0.3 s）；只算看得見的文字（被頁首蓋住的不算）。`tests/e2e/home-depth.spec.ts` 每一段停下來量一次（三種視窗尺寸）、
  桌機與手機各從頂捲到底每 40 px 量一次（目標狀態），並且以真實速度（手機 500／1200 px/s、桌機 2500 px/s，轉場開著，逐格量實際 opacity 加權後的覆蓋比例）捲動，文字被前景蓋住的比例都 ≤ 5%。遠景、中景、前景隨整頁捲動進度位移（遠景最小、前景最大、方向相反，只動 transform）；減少動態時不位移。
  看得見用截圖量：隱藏光點畫布，每一層「有／沒有」的平均亮度差（0–255）：第一版審查量到遠景 2.4、中景 12–15；現在四種狀態、兩種視窗都量到遠景 22–25、中景 22–33、前景 18–22（門檻 14／16／12）。
  首屏只載遠景、院門（預設中景）與前景（首屏預算見 `budget.spec`），其餘四種中景用 `data-src`，輪到那一段或引擎就緒後 2 秒才載（`budget.spec` 斷言首屏沒有那四張）。
- **兵器三段是拳師持械**（Task 27）：劍、苗刀、大槍與小孩的持劍、持刀、持槍不再是單獨一把兵器，而是「拳師拿著兵器」的光點形體（形體 id 是 `jian`／`miaodao`／`spear`／`kid-weapon`／`kid-miaodao`／`kid-spear`；兵器三段的小孩版是使用者後來指出「苗刀和大槍的區塊沒有小孩版」才補的，編號五、六）。
  剪影（`fig-jian`、`fig-miaodao`、`fig-daqiang`、`fig-kid-weapon`、`fig-kid-miaodao`、`fig-kid-daqiang`，人本來就拿著兵器）取樣成人形，把剪影自己畫的細兵器剔掉（`shapes/sample-armed.ts` 的 `eraseWeapon`：膠囊與矩形，手與頭的保留圈不剔），再把兵器幾何（`src/qi/data/weapons/*.geo` 的單位形）依剪影裡兵器的鋒尖與尾端擺上去，所以兵器落在手上、方向與握法和剪影一致；
  兵器點占 `weaponShare` 且表面點多（較密、種類較亮），紅纓仍朝下垂。每一件的座標、頭高與點數比例在 `config/armed.ts`（`tests/unit/qi-armed-assets.test.ts` 用真剪影驗：軸穿過手、剔掉之後人形仍是單一的一塊）。
  執行時整體（人加兵器）依 `armedLayout` 放進左右界：橫向右界避開段落導覽、左界是該段文字的右緣加 24 px（`text-extent.ts`、`QiStage.relayout()`），直向是畫布左右緣（`portraitReachFor`）；比窗寬就以腳底為中心等比例縮小，不再依視窗換槍長與傾角。
  1440×900 下整體外框（`debug.extent()`，`?qi-tier=min`）：大槍 769×334 px（舊規則「槍長 ≥ 700 px」仍成立；用重生的 `fig-daqiang`）、劍 557×359、苗刀 738×367（第 2 輪從直立高舉重生成弓步撩刀）；小孩持劍 292×393、持刀 605×287、持槍 654×297；
  手機 390×844：大槍 358×158、劍 351×225、苗刀 355×183；小孩持劍 169×240、持刀 335×172、持槍 325×158。

### 素材產線

- **形體檔與靜態圖是建置產物**（`src/assets/generated/qi/`，已忽略）：`integrations/qi-assets.ts` 在建置時由入庫的剪影、兵器快照、朱印遮罩與館徽圖產生（竹簡是程序化的幾何，沒有輸入檔，所以不含任何字），輸入雜湊不變就跳過；CI 不需要 Python、OpenAI 金鑰或字型原檔。
- **剪影**（`src/assets/silhouettes/`）：本機工具 `tools/silhouettes/{gen.py,postprocess.py,prompts.json}` 以 OpenAI Images 生成、後處理並做機械品管（金鑰只在執行時從 `%APPDATA%/agent-sprite-forge/config.json` 讀取，不得寫進 repo 或輸出）。
  提示詞、raw 雜湊、請求數與 QA 結果記在 `provenance.json`；品管閘門是 `scripts/qi/silhouette-qa.ts`（`tests/unit/silhouette-assets.test.ts` 驗已入庫的圖）。raw PNG 不入庫。
  `bg-*`、`mid-*`、`fg-*` 與 `fig-*` 現在是子頁剪影場景與首頁景深層的素材（`lib/scene/config.ts`）；`fig-jian`、`fig-miaodao`、`fig-daqiang`、`fig-kid-*` 也是持械形體的來源（`fig-daqiang` 第一版後手沒握住槍桿、尺寸也過不了閘門，已用 1536×1024 橫式重生，1378×600、軟 alpha；已拿掉原本放大 1.25 倍的二值版）。
- **朱印遮罩**（`src/assets/seal/seal-liuyi.png`）：`tools/seal/render-seal.py` 以崇羲篆體渲出 512×512 的 alpha 遮罩。字型檔（CC BY-ND 3.0 TW）只放在本機 `~/.cache/liu_yi-fonts/`，絕不入庫（`tests/unit/seal-asset.test.ts` 會掃）。
- **兵器快照**（`src/qi/data/weapons/*.geo`）：改了 `src/scripts/three/weapons.ts` 的造型後執行 `npm run qi:snapshot-weapons` 重新產生並入庫。
- **燙金獅子館徽**（`src/assets/images/crest-lion.png`）：開場區用的透明底金色版。`scripts/crest/render-crest.ts` 由 `logo_large.jpg`（黑底米白線條）轉出——亮度當不透明度、換成古金色帶；改了來源或色帶後執行 `npm run crest:build` 重建並入庫（`tests/unit/crest-asset.test.ts` 會驗成品沒過期）。首頁用 `<Image>` 輸出響應式 webp；預約段的光點館徽（`crest` 形體）也是由這張圖依亮度取樣（亮線多取、暗面少取）。
- 本機 Python 工具一律用 `uv run --no-project --python 3.11 --with … python <腳本>` 執行，用法寫在各腳本檔頭。

## 其他頁面：剪影立體場景（Task 27）

- 子頁（課程總覽、課程內頁、師資、教練、場地、課表、404）頁首是一幕由遠到近四層的剪影，高約 50svh（手機 45svh），在內容上方、不與任何文字重疊：
  遠景屋脊（最淡、最慢）→ 中景器物 → 人物（課程內頁用該課的 `fig-*`／`kid-*`、師資與 404 是抱拳、場地是空場）→ 前景框（簷角、柱框、窗櫺、石階、近處的兵器架）。
  元件 `components/Scene.astro`（由 `BaseLayout` 的 `scene` 屬性輸出）、樣式 `styles/scene.css`、視差接線 `scripts/scene.ts`；每頁的組合在 `lib/scene/config.ts`（`sceneSignature` 互不相同，單元測試守住）。
- **深度感**：越遠越淡（黑色剪影在亮霧上的不透明度）、越遠越慢（捲動視差：位移 = 捲動量 ×（1 − 速度），遠景 0.78、中景 0.9、人物 1、前景 1.32；桌機滑鼠微傾最多 14 px，近景與遠景方向相反；手機只做捲動視差）、
  遠景加大氣透視（霧）、前景加暗角、少量 CSS 飄塵。計算在 `lib/scene/parallax.ts`（純函式，單元測試）；全程只動 transform／opacity，passive 監聽，不用 WebGL、不載入 three 與光點引擎（`budget.spec` 量每種頁面的首屏）。
- 課程總覽：滑過或聚焦課程卡（`data-scene-card`），人物換成該課的剪影（交叉淡化）；離開回到預設。
- 退回：沒有 JS 時是靜態的一幕、文字完整；減少動態時不做視差、不飄塵、換人沒有轉場。
- **推門換頁**（`styles/transition.css`）：站內換頁（跨文件）用 CSS 的 `@view-transition { navigation: auto }`——舊頁像兩扇門往中間關（0.3 s）、新頁從中間往兩邊推開（延後 0.3 s 再 0.3 s，總長 0.6 s），只動快照的 `clip-path`。
  整組規則在 `prefers-reduced-motion: no-preference` 之內（減少動態時沒有轉場、直接換頁）；不支援 View Transitions 的瀏覽器看不懂就直接換頁、不報錯；錨點（同頁）不走轉場；首頁的入館閘門由 `<head>` 依 referrer 決定，與轉場無關。`tests/e2e/transition.spec.ts` 驗宣告與真的換頁（`pagereveal` 的 `viewTransition` 與兩段動畫）。

## 字型

全站只用 TW-Kai（全字庫正楷體，OFL-1.1，授權檔 `src/assets/fonts/OFL-TW-Kai.txt`）、字重 400。原檔約 37 MB、**不進 git**；入庫的是依實際用字子集化的兩份子集：
核心 `src/assets/fonts/twkai-subset.woff2`／`twkai-subset.chars.txt`（首頁與共用 JS／CSS 用到的字，首頁只 preload 這份），
延伸 `twkai-extra.woff2`／`twkai-extra.chars.txt`（只出現在其他頁面的字）。兩份以 `@font-face` 的 `unicode-range` 區隔（`astro.config.mjs`），
瀏覽器只在頁面真的用到延伸字時才下載延伸檔，所以子頁加文案不會加重首頁首屏。拆法見 `scripts/fonts/split.ts`。

- **改了任何會顯示在頁面上的文字**（文案、標籤、alt、aria-label）後執行 `npm run fonts:subset`：它下載並驗證原檔（sha256，快取在被忽略的 `.cache/fonts/`）、建置站台掃用字、子集化並寫出上述檔案（沒有延伸字時刪掉延伸檔）。改完要重新 `npm run build`，建置產物才會用到新的子集。
  `-- --from-dir <dist>` 可略過建置、直接掃現成的建置資料夾。子集變了要一起提交。
- **每次 `astro build` 都有守門**（`integrations/twkai-guard.ts`）：頁面（HTML 文字、alt／title／aria-label、CSS `content:`、JS 內的 CJK 字串）有任何字不在子集內就讓建置失敗並列出字與頁面；掃到 0 個字也算失敗。
  TW-Kai 本身沒有的字須列入 `scripts/fonts/fallback-allowed.txt`；`TWKAI_GUARD=warn` 只印警告（`fonts:subset` 自己建置時用）。
- 會被打包進瀏覽器端的程式（引擎 chunk、首頁腳本）的錯誤訊息與字串用英文，否則守門會因 JS 內的中文字失敗。
- 每一份 woff2 的大小上限與每頁下載份數（首頁 1、其他頁最多 2）由 `tests/e2e/fonts.spec.ts` 把關；字數增加讓子集變大超過上限時會紅燈，逼著重新檢討。

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
