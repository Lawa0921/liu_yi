import { defineConfig, devices } from '@playwright/test';

// 端對端測試跑的是「建置後的靜態站」，由 tests/e2e/static-server.mjs 服務（仿 GitHub Pages），不是 dev server。
// 兩份建置：dist（base=/liu_yi，預設）與 dist-root（base=/）。先跑 `npm run build && npm run build:root`，
// 或直接 `npm run test:e2e`（會先建置）。
const SUBPATH_PORT = 4391;
const ROOT_PORT = 4392;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 首頁現在有軟體繪製的 WebGL、多層景深與粒子，很吃 CPU：工作行程太多時，和時間賽跑的既有測試
  //（釘選、照片切換的平滑捲動）會偶發逾時。上限設 4（實測預設值會偶發 1 項失敗，4 個穩定全過）。
  workers: 4,
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
  ],
  projects: [
    {
      // 所有測試都在預設的 /liu_yi base 下跑。
      name: 'subpath',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${SUBPATH_PORT}/liu_yi/` },
    },
    {
      // 根路徑建置只重跑連結與資源檢查。
      name: 'root',
      testMatch: /links\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${ROOT_PORT}/` },
    },
  ],
});
