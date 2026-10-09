import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { MapIndexView, MapView, Manifest, manifestKey, POINTER_KEY, viewKey } from "@apuracao/contracts";
import { GEO_FILE } from "../src/map/geo-file";
import { decodeGeometry, GeoFile, WIDTH, type Geometry } from "../src/map/geometry";
import { styleFrame } from "../src/map/style";
import { REPO, routeDataFrom } from "./data";

// TASK-map.md §5 items 3–4, on the real 1st-round frame (the local copy of the published
// data, whose hashes equal the live bucket's), so the result doesn't depend on the network.

const PUB = join(REPO, ".replay/real/pub");
const PAGE = "/index.html";
const GUTTER = 116; // CALLOUT_GUTTER_PX
const PAD = 8;

test.skip(!existsSync(PUB), `needs the local copy of the published data ${PUB}`);

const json = (key: string) => JSON.parse(readFileSync(join(PUB, key), "utf8")) as unknown;
const pointer = json(POINTER_KEY) as { epoch: string; seq: number };
const manifest = Manifest.parse(json(manifestKey(pointer.epoch, pointer.seq)));
const frame = MapView.parse(json(viewKey(manifest.views["map/president"]!)));
const index = MapIndexView.parse(json(viewKey(manifest.views["map-index/president"]!)));
const geoBytes = readFileSync(join(import.meta.dirname, "../public", GEO_FILE.path));
const geo = decodeGeometry(GeoFile.parse(JSON.parse(geoBytes.toString("utf8"))));

async function openMap(page: Page, query = "") {
  await routeDataFrom(page, PUB, (p) => p);
  await page.goto(`${PAGE}${query}`);
  // The canvas's text summary appears once the frame is styled, in any mode.
  await expect(page.locator("#mapa .map-box .sr-only")).toContainText("Mapa por município", { timeout: 30_000 });
  await page.waitForFunction(() => performance.getEntriesByName("map:first-draw").length > 0);
}

/** Ray casting on the decoded rings (map units). */
function inside(g: Geometry, i: number, x: number, y: number): boolean {
  let hit = false;
  for (const r of g.rings[i]!) {
    for (let a = 0, b = r.length - 2; a < r.length; b = a, a += 2) {
      const [xa, ya, xb, yb] = [r[a]!, r[a + 1]!, r[b]!, r[b + 1]!];
      if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) hit = !hit;
    }
  }
  return hit;
}

/**
 * A large municipality whose bbox centre is inside it and far from every state label, and
 * where that point lands on the page (the renderer's fit, replicated).
 */
async function probe(page: Page) {
  const box = (await page.locator(".map-box").boundingBox())!;
  const s = Math.min((box.width - GUTTER - 2 * PAD) / WIDTH, (box.height - 2 * PAD) / geo.height);
  const ox = (box.width - GUTTER - WIDTH * s) / 2;
  const oy = (box.height - geo.height * s) / 2;
  const order = [...Array(geo.count).keys()].sort((a, b) => area(b) - area(a));
  function area(i: number) {
    const b = geo.bbox;
    return (b[i * 4 + 2]! - b[i * 4]!) * (b[i * 4 + 3]! - b[i * 4 + 1]!);
  }
  for (const i of order) {
    const b = geo.bbox;
    const x = (b[i * 4]! + b[i * 4 + 2]!) / 2;
    const y = (b[i * 4 + 1]! + b[i * 4 + 3]!) / 2;
    if (!inside(geo, i, x, y)) continue;
    const far = Object.values(geo.labels).every(([lx, ly]) => Math.hypot((lx - x) * s, (ly - y) * s) > 40);
    if (far) return { i, x: box.x + ox + x * s, y: box.y + oy + y * s };
  }
  throw new Error("no probe municipality");
}

test("draws the real frame: the probe's pixel has its party colour, and hovering names it", async ({ page }) => {
  await openMap(page);
  const p = await probe(page);
  const token = styleFrame("lider", frame, geo.ufs, {}).tokenOf[p.i]!;
  expect(token).toMatch(/^(pt|pl)-[1-4]$/);
  const [expected, actual] = await page.evaluate(
    ({ token, x, y }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(".map-box canvas")!;
      const r = canvas.getBoundingClientRect();
      const dpr = canvas.width / r.width;
      const d = canvas.getContext("2d")!.getImageData(Math.round((x - r.left) * dpr), Math.round((y - r.top) * dpr), 1, 1).data;
      const hex = getComputedStyle(canvas).getPropertyValue(`--map-${token}`).trim();
      const rgb = [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16));
      return [rgb, [d[0]!, d[1]!, d[2]!]];
    },
    { token, x: p.x, y: p.y },
  );
  for (let c = 0; c < 3; c++) expect(Math.abs(actual[c]! - expected[c]!), `channel ${c}`).toBeLessThanOrEqual(3);

  await page.mouse.move(p.x, p.y);
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText(index.name[p.i]!);
  await expect(tip).toContainText("lidera");
  await expect(tip).toContainText("Vantagem de");
  await expect(tip).toContainText("100,00% das seções apuradas");
});

test("'Ir para o estado' selects, zooms and opens the state's municipalities", async ({ page }) => {
  await openMap(page);
  await page.getByLabel("Ir para o estado").selectOption("ba");
  await expect(page).toHaveURL(/[?&]uf=ba\b/);
  await expect(page.getByRole("button", { name: "Brasil" })).toBeVisible();
  await expect(page.locator("#municipios table caption")).toContainText("Bahia");
  await page.getByRole("button", { name: "Brasil" }).click();
  await expect(page).not.toHaveURL(/uf=/);
  await expect(page.getByRole("button", { name: "Brasil" })).toBeHidden();
});

test("clicking a municipality selects it and its state", async ({ page }) => {
  await openMap(page);
  const p = await probe(page);
  await page.mouse.click(p.x, p.y);
  await expect(page).toHaveURL(new RegExp(`[?&]uf=${geo.ufs[p.i]}\\b`));
  await expect(page).toHaveURL(new RegExp(`[?&]mun=${geo.ids[p.i]}\\b`));
});

test("a plain wheel scrolls the page and shows the hint; Ctrl + wheel zooms the map", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await openMap(page);
  const p = await probe(page);
  await page.mouse.move(p.x, p.y);
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 300);
  await expect(page.getByText(/rolagem para ampliar o mapa/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
  await expect(page.getByRole("button", { name: "Brasil" })).toBeHidden();

  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await expect(page.getByRole("button", { name: "Brasil" })).toBeVisible();
});

test("?mapa=apurado opens in that mode, and the mode is shareable", async ({ page }) => {
  await openMap(page, "?mapa=apurado");
  const modes = page.getByRole("group", { name: "O que o mapa mostra" });
  await expect(modes.getByRole("button", { name: "Apurado" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#mapa")).toContainText("menos de 25%");
  await modes.getByRole("button", { name: "Por estado" }).click();
  await expect(page).toHaveURL(/[?&]mapa=estados\b/);
  await modes.getByRole("button", { name: "Quem lidera" }).click();
  await expect(page).not.toHaveURL(/mapa=/);
});

test("a tampered geometry is refused: an error, and the tables still work", async ({ page }) => {
  await page.route(`**/${GEO_FILE.path}`, (route) => {
    const body = Buffer.from(geoBytes);
    body[body.length - 3] = body[body.length - 3]! ^ 1; // one bit
    return route.fulfill({ body, contentType: "application/json" });
  });
  await routeDataFrom(page, PUB, (p) => p);
  await page.goto(PAGE);
  await expect(page.locator("#mapa").getByRole("alert")).toContainText("O mapa não carregou", { timeout: 60_000 });
  await expect(page.locator("#mapa").getByRole("alert")).toContainText("tabelas");
  await expect(page.locator("#estados table tbody tr")).toHaveCount(28);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`axe with the map drawn: 0 WCAG 2.2 AA violations, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await openMap(page);
    // The map panel only: the whole page is the dashboard spec's axe test (and its 645-row
    // table makes a full run slow enough to hit the test timeout now and then).
    const results = await new AxeBuilder({ page })
      .include("#mapa")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help} ${v.nodes[0]?.target}`)).toEqual([]);
  });
}

test("reduced motion: zooming to a state is instant", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openMap(page);
  await page.getByLabel("Ir para o estado").selectOption("rs");
  await expect(page.getByRole("button", { name: "Brasil" })).toBeVisible({ timeout: 200 });
});

test("no horizontal scroll at phone and tablet widths", async ({ page }) => {
  await openMap(page);
  for (const width of [320, 375, 412, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width} px`).toBeLessThanOrEqual(width);
  }
});
