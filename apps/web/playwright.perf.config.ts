import { defineConfig, devices } from "@playwright/test";

// Load performance (TASK-web-shell-and-data-hooks.md §5 item 6), measured on this
// machine's loopback so the number is the app's, not the distance to sa-east-1: the
// export built against a local copy of the real published data (`pnpm perf:build`), under
// network and CPU throttling (e2e/perf.spec.ts). Needs `.replay/real/pub`.

export default defineConfig({
  testDir: "e2e",
  testMatch: "perf.spec.ts",
  timeout: 300_000,
  workers: 1,
  reporter: [["list"]],
  // channel "chromium" = Chrome's new headless mode, which rasterizes canvas like a headed
  // browser; the default headless shell rasterizes in software and doubled the measured
  // gap between frames during a pan (33 vs 17 ms p95 at 4× CPU, TASK-map.md §6).
  use: { ...devices["Desktop Chrome"], channel: "chromium", viewport: { width: 412, height: 915 } },
  webServer: [
    { command: "node e2e/serve.ts .perf 3200", url: "http://127.0.0.1:3200/index.html", reuseExistingServer: false },
    { command: "node e2e/serve.ts ../../.replay/real/pub 3001", url: "http://127.0.0.1:3001/data/v1/latest.json", reuseExistingServer: false },
  ],
});
