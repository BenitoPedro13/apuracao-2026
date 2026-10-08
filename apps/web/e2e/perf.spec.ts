import { expect, test } from "@playwright/test";

// Throttling: Chrome DevTools' "Fast 4G" preset exactly (Fast4GConditions in
// https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/core/sdk/NetworkManager.ts,
// checked 2026-10-08) plus 4× CPU slowdown, as architecture.md §9.3 asks. Cold cache each
// run; 3 runs, the median is the result.
const RTT_MS = 60 * 2.75;
const DOWN_BPS = ((9 * 1000 * 1000) / 8) * 0.9;
const UP_BPS = ((1.5 * 1000 * 1000) / 8) * 0.9;
const CPU = 4;
const RUNS = 3;
const BUDGET_MS = 2_500;

test(`the national headline is on screen within ${BUDGET_MS} ms (median of ${RUNS})`, async ({ browser }) => {
  const runs: { headline: number; tables: number }[] = [];
  for (let i = 0; i < RUNS; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: RTT_MS,
      downloadThroughput: DOWN_BPS,
      uploadThroughput: UP_BPS,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
    const t0 = Date.now();
    await page.goto("http://127.0.0.1:3200/index.html");
    await expect(page.getByRole("region", { name: "Resultado nacional" })).toContainText("47,03%", { timeout: 60_000 });
    const headline = Date.now() - t0;
    await expect(page.locator("#estados table tbody tr")).toHaveCount(28, { timeout: 60_000 });
    await expect(page.locator("#estados table")).not.toContainText("Carregando", { timeout: 60_000 });
    runs.push({ headline, tables: Date.now() - t0 });
    await context.close();
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const h = median(runs.map((r) => r.headline));
  const t = median(runs.map((r) => r.tables));
  console.log(`runs: ${JSON.stringify(runs)}; median headline ${h} ms, UF table complete ${t} ms`);
  expect(h).toBeLessThanOrEqual(BUDGET_MS);
});
