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
  const runs: { headline: number; tables: number; map: number }[] = [];
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
    const tables = Date.now() - t0;
    await page.waitForFunction(() => performance.getEntriesByName("map:first-draw").length > 0, null, { timeout: 60_000 });
    runs.push({ headline, tables, map: Date.now() - t0 });
    await context.close();
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const h = median(runs.map((r) => r.headline));
  const t = median(runs.map((r) => r.tables));
  const m = median(runs.map((r) => r.map));
  console.log(`runs: ${JSON.stringify(runs)}; median headline ${h} ms, UF table complete ${t} ms, map drawn ${m} ms`);
  expect(h).toBeLessThanOrEqual(BUDGET_MS);
  expect(m).toBeLessThanOrEqual(MAP_BUDGET_MS);
});

// The map's own budgets (architecture.md §9.3, TASK-map.md §5 item 5): 4× CPU, the phone
// viewport, 5 runs, medians. Read from the renderer's performance marks.
const MAP_RUNS = 5;
const MAP_BUDGET_MS = 4_000;

test(`map: first draw ≤ 50 ms, recolour ≤ 16 ms, pan frames p95 ≤ 16 ms, heap ≤ 60 MB (median of ${MAP_RUNS})`, async ({ browser }) => {
  const runs: { first: number; recolour: number; frameP95: number; rafP95: number; frames: number; heapMB: number }[] = [];
  for (let i = 0; i < MAP_RUNS; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
    await page.goto("http://127.0.0.1:3200/index.html");
    await page.waitForFunction(() => performance.getEntriesByName("map:first-draw").length > 0, null, { timeout: 60_000 });
    const first = await page.evaluate(() => performance.getEntriesByName("map:first-draw")[0]!.duration);

    await page.getByRole("group", { name: "O que o mapa mostra" }).getByRole("button", { name: "Apurado" }).click();
    await page.waitForFunction(() => performance.getEntriesByName("map:recolour").length > 0);
    const recolour = await page.evaluate(() => performance.getEntriesByName("map:recolour")[0]!.duration);

    // Zoom in, then a scripted 2 s drag: every frame drawn during it is measured.
    await page.getByRole("button", { name: "Ampliar o mapa" }).click();
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      performance.clearMeasures("map:frame");
      // `map:frame` times our JS (the draw calls); the compositor's side shows up as the
      // gap between animation frames, so record those too.
      const w = window as unknown as { __raf: number[] };
      w.__raf = [];
      const tick = (t: number) => {
        w.__raf.push(t);
        if (w.__raf.length < 400) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const box = (await page.locator(".map-box").boundingBox())!;
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    const steps = 60;
    for (let k = 1; k <= steps; k++) {
      await page.mouse.move(cx + 80 * Math.sin((k / steps) * Math.PI * 2), cy + 60 * Math.cos((k / steps) * Math.PI * 2));
      await page.waitForTimeout(2000 / steps);
    }
    await page.mouse.up();
    const frames = await page.evaluate(() => performance.getEntriesByName("map:frame").map((e) => e.duration));
    const sorted = [...frames].sort((a, b) => a - b);
    const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] ?? Infinity;
    const frameP95 = p95(sorted);
    const raf = await page.evaluate(() => (window as unknown as { __raf: number[] }).__raf);
    const rafP95 = p95(raf.slice(1).map((t, j) => t - raf[j]!));
    const heapMB = await page.evaluate(
      () => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 2 ** 20,
    );
    runs.push({ first, recolour, frameP95, rafP95, frames: frames.length, heapMB });
    await context.close();
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const r = (k: keyof (typeof runs)[number]) => Math.round(median(runs.map((x) => x[k])) * 10) / 10;
  console.log(`map runs: ${JSON.stringify(runs)}`);
  console.log(`median: first draw ${r("first")} ms, recolour ${r("recolour")} ms, frame p95 ${r("frameP95")} ms (JS) / ${r("rafP95")} ms between animation frames over ${r("frames")} frames, heap ${r("heapMB")} MB`);
  expect(r("frames")).toBeGreaterThan(20);
  expect(r("first")).toBeLessThanOrEqual(50);
  expect(r("recolour")).toBeLessThanOrEqual(16);
  expect(r("frameP95")).toBeLessThanOrEqual(16);
  // 60 fps is a 16.7 ms gap; one dropped frame in twenty is allowed by a p95.
  expect(r("rafP95")).toBeLessThanOrEqual(20);
  expect(r("heapMB")).toBeLessThanOrEqual(60);
});
