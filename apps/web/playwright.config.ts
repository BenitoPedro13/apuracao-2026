import { defineConfig, devices } from "@playwright/test";

// End-to-end checks of the built export (TASK-web-shell-and-data-hooks.md §5 items 2–6).
// Run after `pnpm build`: `pnpm test:e2e`. Not part of `turbo test`: it reads the live
// bucket and, for the state tests, the local real replays in `.replay/` (gitignored).

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  // From this machine the bucket is ~0.3–1 s per round trip; plan B is HTTP/1.1.
  expect: { timeout: 30_000 },
  use: { baseURL: "http://127.0.0.1:3100", ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
  webServer: { command: "node e2e/serve.ts out 3100", url: "http://127.0.0.1:3100/index.html", reuseExistingServer: false },
});
