import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { manifestKey, POINTER_KEY, viewKey } from "@apuracao/contracts";
import { UFS } from "@apuracao/tse/codes";
import { areaName } from "../src/lib/places";
import { DATA, liveManifest, liveResult, REPO, routeDataFrom, sha256 } from "./data";

const PAGE = "/index.html";

async function openAndWait(page: Page, url = PAGE) {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Por estado" })).toBeVisible();
}

test("live bucket: the page shows exactly the TSE's numbers (§5 item 2)", async ({ page }) => {
  const { manifest } = await liveManifest();
  const br = await liveResult(manifest, "result/president/br");
  await openAndWait(page);
  const headline = page.getByRole("region", { name: "Resultado nacional" });
  for (const n of ["13", "22"]) {
    const c = br.candidates.find((x) => x.n === n)!;
    await expect(headline).toContainText(`${c.pct.raw}%`);
    await expect(headline).toContainText(`${c.votes.toLocaleString("pt-BR")} votos`);
  }
  await expect(headline).toContainText("45,16%");
  await expect(headline).toContainText("53.879.538 votos");
  await expect(headline).toContainText("47,03%");
  await expect(headline).toContainText("56.104.503 votos");
  await expect(headline).toContainText(br.votes!.valid.toLocaleString("pt-BR"));
  await expect(headline).toContainText(`${br.electorate!.turnoutPct.raw}%`);

  // Every UF row equals its own view: leader by votes and the TSE's percentage string.
  const table = page.locator("#estados table");
  await expect(table.locator("tbody tr")).toHaveCount(28);
  await expect(table).not.toContainText("Carregando");
  const cells = await table
    .locator("tbody tr")
    .evaluateAll((trs) => trs.map((tr) => Array.from(tr.querySelectorAll("td"), (td) => (td.textContent ?? "").trim())));
  const byName = new Map(cells.map((c) => [c[0]!, c]));
  for (const uf of [...UFS, "zz"]) {
    const v = await liveResult(manifest, `result/president/${uf}`);
    const top = [...v.candidates].sort((a, b) => b.votes - a.votes || a.seq - b.seq)[0]!;
    const row = byName.get(areaName(uf));
    expect(row, uf).toBeDefined();
    expect(row![1]!.toLocaleUpperCase("pt-BR"), uf).toContain(`${top.name} ${top.party} ${top.n}`);
    expect(row!.slice(2), uf).toEqual([`${top.pct.raw}%`, `${v.sections!.countedPct.raw}%`]);
  }
});

test("polling: latest.json every 20 s while visible, none while hidden (§5 item 3)", async ({ page }) => {
  const times: number[] = [];
  const done: number[] = [];
  const isPoll = (r: { url(): string; resourceType(): string }) =>
    // The page's own fetches (a browser-initiated cache revalidation would show as "other").
    r.url() === `${DATA}/${POINTER_KEY}` && r.resourceType() === "fetch";
  page.on("request", (r) => void (isPoll(r) && times.push(Date.now())));
  page.on("requestfinished", (r) => void (isPoll(r) && done.push(Date.now())));
  await openAndWait(page);
  await page.waitForTimeout(65_000);
  // TanStack restarts the interval when a response lands, so the period is measured from
  // each response to the next request: pollSeconds (20 s) ± 1 s.
  const waits = times.slice(1).map((t, i) => t - done[i]!);
  console.log("response → next poll (ms):", waits.join(", "));
  expect(waits.length).toBeGreaterThanOrEqual(2);
  for (const w of waits) expect(Math.abs(w - 20_000)).toBeLessThanOrEqual(1_000);

  // Hide the tab the way the browser does (visibilityState + visibilitychange).
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = times.length;
  await page.waitForTimeout(45_000);
  expect(times.length - before).toBe(0);
});

test("a view whose bytes don't hash to its name is rejected, never shown (§5 item 3)", async ({ page }) => {
  const { manifest } = await liveManifest();
  const sha = manifest.views["result/president/br"]!;
  await page.route(`${DATA}/${viewKey(sha)}`, async (route) => {
    const body = (await (await fetch(`${DATA}/${viewKey(sha)}`)).text()).replace("53879538", "53879539");
    await route.fulfill({ body, contentType: "application/json", headers: { "access-control-allow-origin": "*" } });
  });
  await openAndWait(page);
  const headline = page.getByRole("region", { name: "Resultado nacional" });
  await expect(headline).toContainText("Não foi possível carregar o resultado nacional", { timeout: 30_000 });
  await expect(headline).not.toContainText("53.879.53");
});

test("a missing view shows its error state, never zeros (§5 item 4)", async ({ page }) => {
  const { manifest } = await liveManifest();
  await page.route(`${DATA}/${viewKey(manifest.views["result/president/br"]!)}`, (route) =>
    route.fulfill({ status: 403, headers: { "access-control-allow-origin": "*" } }),
  );
  await openAndWait(page);
  const headline = page.getByRole("region", { name: "Resultado nacional" });
  await expect(headline).toContainText("Não foi possível carregar o resultado nacional", { timeout: 60_000 });
  await expect(headline).toContainText("HTTP 403");
  await expect(headline).not.toContainText("%");
});

// A real replay of the captured 1st-round files; its first manifests predate the national
// file, so the national result is "not published" and freshness applies.
const REPLAY = join(REPO, ".replay/20261008t190613-1/pub");
const EARLY_SEQ = 31;

test.describe("states from a real replay (§5 item 4)", () => {
  test.skip(!existsSync(REPLAY), `needs the local replay ${REPLAY}`);

  for (const [minutes, label] of [
    [4, "Atualização atrasada"],
    [11, "Atualização interrompida"],
  ] as const) {
    test(`not published + pointer ${minutes} min old → "${label}"`, async ({ page }) => {
      const manifestBytes = readFileSync(join(REPLAY, manifestKey("replay-1", EARLY_SEQ)));
      const at = new Date(Date.now() - minutes * 60_000).toISOString();
      await routeDataFrom(page, REPLAY, (p) => ({
        ...p,
        seq: EARLY_SEQ,
        manifest: sha256(manifestBytes),
        refreshedAt: at,
        tse: null,
        health: { ...p.health, recorderSeenAt: at },
      }));
      await openAndWait(page);
      const headline = page.getByRole("region", { name: "Resultado nacional" });
      await expect(headline).toContainText("Aguardando dados do TSE");
      await expect(headline).not.toContainText("votos");
      await expect(page.getByRole("status").filter({ hasText: label })).toBeVisible();
      await expect(page.getByText("TSE: ainda não publicado")).toBeVisible();
    });
  }
});

test.describe("accessibility (§5 item 5)", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`axe: 0 WCAG 2.2 AA violations, ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await openAndWait(page);
      await expect(page.locator("#municipios tbody tr").first()).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);
    });
  }

  test("every control is reachable by keyboard, and the UF table opens its municipalities", async ({ page }) => {
    await openAndWait(page);
    await expect(page.locator("#municipios tbody tr").first()).toBeVisible();
    // Map labels and call-outs are pointer shortcuts (tabindex -1); "Ir para o estado" is their keyboard route.
    const controls = await page
      .locator("button:visible:not([tabindex='-1']):not(:disabled), a[href]:visible, input:visible, select:visible, summary:visible")
      .count();
    const reached = new Set<string>();
    for (let i = 0; i < controls + 10; i++) {
      await page.keyboard.press("Tab");
      const id = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        if (!el.dataset.e2e) el.dataset.e2e = Math.random().toString(36).slice(2);
        return el.dataset.e2e;
      });
      if (id) reached.add(id);
    }
    expect(reached.size).toBeGreaterThanOrEqual(controls);

    // Operable: Enter on "Acre: ver municípios" lists Acre's 22 municipalities.
    await page.getByRole("button", { name: "Acre: ver municípios" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#municipios")).toContainText("22 municípios");
  });

  test("prefers-reduced-motion disables transitions", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openAndWait(page);
    const d = await page.getByRole("button", { name: "Compartilhar" }).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(d)).toBeLessThanOrEqual(0.00001);
  });
});

test("at 375 px the UF table shows the % column without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/index.html");
  const table = page.locator("#estados table");
  await expect(table.locator("tbody tr").first()).toBeVisible();
  const pct = table.getByRole("columnheader", { name: "%" });
  const box = await pct.boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(375);
});

test("share tags: absolute og:image of 1200 × 630, pt_BR, large card, canonical", async ({ page, request }) => {
  await page.goto(PAGE);
  const meta = (key: string) => page.locator(`meta[property="${key}"], meta[name="${key}"]`).first().getAttribute("content");
  const image = (await meta("og:image"))!;
  expect(image).toMatch(/^https:\/\/.+\/opengraph-image\?[0-9a-f]+$/);
  expect([await meta("og:image:width"), await meta("og:image:height")]).toEqual(["1200", "630"]);
  expect(await meta("og:image:alt")).toContain("urna");
  expect(await meta("og:locale")).toBe("pt_BR");
  expect(await meta("og:title")).toBe("Apuração 2026");
  expect(await meta("twitter:card")).toBe("summary_large_image");
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(/\/index\.html$/);
  // The file the tag names is in the export, and it's a PNG.
  const res = await request.get(`/opengraph-image`);
  expect(res.status()).toBe(200);
  expect((await res.body()).subarray(1, 4).toString()).toBe("PNG");
});
