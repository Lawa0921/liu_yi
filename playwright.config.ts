import { defineConfig, devices } from '@playwright/test';

// 端對端測試跑的是「建置後的靜態站」，由 tests/e2e/static-server.mjs 服務（仿 GitHub Pages），不是 dev server。
// 三份建置：dist（base=/liu_yi，預設）、dist-root（base=/）與 dist-harness（base=/liu_yi、QI_HARNESS=1：多一頁引擎測試專用的 harness）。
// 先跑 `npm run build && npm run build:root && npm run build:harness`，或直接 `npm run test:e2e`（會先建置）。
// dist-harness 絕不部署：引擎的 e2e（qi-engine、qi-effects）要直接操作 QiStage，只有它有那一頁；subpath 不跑這兩支，engine 只跑這兩支。
const SUBPATH_PORT = 4391;
const ROOT_PORT = 4392;
const HARNESS_PORT = 4393;
const ENGINE_SPECS = /qi-(engine|effects)\.spec\.ts/;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `node tests/e2e/static-server.mjs --dir dist --base /liu_yi --port ${SUBPATH_PORT}`,
      url: `http://127.0.0.1:${SUBPATH_PORT}/liu_yi/`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `node tests/e2e/static-server.mjs --dir dist-root --base / --port ${ROOT_PORT}`,
      url: `http://127.0.0.1:${ROOT_PORT}/`,
      reuseExistingServer: !process.env.CI,
    },
    {
      // 用 port 判定就緒（不用 url）：沒建 dist-harness 時，只跑 subpath／root 的人不該被這個伺服器卡住；
      // engine project 的測試自己會因為頁面 404 而明確失敗。
      command: `node tests/e2e/static-server.mjs --dir dist-harness --base /liu_yi --port ${HARNESS_PORT}`,
      port: HARNESS_PORT,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    {
      // 除了引擎 harness 的兩支，所有測試都在預設的 /liu_yi base 下跑。
      name: 'subpath',
      testIgnore: ENGINE_SPECS,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${SUBPATH_PORT}/liu_yi/` },
    },
    {
      // 引擎 e2e：打在 dist-harness 的 /__test/qi-harness/（見 integrations/qi-harness.ts）。
      name: 'engine',
      testMatch: ENGINE_SPECS,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${HARNESS_PORT}/liu_yi/` },
    },
    {
      // 根路徑建置只重跑連結與資源檢查。
      name: 'root',
      testMatch: /links\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${ROOT_PORT}/` },
    },
  ],
});
