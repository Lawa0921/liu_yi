# 六藝武術工作室網站

Astro 靜態網站，部署在 GitHub Pages。設計文件：`docs/superpowers/specs/2026-11-15-astro-rewrite-design.md`。

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
npm run test:e2e   # 先建置 /liu_yi 與 / 兩份，再跑 Playwright（tests/e2e）
```

第一次跑端對端測試前：`npx playwright install chromium`。
已經建置過、只想重跑測試：`npm run test:e2e:only`。

## 視覺與動態

- 色彩、字體、外框尺寸都在 `src/styles/tokens.css`；元件只用語意色變數（`--color-*`）。
- 紋樣（回紋、窗櫺、海水紋、顆粒）、匾額、方印、進場效果在 `src/styles/ornament.css`；固定外框在 `src/styles/chrome.css` 與 `src/components/Frame.astro`。
- 兵器、八方、擂台的線稿是自繪 SVG，在 `src/components/ornament/`（兵器線稿現在是 3D 兵器的退路）。
- 首頁三幕的釘選捲動用 GSAP ScrollTrigger（`src/scripts/acts-pin.ts`），只在首頁、桌機寬度、且系統沒有要求「減少動態」時才下載；其他進場效果是 IntersectionObserver 加 CSS（`src/scripts/reveal.ts`）。
- 首屏主視覺要換（例如改成八極拳主題）：只換 `src/components/Hero.astro` 裡 `data-hero-visual` 那一塊。

## 3D 兵器與特殊互動（第二版，設計文件 §15）

- 中國劍、苗刀、大槍是用 three.js **程式建模**的（剖面放樣、車削、擠出、曲線掃掠），不載任何模型、HDR 或貼圖檔：
  - 幾何：`src/scripts/three/loft.ts`（放樣）、`src/scripts/three/weapons.ts`（三件兵器）。
  - 材質與程式貼圖：`src/scripts/three/materials.ts`、`src/scripts/three/textures.ts`。顏色讀 `tokens.css` 的 `--color-steel`、`--color-brass` 等。
  - 攝影棚環境（金屬反光的來源）：`src/scripts/three/studio.ts`。空間暗、燈條少而窄而亮：刃大部分是深鋼灰，映到燈條的地方才是銳利的光帶。要調「金屬感」先調這裡。
  - 檢視器（三種模式：兵器台 `stage`、課程頁單件 `single`、課程卡 `card`）：`src/scripts/three/viewer.ts`。
- three 只在有 `[data-weapon3d]` 的頁面、且使用者接近那個區塊時才下載（`src/scripts/weapons3d.ts`）；首頁首屏不載。
  沒有 WebGL、建立失敗或沒有 JavaScript 時，顯示原本的 SVG 線稿（`.weapon3d-fallback`）。
- 構圖：兵器只擺在「舞台範圍」裡（畫布扣掉標題、課程牌、切換列之後的那一塊，由檢視器量 DOM 得來），大小與斜度由 `src/lib/arsenal/stage.ts` 算；課程頁每一列的名稱與兵器各佔一格。
- 純邏輯都在 `src/lib/arsenal/`，有單元測試：捲動進度 → 姿勢（`pose.ts`）、兵器切換（`switcher.ts`）、
  拖曳慣性與回正（`inertia.ts`）、能力偵測與降級（`capability.ts`）、刀光軌跡（`slash.ts`）。
- 其他互動：刀光 `src/scripts/slash.ts`、震腳 `src/scripts/stomp.ts`、首屏獅子的掃光 `src/scripts/hero-sheen.ts`；共用樣式在 `src/styles/arsenal.css`。
- 「減少動態」：兵器靜態呈現（仍可拖曳）、不出刀光、沒有震腳。手機：像素比上限 1.5、關陰影；離開畫面或分頁在背景時停止繪製。
- 端對端測試在 `tests/e2e/arsenal.spec.ts`。無頭瀏覽器的 WebGL 是軟體繪製，這個檔案的測試依序執行。

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

站內連結與資源一律經過 `src/lib/url.ts` 的 `url()`，不要手寫 `/liu_yi/...`。

## 內容

- 課程：`src/content/courses/*.md`，教練：`src/content/coaches/*.md`；欄位定義在 `src/content.config.ts`。
- `published: false` 的不會產生頁面。`needsOwnerCopy: true` 是內文待業主補的課程。
- 照片放 `src/assets/images/`，在課程的 `photos` 列出（最多 5 張）；影片填 `videoUrl`。
- 教練資歷只抄錄海報上看得到的內容，不補寫。

## 部署

`.github/workflows/deploy.yml`：推到 `master` 時建置並部署到 GitHub Pages。
